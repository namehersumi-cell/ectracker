import express from 'express'
import { getStore, newId, nowIso, storeKind } from '../store.js'
import {
  OTAS,
  checkAll,
  checkCompetitorOta,
  getGeminiUsage,
  getOtaHealth,
  recordGeminiCall,
} from '../lib/checks.js'
import { OTA_LABELS, hasApiKey } from '../lib/gemini.js'
import {
  sendTelegram,
  telegramConfigured,
  getNotificationSettings,
  saveNotificationSettings,
  sendDailyDigest,
  flushQuietQueue,
  computeCompSet,
} from '../lib/telegram.js'
import {
  createSessionToken,
  pinGateEnabled,
  sessionCookie,
  verifyPin,
  verifySessionToken,
  requireSession,
} from '../lib/auth.js'
import { checkInDates, todayInKL, klDateString } from '../lib/dates.js'

const router = express.Router()

/* ------------------------------------------------------------------ auth */

router.get('/auth/status', (req, res) => {
  const unlocked =
    !pinGateEnabled() || verifySessionToken(req.cookies?.[sessionCookie.name])
  res.json({ pinRequired: pinGateEnabled(), unlocked })
})

router.post('/auth/unlock', (req, res) => {
  const { pin } = req.body || {}
  if (!pinGateEnabled()) return res.json({ ok: true, pinRequired: false })
  if (!pin) return res.status(400).json({ error: 'PIN required' })
  if (!verifyPin(pin)) return res.status(401).json({ error: 'Incorrect PIN' })
  res.cookie(sessionCookie.name, createSessionToken(), sessionCookie.options)
  res.json({ ok: true })
})

router.post('/auth/lock', (req, res) => {
  res.clearCookie(sessionCookie.name, { path: '/' })
  res.json({ ok: true })
})

/* --------------------------------------------------------------- settings */

router.get('/settings/my-hotel', async (_req, res) => {
  const store = await getStore()
  const doc = (await store.get('settings', 'myHotel')) || {
    name: 'My Hotel',
    roomTypes: [],
  }
  res.json({ ...doc, roomTypes: doc.roomTypes || [] })
})

router.put('/settings/my-hotel', async (req, res) => {
  const { name, roomTypes } = req.body || {}
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Hotel name is required' })
  }
  const cleaned = []
  for (const rt of roomTypes || []) {
    const price = Number(rt.basePrice)
    if (!rt.name || !rt.name.trim()) {
      return res.status(400).json({ error: 'Every room type needs a name' })
    }
    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({ error: `Invalid price for "${rt.name}"` })
    }
    cleaned.push({
      id: rt.id || newId(),
      name: rt.name.trim(),
      basePrice: price,
      capacity: Number(rt.capacity) || 2,
    })
  }
  const store = await getStore()
  const saved = await store.set('settings', 'myHotel', { name: name.trim(), roomTypes: cleaned })
  res.json(saved)
})

router.get('/settings/notifications', async (_req, res) => {
  res.json(await getNotificationSettings())
})

router.put('/settings/notifications', async (req, res) => {
  res.json(await saveNotificationSettings(req.body || {}))
})

router.get('/settings/handover', async (_req, res) => {
  const store = await getStore()
  const doc = (await store.get('settings', 'handover')) || { notes: [] }
  res.json({ current: doc.current || null, notes: doc.notes || [] })
})

router.post('/settings/handover', async (req, res) => {
  const { text, author } = req.body || {}
  if (!text || !text.trim()) return res.status(400).json({ error: 'Note text is required' })
  const store = await getStore()
  const doc = (await store.get('settings', 'handover')) || { notes: [] }
  const note = {
    id: newId(),
    text: text.trim(),
    author: (author || '').trim() || 'Front desk',
    createdAt: nowIso(),
  }
  const notes = [note, ...(doc.notes || [])].slice(0, 3)
  const saved = await store.set('settings', 'handover', { current: note, notes })
  res.json({ current: saved.current, notes: saved.notes })
})

/* ------------------------------------------------------------ competitors */

