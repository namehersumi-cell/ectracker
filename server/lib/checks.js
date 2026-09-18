import { getStore, newId, nowIso } from '../store.js'
import { extractRates, OTA_LABELS, hasApiKey } from './gemini.js'
import { checkInDates, klDateString } from './dates.js'
import {
  applyCurrencyGuard,
  flagSuspicious,
  detectAlerts,
  roomNamesMatch,
} from './alerts.js'
import {
  deliverAlert,
  getNotificationSettings,
  recordOtaResult,
} from './telegram.js'

export const OTAS = ['booking', 'agoda', 'tripcom']

/** Gemini free-tier budget, used by the dashboard usage counter. */
export const GEMINI_DAILY_LIMIT = Number(process.env.GEMINI_DAILY_LIMIT || 1500)

/**
 * Daily Gemini call counter. Reset lazily by comparing the stored date, which
 * avoids needing a scheduled reset job.
 */
export async function recordGeminiCall(n = 1) {
  const store = await getStore()
  const today = klDateString()
  const doc = (await store.get('meta', 'geminiUsage')) || { date: today, count: 0 }
  const count = doc.date === today ? doc.count + n : n
  await store.set('meta', 'geminiUsage', { date: today, count })
  return count
}

export async function getGeminiUsage() {
  const store = await getStore()
  const today = klDateString()
  const doc = (await store.get('meta', 'geminiUsage')) || { date: today, count: 0 }
  const count = doc.date === today ? doc.count : 0
  return { count, limit: GEMINI_DAILY_LIMIT, date: today }
}

async function loadContext() {
  const store = await getStore()
  const myHotel = (await store.get('settings', 'myHotel')) || { name: 'My Hotel', roomTypes: [] }
  const competitors = await store.list('competitors')
  const mappings = await store.list('roomMappings')
  return { store, myHotel, competitors, mappings }
}

/**
 * Check one competitor on one OTA across all three check-in dates, persist the
 * result, then run alert detection.
 */
export async function checkCompetitorOta({
  competitor,
  ota,
  myHotel,
  mappings,
  dates = checkInDates(),
  notify = true,
}) {
  const store = await getStore()
  const otaLabel = OTA_LABELS[ota]
  const url = competitor.otaUrls?.[ota]

  if (!url) {
    return { ota, otaLabel, status: 'skipped', error: 'no URL configured' }
  }

  await recordGeminiCall(1)

  // Only ask Gemini for room types we actually map, which keeps the response
  // small and the cost down.
  const mappedNames = mappings
    .filter((m) => m.competitorId === competitor.id)
    .map((m) => m.otaRoomName)
    .filter(Boolean)
  const roomNames = mappedNames.length
    ? mappedNames
    : (myHotel.roomTypes || []).map((r) => r.name)

  // Hand the simulator the last known reading per room/date so simulated data
  // drifts instead of jumping, which keeps the sanity check meaningful.
  const previousByRoomDate = {}
  for (const name of roomNames) {
    for (const stay of dates) {
      const prev = await previousReading(store, competitor.id, ota, {
        name,
        checkInDate: stay.date,
      })
      if (prev?.price) previousByRoomDate[`${name}|${stay.date}`] = prev.price
    }
  }

  const extraction = await extractRates({
    hotelName: competitor.name,
    ota,
    url,
    roomNames,
    basePrice: myHotel.roomTypes?.[0]?.basePrice || 150,
    basePrices: Object.fromEntries(
      (myHotel.roomTypes || []).map((r) => [r.name, Number(r.basePrice) || 150]),
    ),
    dates,
    previous: previousByRoomDate,
  })

  const checkedAt = nowIso()
  const checkId = newId()

  if (extraction.status !== 'ok') {
    const failed = {
      id: checkId,
      competitorId: competitor.id,
      competitorName: competitor.name,
      ota,
      otaLabel,
      checkedAt,
      status: 'error',
      error: extraction.error || 'extraction failed',
      roomTypes: [],
      simulated: false,
    }
    await store.set('priceChecks', checkId, failed)
    await recordOtaResult({ ota, otaLabel, ok: false, error: failed.error })
    return { ota, otaLabel, status: 'error', error: failed.error, check: failed, alerts: [] }
  }

  // Currency guard first (a foreign price can never be compared as RM), then
  // the deviation sanity check against the previous reading.
  const guarded = extraction.roomTypes.map(applyCurrencyGuard)
  const roomTypes = []
  for (const entry of guarded) {
    const previous = await previousReading(store, competitor.id, ota, entry)
    roomTypes.push(flagSuspicious(entry, previous))
  }

  const anySuspect = roomTypes.some((r) => r.suspect)
  const anyCurrencyIssue = roomTypes.some((r) => r.suspectReason?.startsWith('currency'))
  const status = anySuspect ? 'suspect' : 'ok'

  const check = {
    id: checkId,
    competitorId: competitor.id,
    competitorName: competitor.name,
    ota,
    otaLabel,
    checkedAt,
    status,
    error: anyCurrencyIssue
      ? roomTypes.find((r) => r.suspectReason?.startsWith('currency'))?.suspectReason
      : null,
    method: extraction.method,
    notes: extraction.notes || null,
    simulated: Boolean(extraction.simulated || !hasApiKey()),
    roomTypes,
  }
  await store.set('priceChecks', checkId, check)
  await recordOtaResult({ ota, otaLabel, ok: true })

  const settings = await getNotificationSettings()
  const alerts = await detectAlerts({ check, competitor, myHotel, mappings })

  const delivery = []
  for (const alert of alerts) {
    const result = notify
      ? await deliverAlert(alert, settings)
      : { ok: false, skipped: true, reason: 'notify_off' }
    delivery.push({ alertId: alert.id, ...result })
  }

  return { ota, otaLabel, status, check, alerts, delivery, simulated: check.simulated }
}

