import { getStore, newId, nowIso } from '../store.js'
import {
  isWithinQuietHours,
  parseHHMM,
  formatHHMM,
  klDateString,
  formatKL,
} from './dates.js'
import { ALERT_TYPES } from './alerts.js'

/**
 * Telegram delivery with quiet hours and digest handling.
 *
 * Quiet-hour messages are queued in Firestore rather than dropped, and drained
 * as a single combined "overnight digest" so nobody wakes up to twenty pings.
 */

const DEFAULT_NOTIFICATION_SETTINGS = {
  toggles: {
    SALE: true,
    UNDERCUT: true,
    SOLDOUT: true,
    PRICE_DROP: true,
    PRICE_RISE: false,
  },
  quietHours: { enabled: true, start: '23:00', end: '07:00' },
  digestTime: '08:00',
  quietDigestTime: '07:30',
  failureThreshold: 5,
}

export async function getNotificationSettings() {
  const store = await getStore()
  const doc = await store.get('settings', 'notifications')
  if (!doc) return { ...DEFAULT_NOTIFICATION_SETTINGS }
  return {
    ...DEFAULT_NOTIFICATION_SETTINGS,
    ...doc,
    toggles: { ...DEFAULT_NOTIFICATION_SETTINGS.toggles, ...(doc.toggles || {}) },
    quietHours: {
      ...DEFAULT_NOTIFICATION_SETTINGS.quietHours,
      ...(doc.quietHours || {}),
    },
  }
}

export async function saveNotificationSettings(patch) {
  const store = await getStore()
  const current = await getNotificationSettings()
  const next = {
    ...current,
    ...patch,
    toggles: { ...current.toggles, ...(patch.toggles || {}) },
    quietHours: { ...current.quietHours, ...(patch.quietHours || {}) },
  }
  await store.set('settings', 'notifications', next)
  return next
}

export function telegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)
}

/**
 * Low-level send. Never throws — a Telegram outage must not break a price
 * check. Returns true when Telegram accepted the message.
 */