router.get('/competitors', async (_req, res) => {
  const store = await getStore()
  const rows = await store.list('competitors')
  res.json(rows.sort((a, b) => a.name.localeCompare(b.name)))
})

router.post('/competitors', async (req, res) => {
  const { name, otaUrls = {}, active = true, isOwn = false } = req.body || {}
  if (!name || !name.trim()) return res.status(400).json({ error: 'Hotel name is required' })
  const urls = {
    booking: (otaUrls.booking || '').trim() || null,
    agoda: (otaUrls.agoda || '').trim() || null,
    tripcom: (otaUrls.tripcom || '').trim() || null,
  }
  if (!Object.values(urls).some(Boolean)) {
    return res.status(400).json({ error: 'At least one OTA URL is required' })
  }
  const store = await getStore()
  const saved = await store.add('competitors', {
    name: name.trim(),
    otaUrls: urls,
    active: Boolean(active),
    isOwn: Boolean(isOwn),
  })
  res.status(201).json(saved)
})

router.put('/competitors/:id', async (req, res) => {
  const store = await getStore()
  const existing = await store.get('competitors', req.params.id)
  if (!existing) return res.status(404).json({ error: 'Competitor not found' })
  const { name, otaUrls, active, isOwn } = req.body || {}
  const patch = {}
  if (typeof name === 'string' && name.trim()) patch.name = name.trim()
  if (otaUrls) {
    patch.otaUrls = {
      booking: (otaUrls.booking || '').trim() || null,
      agoda: (otaUrls.agoda || '').trim() || null,
      tripcom: (otaUrls.tripcom || '').trim() || null,
    }
  }
  if (typeof active === 'boolean') patch.active = active
  if (typeof isOwn === 'boolean') patch.isOwn = isOwn
  res.json(await store.set('competitors', req.params.id, patch))
})

router.delete('/competitors/:id', async (req, res) => {
  const store = await getStore()
  const ok = await store.delete('competitors', req.params.id)
  for (const row of await store.query('roomMappings', (m) => m.competitorId === req.params.id)) {
    await store.delete('roomMappings', row.id)
  }
  res.json({ ok })
})

/* -------------------------------------------------------------- mappings */

router.get('/room-mappings', async (req, res) => {
  const store = await getStore()
  const rows = await store.list('roomMappings')
  const filtered = req.query.competitorId
    ? rows.filter((r) => r.competitorId === req.query.competitorId)
    : rows
  res.json(filtered)
})

router.put('/room-mappings', async (req, res) => {
  const { competitorId, myRoomTypeId, otaRoomName } = req.body || {}
  if (!competitorId || !myRoomTypeId) {
    return res.status(400).json({ error: 'competitorId and myRoomTypeId are required' })
  }
  const store = await getStore()
  const existing = await store.query(
    'roomMappings',
    (m) => m.competitorId === competitorId && m.myRoomTypeId === myRoomTypeId,
  )
  if (!otaRoomName || !otaRoomName.trim()) {
    for (const row of existing) await store.delete('roomMappings', row.id)
    return res.json({ removed: true })
  }
  if (existing.length) {
    return res.json(
      await store.set('roomMappings', existing[0].id, { otaRoomName: otaRoomName.trim() }),
    )
  }
  res.json(
    await store.add('roomMappings', {
      competitorId,
      myRoomTypeId,
      otaRoomName: otaRoomName.trim(),
    }),
  )
})

/* ----------------------------------------------------------------- checks */

router.post('/check-hotel', requireSession, async (req, res) => {
  const { competitorId, ota } = req.body || {}
  if (!competitorId || !OTAS.includes(ota)) {
    return res.status(400).json({ error: 'competitorId and a valid ota are required' })
  }
  const store = await getStore()
  const competitor = await store.get('competitors', competitorId)
  if (!competitor) return res.status(404).json({ error: 'Competitor not found' })
  const myHotel = (await store.get('settings', 'myHotel')) || { name: 'My Hotel', roomTypes: [] }
  const mappings = await store.list('roomMappings')

  const result = await checkCompetitorOta({ competitor, ota, myHotel, mappings })
  res.json(result)
})