async function previousReading(store, competitorId, ota, entry) {
  const checks = await store.query(
    'priceChecks',
    (c) => c.competitorId === competitorId && c.ota === ota && c.status !== 'error',
  )
  let best = null
  for (const c of checks) {
    for (const rt of c.roomTypes || []) {
      if (rt.checkInDate !== entry.checkInDate) continue
      if (!roomNamesMatch(rt.name, entry.name)) continue
      if (!best || new Date(c.checkedAt) > new Date(best.checkedAt)) {
        best = { checkedAt: c.checkedAt, room: rt }
      }
    }
  }
  return best?.room || null
}

/**
 * Batch check. A 2-second gap between Gemini calls keeps us well inside rate
 * limits, and every failure is collected rather than thrown.
 */
export async function checkAll({ notify = true, onlyCompetitorId = null, delayMs = 2000 } = {}) {
  const { myHotel, competitors, mappings } = await loadContext()
  const active = competitors.filter(
    (c) => c.active !== false && (!onlyCompetitorId || c.id === onlyCompetitorId),
  )

  const results = []
  let first = true

  for (const competitor of active) {
    for (const ota of OTAS) {
      if (!competitor.otaUrls?.[ota]) continue
      if (!first && delayMs > 0) await sleep(delayMs)
      first = false
      const result = await checkCompetitorOta({
        competitor,
        ota,
        myHotel,
        mappings,
        notify,
      })
      results.push({
        competitorId: competitor.id,
        competitorName: competitor.name,
        ota,
        otaLabel: result.otaLabel,
        status: result.status,
        error: result.error || null,
        alerts: (result.alerts || []).length,
        checkId: result.check?.id || null,
      })
    }
  }

  const ok = results.filter((r) => r.status === 'ok').length
  const suspect = results.filter((r) => r.status === 'suspect').length
  const failed = results.filter((r) => r.status === 'error').length
  const alertsCreated = results.reduce((n, r) => n + r.alerts, 0)

  const store = await getStore()
  await store.set('meta', 'scheduler', { lastRunAt: nowIso(), lastRunOk: failed === 0 })

  return {
    total: results.length,
    ok,
    suspect,
    failed,
    alerts: alertsCreated,
    errors: results.filter((r) => r.status === 'error'),
    results,
    ranAt: nowIso(),
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Health strip data for the dashboard: per-OTA status + last success. */
export async function getOtaHealth() {
  const store = await getStore()
  const rows = await store.list('otaHealth')
  return OTAS.map((ota) => {
    const row = rows.find((r) => r.ota === ota) || {}
    return {
      ota,
      otaLabel: OTA_LABELS[ota],
      consecutiveFailures: row.consecutiveFailures || 0,
      healthy: (row.consecutiveFailures || 0) === 0,
      lastSuccessAt: row.lastSuccessAt || null,
      lastError: row.lastError || null,
    }
  })
}