export async function sendTelegram(message) {
  if (!telegramConfigured()) {
    console.log('[telegram:skipped]', message)
    return { ok: false, skipped: true, reason: 'not_configured' }
  }
  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: message,
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error('[telegram:error]', res.status, body.slice(0, 200))
      return { ok: false, status: res.status }
    }
    return { ok: true }
  } catch (err) {
    console.error('[telegram:error]', err.message)
    return { ok: false, error: err.message }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Send an alert, respecting per-type toggles and quiet hours. Held messages go
 * to the queue and are delivered by the overnight digest.
 */
export async function deliverAlert(alert, settings = null) {
  const cfg = settings || (await getNotificationSettings())
  if (!cfg.toggles?.[alert.type]) {
    return { ok: false, skipped: true, reason: 'type_disabled' }
  }
  if (!alert.notify) {
    return { ok: false, skipped: true, reason: 'notify_disabled' }
  }

  const quiet = cfg.quietHours?.enabled
    ? isWithinQuietHours(
        new Date(),
        parseHHMM(cfg.quietHours.start, 23 * 60),
        parseHHMM(cfg.quietHours.end, 7 * 60),
      )
    : false

  if (quiet) {
    const store = await getStore()
    await store.add('telegramQueue', {
      id: newId(),
      kind: 'alert',
      alertId: alert.id,
      message: alert.message,
      queuedAt: nowIso(),
      batchDate: klDateString(),
    })
    return { ok: false, queued: true, reason: 'quiet_hours' }
  }

  return sendTelegram(alert.message)
}

/** Combine and send everything held during quiet hours. */
export async function flushQuietQueue() {
  const store = await getStore()
  const queued = await store.query('telegramQueue')
  if (!queued.length) return { ok: false, count: 0 }
  const lines = queued
    .sort((a, b) => new Date(a.queuedAt) - new Date(b.queuedAt))
    .map((q) => `• ${q.message}`)

  const header = `🌙 Overnight digest — ${queued.length} update${queued.length === 1 ? '' : 's'} while you slept`
  const result = await sendTelegram(`${header}\n\n${lines.join('\n')}`)
  if (result.ok) {
    for (const q of queued) await store.delete('telegramQueue', q.id)
  }
  return { ...result, count: queued.length }
}

/**
 * Daily digest: the last 24h of activity plus tonight's comp-set average vs
 * my own rates.
 */
export async function sendDailyDigest({ myHotel, checks, alerts }) {
  const since = Date.now() - 24 * 60 * 60 * 1000
  const recentAlerts = alerts.filter((a) => new Date(a.createdAt).getTime() >= since)
  const byType = (t) => recentAlerts.filter((a) => a.type === t)

  const lines = [`📊 HotelTrackr daily digest — ${formatKL(new Date(), { dateOnly: true })}`]

  const sales = byType('SALE')
  const soldOuts = byType('SOLDOUT')
  const undercuts = byType('UNDERCUT')
  const drops = byType('PRICE_DROP')
  const rises = byType('PRICE_RISE')

  lines.push('', `🟡 Sales: ${sales.length} · 🔴 Undercuts: ${undercuts.length}`)
  lines.push(`✅ Sell-outs: ${soldOuts.length} · 📉 Drops: ${drops.length} · 📈 Rises: ${rises.length}`)

  if (undercuts.length) {
    lines.push('', 'Undercuts:')
    for (const a of undercuts.slice(0, 5)) lines.push(`• ${a.message}`)
  }
  if (soldOuts.length) {
    lines.push('', 'Sell-outs:')
    for (const a of soldOuts.slice(0, 5)) lines.push(`• ${a.message}`)
  }

  const comp = computeCompSet({ myHotel, checks })
  if (comp.length) {
    lines.push('', 'Tonight vs comp-set:')
    for (const row of comp) {
      const rel =
        row.delta > 0 ? `RM ${row.delta} above avg` : row.delta < 0 ? `RM ${Math.abs(row.delta)} below avg` : 'at avg'
      lines.push(`• ${row.roomName}: comp avg RM ${row.avg} · you RM ${row.myPrice} (${rel})`)
    }
  }

  if (recentAlerts.length === 0) lines.push('', 'Quiet 24 hours — no alerts.')
  return sendTelegram(lines.join('\n'))
}

/**
 * Comp-set average for tonight, per my room type. Only active competitors,
 * latest successful non-suspect readings, and only mapped room types.
 */
export function computeCompSet({ myHotel, checks, baseDate = null }) {
  const latest = new Map() // myRoomTypeId -> { prices: [] , seen: Set }
  for (const check of checks) {
    if (check.status === 'error') continue
    for (const rt of check.roomTypes || []) {
      if (rt.suspect || rt.soldOut || !rt.price) continue
      if (baseDate && rt.checkInDate !== baseDate) continue
      for (const myRoom of myHotel?.roomTypes || []) {
        if (!roomMatches(rt.name, myRoom)) continue
        const entry = latest.get(myRoom.id) || { prices: [], competitors: new Map() }
        const key = `${check.competitorId}|${rt.checkInDate}`
        if (!entry.competitors.has(key)) {
          entry.competitors.set(key, true)
          entry.prices.push(rt.price)
        }
        latest.set(myRoom.id, entry)
      }
    }
  }
  return (myHotel?.roomTypes || [])
    .map((myRoom) => {
      const entry = latest.get(myRoom.id)
      if (!entry || !entry.prices.length) return null
      const avg = Math.round(entry.prices.reduce((a, b) => a + b, 0) / entry.prices.length)
      const myPrice = Number(myRoom.basePrice) || 0
      const sorted = [...entry.prices].sort((a, b) => a - b)
      const rank = myPrice ? sorted.filter((p) => p < myPrice).length + 1 : null
      return {
        myRoomTypeId: myRoom.id,
        roomName: myRoom.name,
        avg,
        myPrice,
        delta: myPrice - avg,
        samples: entry.prices.length,
        rank,
        of: sorted.length + 1,
      }
    })
    .filter(Boolean)
}

function roomMatches(otaRoomName, myRoom) {
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\b(room|rm|the|with|and|breakfast|bed|beds)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  const a = norm(otaRoomName)
  const b = norm(myRoom.name)
  if (!a || !b) return false
  return a === b || a.includes(b) || b.includes(a)
}

/**
 * Failure watchdog: after N consecutive failures for one OTA, send a single
 * message per OTA per day.
 */
export async function recordOtaResult({ ota, otaLabel, ok, error }) {
  const store = await getStore()
  const key = ota
  const prev = (await store.get('otaHealth', key)) || { ota, otaLabel, consecutiveFailures: 0 }
  const day = klDateString()

  if (ok) {
    await store.set('otaHealth', key, {
      ...prev,
      otaLabel,
      consecutiveFailures: 0,
      lastSuccessAt: nowIso(),
      lastError: null,
    })
    return
  }

  const consecutiveFailures = (prev.consecutiveFailures || 0) + 1
  const cfg = await getNotificationSettings()
  const threshold = cfg.failureThreshold || 5
  const shouldAlert =
    consecutiveFailures >= threshold && prev.lastFailureAlertDate !== day

  await store.set('otaHealth', key, {
    ...prev,
    otaLabel,
    consecutiveFailures,
    lastError: error || 'unknown error',
    lastFailureAt: nowIso(),
    lastFailureAlertDate: shouldAlert ? day : prev.lastFailureAlertDate,
  })

  if (shouldAlert) {
    await sendTelegram(
      `⚠️ ${otaLabel} extraction failing since ${formatKL(new Date())} — check the app. (${consecutiveFailures} failed checks in a row)`,
    )
  }
}

export { DEFAULT_NOTIFICATION_SETTINGS }