router.post('/check-all', requireSession, async (req, res) => {
  const summary = await checkAll({ onlyCompetitorId: req.body?.competitorId || null })
  res.json(summary)
})

router.get('/checks', async (req, res) => {
  const store = await getStore()
  let rows = await store.list('priceChecks')
  const { competitorId, ota, status, from, to, limit } = req.query
  if (competitorId) rows = rows.filter((c) => c.competitorId === competitorId)
  if (ota) rows = rows.filter((c) => c.ota === ota)
  if (status) rows = rows.filter((c) => c.status === status)
  if (from) rows = rows.filter((c) => c.checkedAt >= from)
  if (to) rows = rows.filter((c) => c.checkedAt <= `${to}T23:59:59.999Z`)
  rows.sort((a, b) => new Date(b.checkedAt) - new Date(a.checkedAt))
  if (limit) rows = rows.slice(0, Number(limit))
  res.json(rows)
})

/** "Report wrong reading" — flags a check so unreliable OTAs become visible. */
router.post('/checks/:checkId/report', async (req, res) => {
  const store = await getStore()
  const check = await store.get('priceChecks', req.params.checkId)
  if (!check) return res.status(404).json({ error: 'Check not found' })
  const roomType = req.body?.roomType || null
  const reported = { ...(check.reported || {}) }
  if (roomType) {
    reported[roomType] = { at: nowIso(), note: req.body?.note || null }
  }
  const saved = await store.set('priceChecks', check.id, {
    reported: true,
    reportedRooms: reported,
    reportNote: req.body?.note || null,
  })
  res.json(saved)
})

/* ----------------------------------------------------------------- alerts */

router.get('/alerts', async (req, res) => {
  const store = await getStore()
  let rows = await store.list('alerts')
  const { type, read, limit } = req.query
  if (type) rows = rows.filter((a) => a.type === type)
  if (read === 'true') rows = rows.filter((a) => a.read)
  if (read === 'false') rows = rows.filter((a) => !a.read)
  rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  if (limit) rows = rows.slice(0, Number(limit))
  res.json(rows)
})

router.post('/alerts/:id/read', async (req, res) => {
  const store = await getStore()
  const alert = await store.get('alerts', req.params.id)
  if (!alert) return res.status(404).json({ error: 'Alert not found' })
  res.json(await store.set('alerts', alert.id, { read: true, readAt: nowIso() }))
})

router.post('/alerts/read-all', async (_req, res) => {
  const store = await getStore()
  const rows = await store.query('alerts', (a) => !a.read)
  for (const row of rows) await store.set('alerts', row.id, { read: true, readAt: nowIso() })
  res.json({ ok: true, count: rows.length })
})

/* ---------------------------------------------------------------- actions */

router.get('/actions', async (req, res) => {
  const store = await getStore()
  let rows = await store.list('actions')
  if (req.query.alertId) rows = rows.filter((a) => a.alertId === req.query.alertId)
  rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  res.json(rows)
})

router.post('/actions', async (req, res) => {
  const { alertId, roomType, action, newPrice, note } = req.body || {}
  if (!action) return res.status(400).json({ error: 'action is required' })
  const allowed = ['raised', 'matched', 'held', 'lowered']
  if (!allowed.includes(action)) {
    return res.status(400).json({ error: `action must be one of ${allowed.join(', ')}` })
  }
  const store = await getStore()
  const saved = await store.add('actions', {
    alertId: alertId || null,
    roomType: roomType || null,
    action,
    newPrice: newPrice === '' || newPrice == null ? null : Number(newPrice),
    note: note || null,
  })
  res.status(201).json(saved)
})

/* -------------------------------------------------------------- dashboard */

