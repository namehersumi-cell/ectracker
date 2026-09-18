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

  const check = await saveCheckFromExtraction({ competitor, ota, extraction, checkId, checkedAt })

  const settings = await getNotificationSettings()
  const alerts = await detectAlerts({ check, competitor, myHotel, mappings })

  const delivery = []
  for (const alert of alerts) {
    const result = notify
      ? await deliverAlert(alert, settings)
      : { ok: false, skipped: true, reason: 'notify_off' }
    delivery.push({ alertId: alert.id, ...result })
  }

  return { ota, otaLabel, status: check.status, check, alerts, delivery, simulated: check.simulated }
}

/**
 * Guard, sanity-flag and persist a successful extraction as a `priceChecks`
 * row.
 *
 * Shared with discovery so a hotel added from the map lands in the same shape as
 * one checked by the scheduler. A hotel added without this would appear in the
 * UI with its room names but no prices, which reads as a broken feature.
 */
export async function saveCheckFromExtraction({
  competitor,
  ota,
  extraction,
  checkId = newId(),
  checkedAt = nowIso(),
}) {
  const store = await getStore()
  const otaLabel = OTA_LABELS[ota]

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

  const check = {
    id: checkId,
    competitorId: competitor.id,
    competitorName: competitor.name,
    ota,
    otaLabel,
    checkedAt,
    status: anySuspect ? 'suspect' : 'ok',
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
  return check
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

/**
 * Per-room-type price comparison across OTAs.
 *
 * Every OTA prices the same room differently, which is the whole point of
 * tracking three of them. This returns, for one room type, what each tracked
 * hotel charges on each OTA — so the UI can show
 * "Standard Queen Room · Booking.com RM x · Agoda RM y · Trip.com RM z".
 *
 * Prices come from the most recent successful, non-suspect check per OTA.
 *
 * Rooms are selected by stay *offset* (tonight / +7d / +30d) rather than by
 * absolute date. A check stores the actual calendar dates it was run against,
 * so a check from three days ago has "tonight = three days ago" — matching on
 * the date would silently drop that OTA from the table whenever its last
 * success was not today.
 */
export async function getRoomPriceMatrix({
  checkInDate,
  offset = 0,
  myRoomTypeId = null,
  competitors = null,
} = {}) {
  const store = await getStore()
  const myHotel = (await store.get('settings', 'myHotel')) || { roomTypes: [] }
  const comps = competitors || (await store.list('competitors')).filter((c) => c.active !== false)
  const mappings = await store.list('roomMappings')
  const checks = await store.list('priceChecks')
  const date = checkInDate || checkInDates()[offset]?.date || checkInDates()[0].date

  const myRooms = (myHotel.roomTypes || []).filter(
    (r) => !myRoomTypeId || r.id === myRoomTypeId,
  )

  const matrix = myRooms.map((myRoom) => {
    // A competitor room counts as this room type if it is explicitly mapped, or
    // if the names line up under the forgiving matcher.
    const row = {
      myRoomTypeId: myRoom.id,
      myRoomName: myRoom.name,
      myBasePrice: Number(myRoom.basePrice) || null,
      otas: Object.fromEntries(OTAS.map((o) => [o, { price: null, competitorName: null }])),
      competitors: [],
    }

    for (const comp of comps) {
      const mappedNames = new Set(
        mappings
          .filter((m) => m.competitorId === comp.id && m.myRoomTypeId === myRoom.id)
          .map((m) => m.otaRoomName)
          .filter(Boolean),
      )

      const perOta = {}
      let anyPrice = false

      for (const ota of OTAS) {
        const latest = checks
          .filter((c) => c.competitorId === comp.id && c.ota === ota && c.status === 'ok')
          .sort((a, b) => new Date(b.checkedAt) - new Date(a.checkedAt))[0]
        if (!latest) continue

        const latestDate = klDateString(new Date(latest.checkedAt))
        const room = (latest.roomTypes || []).find((rt) => {
          if (rt.suspect || !rt.price) return false
          // Compare the stay offset this reading was taken for.
          if (rt.checkInDate && dayDiff(latestDate, rt.checkInDate) !== offset) return false
          if (mappedNames.has(rt.name)) return true
          return roomNamesMatch(rt.name, myRoom.name)
        })
        if (!room) continue

        perOta[ota] = {
          price: room.price,
          roomName: room.name,
          roomsLeft: room.roomsLeft,
          asOf: latest.checkedAt,
        }
        anyPrice = true
      }

      if (!anyPrice) continue

      row.competitors.push({
        competitorId: comp.id,
        competitorName: comp.name,
        isOwn: Boolean(comp.isOwn),
        perOta,
        cheapest: cheapestOf(perOta),
      })

      // Headline cell per OTA = the cheapest listing on that OTA across the
      // whole comp set, which is what the operator is actually competing with.
      // An own-hotel listing only wins a tie, so my own rate never masks a
      // cheaper competitor.
      for (const ota of OTAS) {
        if (!perOta[ota]) continue
        const current = row.otas[ota]
        const better =
          !current.price ||
          perOta[ota].price < current.price ||
          (perOta[ota].price === current.price && current.competitorIsOwn && !comp.isOwn)
        if (better) {
          row.otas[ota] = {
            price: perOta[ota].price,
            competitorName: comp.name,
            competitorId: comp.id,
            roomsLeft: perOta[ota].roomsLeft,
            asOf: perOta[ota].asOf,
            competitorIsOwn: Boolean(comp.isOwn),
          }
        }
      }
    }

    row.competitors.sort((a, b) => a.cheapest - b.cheapest)

    // Market range spans every competitor on every OTA, not just the headline
    // cells. Using the headline cells here would understate the market and could
    // tell the operator they are below it when a cheaper rival exists.
    const allPrices = row.competitors.flatMap((c) =>
      Object.values(c.perOta)
        .map((p) => p.price)
        .filter(Boolean),
    )
    row.cheapestOta = cheapestOta(row.otas)
    row.marketLow = allPrices.length ? Math.min(...allPrices) : null
    row.marketHigh = allPrices.length ? Math.max(...allPrices) : null
    row.myPriceVsMarket =
      row.myBasePrice && row.marketLow ? row.myBasePrice - row.marketLow : null
    // Per-OTA spread for one room is a pricing signal in its own right.
    row.otaSpread = row.marketLow && row.marketHigh ? row.marketHigh - row.marketLow : null
    // Who holds the market low, so "above market" is actionable rather than a number.
    row.marketLowHotel = row.competitors[0]?.competitorName || null
    row.marketLowHotelIsOwn = Boolean(row.competitors[0]?.isOwn)
    return row
  })

  return { checkInDate: date, offset, rooms: matrix, simulated: !hasApiKey() }
}

/** Whole days between two YYYY-MM-DD strings (b - a). */
function dayDiff(a, b) {
  const toMs = (s) => new Date(`${s}T00:00:00Z`).getTime()
  return Math.round((toMs(b) - toMs(a)) / 86_400_000)
}

function cheapestOf(perOta) {
  const prices = Object.values(perOta)
    .map((p) => p.price)
    .filter(Boolean)
  return prices.length ? Math.min(...prices) : null
}

function cheapestOta(otas) {
  let best = null
  for (const ota of OTAS) {
    const p = otas[ota]?.price
    if (p && (!best || p < best.price)) best = { ota, price: p }
  }
  return best
}

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