router.get('/dashboard', async (_req, res) => {
  const store = await getStore()
  const myHotel = (await store.get('settings', 'myHotel')) || { name: 'My Hotel', roomTypes: [] }
  const competitors = (await store.list('competitors')).filter((c) => c.active !== false)
  const checks = await store.list('priceChecks')
  const alerts = await store.list('alerts')
  const health = await getOtaHealth()
  const usage = await getGeminiUsage()
  const scheduler = (await store.get('meta', 'scheduler')) || null
  const handover = (await store.get('settings', 'handover')) || { notes: [] }

  const latestByCompetitor = competitors.map((c) => {
    const mine = checks
      .filter((x) => x.competitorId === c.id)
      .sort((a, b) => new Date(b.checkedAt) - new Date(a.checkedAt))
    const byOta = {}
    for (const ota of OTAS) {
      byOta[ota] = mine.find((x) => x.ota === ota) || null
    }
    return { competitor: c, byOta, lastCheckAt: mine[0]?.checkedAt || null }
  })

  res.json({
    myHotel,
    competitors: latestByCompetitor,
    compSet: computeCompSet({ myHotel, checks, baseDate: todayInKL() }),
    unreadAlerts: alerts
      .filter((a) => !a.read)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10),
    alertCounts: alerts.reduce((acc, a) => {
      acc[a.type] = (acc[a.type] || 0) + 1
      return acc
    }, {}),
    health,
    usage,
    scheduler,
    handover: { current: handover.current || null, notes: handover.notes || [] },
    lastCheckAt:
      checks.sort((a, b) => new Date(b.checkedAt) - new Date(a.checkedAt))[0]?.checkedAt || null,
    simulated: !hasApiKey(),
    store: storeKind(),
  })
})

/** Sparkline series: median price per day for the last N days. */
router.get('/dashboard/series', async (req, res) => {
  const store = await getStore()
  const days = Number(req.query.days || 14)
  const checks = await store.list('priceChecks')
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const buckets = new Map()
  for (const check of checks) {
    if (new Date(check.checkedAt).getTime() < cutoff) continue
    for (const rt of check.roomTypes || []) {
      if (rt.suspect || !rt.price) continue
      const key = `${check.competitorId}|${rt.name}|${klDateString(new Date(check.checkedAt))}`
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key).push(rt.price)
    }
  }
  const series = {}
  for (const [key, prices] of buckets) {
    const [competitorId, roomType, day] = key.split('|')
    const sorted = prices.sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const id = `${competitorId}|${roomType}`
    if (!series[id]) series[id] = []
    series[id].push({ day, price: median })
  }
  for (const id of Object.keys(series)) {
    series[id].sort((a, b) => a.day.localeCompare(b.day))
  }
  res.json(series)
})

/* --------------------------------------------------------------- calendar */

router.get('/calendar', async (req, res) => {
  const store = await getStore()
  const { competitorId, roomType, checkInDate } = req.query
  if (!competitorId || !roomType) {
    return res.status(400).json({ error: 'competitorId and roomType are required' })
  }
  const checks = await store.list('priceChecks')
  const alerts = await store.list('alerts')
  const actions = await store.list('actions')

  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\b(room|rm|the|with|and|breakfast|bed|beds)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

  const days = new Map()
  for (const check of checks) {
    if (check.competitorId !== competitorId || check.status === 'error') continue
    if (checkInDate && checkInDate !== 'all') {
      // day cell = day the check ran, rate = for the requested stay
    }
    for (const rt of check.roomTypes || []) {
      if (norm(rt.name) !== norm(roomType)) continue
      if (checkInDate && checkInDate !== 'all' && rt.checkInDate !== checkInDate) continue
      if (rt.suspect || !rt.price) continue
      const day = klDateString(new Date(check.checkedAt))
      if (!days.has(day)) days.set(day, { day, prices: [], roomsLeft: [], alerts: [], actions: [] })
      const cell = days.get(day)
      cell.prices.push(rt.price)
      if (typeof rt.roomsLeft === 'number') cell.roomsLeft.push(rt.roomsLeft)
    }
  }

  for (const alert of alerts) {
    if (alert.competitorId !== competitorId) continue
    if (norm(alert.roomType) !== norm(roomType) && norm(alert.otaRoomName) !== norm(roomType)) continue
    if (checkInDate && checkInDate !== 'all' && alert.checkInDate !== checkInDate) continue
    const day = klDateString(new Date(alert.createdAt))
    if (!days.has(day)) days.set(day, { day, prices: [], roomsLeft: [], alerts: [], actions: [] })
    days.get(day).alerts.push({ type: alert.type, message: alert.message })
  }

  for (const action of actions) {
    if (norm(action.roomType) !== norm(roomType)) continue
    const day = klDateString(new Date(action.createdAt))
    if (!days.has(day)) days.set(day, { day, prices: [], roomsLeft: [], alerts: [], actions: [] })
    days.get(day).actions.push({
      action: action.action,
      newPrice: action.newPrice,
      note: action.note,
    })
  }

  const cells = [...days.values()].map((cell) => {
    const sorted = [...cell.prices].sort((a, b) => a - b)
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null
    const minRooms = cell.roomsLeft.length ? Math.min(...cell.roomsLeft) : null
    return {
      day: cell.day,
      median,
      min: sorted[0] ?? null,
      max: sorted[sorted.length - 1] ?? null,
      samples: cell.prices.length,
      roomsLeft: minRooms,
      alerts: cell.alerts,
      actions: cell.actions,
    }
  })

  // Day-of-week and weekend patterns, computed only from real readings.
  const withData = cells.filter((c) => c.median != null)
  const dowBuckets = {}
  for (const cell of withData) {
    const d = new Date(`${cell.day}T00:00:00Z`).getUTCDay()
    ;(dowBuckets[d] ||= []).push(cell.median)
  }
  const dowAverages = Object.entries(dowBuckets)
    .map(([d, prices]) => ({
      dayOfWeek: Number(d),
      avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
      samples: prices.length,
    }))
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek)

  const weekend = withData.filter((c) => [0, 6].includes(new Date(`${c.day}T00:00:00Z`).getUTCDay()))
  const weekday = withData.filter((c) => ![0, 6].includes(new Date(`${c.day}T00:00:00Z`).getUTCDay()))
  const avg = (rows) =>
    rows.length ? Math.round(rows.reduce((a, b) => a + b.median, 0) / rows.length) : null

  const soldOutCount = cells.filter((c) => c.roomsLeft === 0).length

  res.json({
    cells,
    stats: {
      dowAverages,
      weekendAvg: avg(weekend),
      weekdayAvg: avg(weekday),
      soldOutCount,
      cheapestDayOfWeek: dowAverages.length
        ? dowAverages.reduce((a, b) => (b.avg < a.avg ? b : a)).dayOfWeek
        : null,
    },
  })
})

/* ------------------------------------------------------------------ stats */

router.get('/history/stats', async (_req, res) => {
  const store = await getStore()
  const checks = await store.list('priceChecks')
  const alerts = await store.list('alerts')
  res.json({
    totalChecks: checks.length,
    errors: checks.filter((c) => c.status === 'error').length,
    suspect: checks.filter((c) => c.status === 'suspect').length,
    reported: checks.filter((c) => c.reported).length,
    totalAlerts: alerts.length,
  })
})

/* --------------------------------------------------------------- export */

router.get('/export/checks.csv', async (req, res) => {
  const store = await getStore()
  let rows = await store.list('priceChecks')
  const { competitorId, ota, status, from, to } = req.query
  if (competitorId) rows = rows.filter((c) => c.competitorId === competitorId)
  if (ota) rows = rows.filter((c) => c.ota === ota)
  if (status) rows = rows.filter((c) => c.status === status)
  if (from) rows = rows.filter((c) => c.checkedAt >= from)
  if (to) rows = rows.filter((c) => c.checkedAt <= `${to}T23:59:59.999Z`)
  rows.sort((a, b) => new Date(b.checkedAt) - new Date(a.checkedAt))

  const header = [
    'checked_at',
    'competitor',
    'ota',
    'status',
    'room_type',
    'check_in_date',
    'check_out_date',
    'price_myr',
    'currency',
    'original_price',
    'rooms_left',
    'sold_out',
    'suspect',
    'simulated',
  ]
  const lines = [header.join(',')]
  for (const check of rows) {
    for (const rt of check.roomTypes?.length ? check.roomTypes : [null]) {
      lines.push(
        [
          check.checkedAt,
          check.competitorName,
          check.otaLabel || check.ota,
          check.status,
          rt?.name ?? '',
          rt?.checkInDate ?? '',
          rt?.checkOutDate ?? '',
          rt?.price ?? '',
          rt?.currency ?? '',
          rt?.originalPrice ?? '',
          rt?.roomsLeft ?? '',
          rt ? (rt.soldOut ? 'yes' : 'no') : '',
          rt ? (rt.suspect ? 'yes' : 'no') : '',
          check.simulated ? 'yes' : 'no',
        ]
          .map(csvCell)
          .join(','),
      )
    }
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="hoteltrackr-checks-${todayInKL()}.csv"`,
  )
  res.send(lines.join('\n'))
})

/** Config backup: the only genuinely irreplaceable data. */
router.get('/export/config.json', async (_req, res) => {
  const store = await getStore()
  const payload = {
    exportedAt: nowIso(),
    myHotel: await store.get('settings', 'myHotel'),
    competitors: await store.list('competitors'),
    roomMappings: await store.list('roomMappings'),
    notifications: await getNotificationSettings(),
    handover: (await store.get('settings', 'handover')) || null,
  }
  res.setHeader('Content-Type', 'application/json')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="hoteltrackr-config-${todayInKL()}.json"`,
  )
  res.send(JSON.stringify(payload, null, 2))
})

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/* ------------------------------------------------------------ automation */

router.get('/cron/run-checks', async (req, res) => {
  const secret = process.env.CRON_SECRET
  if (!secret) return res.status(503).send('CRON_SECRET is not configured')
  if (req.get('x-cron-key') !== secret) return res.status(401).send('Unauthorized')

  const summary = await checkAll({ notify: true })
  const lines = [
    `EC Price Tracker check run ${summary.ranAt}`,
    `total=${summary.total} ok=${summary.ok} suspect=${summary.suspect} failed=${summary.failed} alerts=${summary.alerts}`,
  ]
  if (summary.errors.length) {
    lines.push('failures:')
    for (const e of summary.errors) lines.push(`- ${e.competitorName} / ${e.otaLabel}: ${e.error}`)
  }
  res.type('text/plain').send(lines.join('\n'))
})

/** Digest endpoints, intended to be driven by Cloud Scheduler. */
router.get('/cron/digest', async (req, res) => {
  const secret = process.env.CRON_SECRET
  if (!secret) return res.status(503).send('CRON_SECRET is not configured')
  if (req.get('x-cron-key') !== secret) return res.status(401).send('Unauthorized')

  const store = await getStore()
  const myHotel = (await store.get('settings', 'myHotel')) || { name: 'My Hotel', roomTypes: [] }
  const checks = await store.list('priceChecks')
  const alerts = await store.list('alerts')
  const queued = await flushQuietQueue()
  const digest = await sendDailyDigest({ myHotel, checks, alerts })
  res.type('text/plain').send(
    `queued_flushed=${queued.count}\ndigest_sent=${Boolean(digest.ok)}`,
  )
})

/* ------------------------------------------------------------ diagnostics */

router.get('/status', async (_req, res) => {
  res.json({
    ok: true,
    gemini: hasApiKey() ? 'live' : 'simulated',
    telegram: telegramConfigured() ? 'configured' : 'not configured',
    pinGate: pinGateEnabled() ? 'enabled' : 'disabled',
    store: storeKind(),
    otas: OTA_LABELS,
    checkInDates: checkInDates(),
  })
})

/** Notifications settings are needed by the checks pipeline. */
router.get('/notifications/test', requireSession, async (_req, res) => {
  const result = await sendTelegram('✅ EC Price Tracker Telegram is working')
  res.json(result)
})

export default router