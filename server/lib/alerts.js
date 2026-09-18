import { getStore, newId, nowIso } from '../store.js'
import { checkInLabel, todayInKL } from './dates.js'

/**
 * Alert detection.
 *
 * Comparison identity is always competitor + OTA + room type + check-in date.
 * That is the whole reason the check-in date exists in the schema: without it a
 * Saturday-night rate looks like a price drop against a Tuesday-night rate.
 */

export const ALERT_TYPES = {
  SALE: { emoji: '🟡', label: 'Sale', notify: true },
  SOLDOUT: { emoji: '✅', label: 'Sold out', notify: true },
  UNDERCUT: { emoji: '🔴', label: 'Undercut', notify: true },
  PRICE_DROP: { emoji: '📉', label: 'Price drop', notify: true },
  PRICE_RISE: { emoji: '📈', label: 'Price rise', notify: false },
}

export const UNDERCUT_THRESHOLD = 10
export const PRICE_MOVE_THRESHOLD = 10
export const SUSPECT_DEVIATION = 0.4
export const CROSS_OTA_MERGE_WINDOW_MS = 30 * 60 * 1000

/** Room name matching is deliberately forgiving — OTAs rename rooms freely. */
export function normalizeRoomName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(room|rm|the|a|with|and|breakfast|incl|including|bed|beds)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function roomNamesMatch(a, b) {
  const na = normalizeRoomName(a)
  const nb = normalizeRoomName(b)
  if (!na || !nb) return false
  if (na === nb) return true
  return na.includes(nb) || nb.includes(na)
}

/**
 * Currency guard. A "$45" reading must never be silently treated as RM 45.
 * Known foreign currencies are converted; anything unknown is refused.
 */
export const FX_TO_MYR = {
  MYR: 1,
  USD: 4.7,
  SGD: 3.5,
  EUR: 5.1,
  GBP: 6.0,
  AUD: 3.1,
  THB: 0.13,
  IDR: 0.00029,
  JPY: 0.031,
  CNY: 0.65,
  HKD: 0.6,
  INR: 0.056,
  KRW: 0.0034,
  PHP: 0.082,
  VND: 0.00019,
  TWD: 0.145,
  AED: 1.28,
}

export function applyCurrencyGuard(entry) {
  const cur = (entry.currency || 'MYR').toUpperCase()
  if (cur === 'MYR') return { ...entry, currency: 'MYR', converted: false }
  const rate = FX_TO_MYR[cur]
  if (!rate) {
    return {
      ...entry,
      currency: 'MYR',
      converted: false,
      suspect: true,
      suspectReason: `currency: ${cur}`,
      originalCurrency: cur,
      originalPrice: entry.price,
    }
  }
  return {
    ...entry,
    currency: 'MYR',
    price: Math.round(entry.price * rate * 100) / 100,
    converted: true,
    originalCurrency: cur,
    originalPrice: entry.price,
  }
}

/**
 * Sanity check: a reading that swings more than 40% from the previous one is
 * stored (so the history is honest) but never allowed to fire an alert.
 */
export function flagSuspicious(entry, previous) {
  if (entry.suspect) return entry
  if (!previous || !previous.price || !entry.price) return entry
  const deviation = Math.abs(entry.price - previous.price) / previous.price
  if (deviation > SUSPECT_DEVIATION) {
    return {
      ...entry,
      suspect: true,
      suspectReason: `price moved ${Math.round(deviation * 100)}% since last check (RM ${previous.price} → RM ${entry.price})`,
    }
  }
  return entry
}

async function findPreviousCheck(store, competitorId, ota, roomType, checkInDate) {
  const checks = await store.query(
    'priceChecks',
    (c) =>
      c.competitorId === competitorId &&
      c.ota === ota &&
      c.status !== 'error',
  )
  let best = null
  for (const c of checks) {
    for (const rt of c.roomTypes || []) {
      if (rt.checkInDate !== checkInDate) continue
      if (!roomNamesMatch(rt.name, roomType)) continue
      if (!best || new Date(c.checkedAt) > new Date(best.checkedAt)) {
        best = { checkedAt: c.checkedAt, room: rt }
      }
    }
  }
  return best
}

async function alreadyFired(store, eventKey) {
  return Boolean(await store.get('alertEvents', eventKey))
}

async function markFired(store, eventKey, alertId) {
  await store.set('alertEvents', eventKey, { alertId, firedAt: nowIso() })
}

/**
 * Compare a fresh check against history and produce alerts.
 * Returns the alerts that were actually created (post-dedup).
 */
export async function detectAlerts({ check, competitor, myHotel, mappings, notified }) {
  const store = await getStore()
  const created = []
  const today = todayInKL()

  const myRoomsById = new Map((myHotel?.roomTypes || []).map((r) => [r.id, r]))
  const mappingFor = (myRoomTypeId) =>
    (mappings || []).find(
      (m) => m.competitorId === competitor.id && m.myRoomTypeId === myRoomTypeId,
    )

  for (const rawRoom of check.roomTypes || []) {
    if (rawRoom.suspect) continue // hard rule: suspect readings never alert
    const room = applyCurrencyGuard(rawRoom)
    if (room.suspect && room.suspectReason?.startsWith('currency')) continue

    const previous = await findPreviousCheck(
      store,
      check.competitorId,
      check.ota,
      room.name,
      room.checkInDate,
    )
    const prevRoom = previous?.room || null
    const label = checkInLabel(room.checkInDate, today)
    const candidates = []

    // 1. SALE — inventory moved.
    if (
      prevRoom &&
      typeof prevRoom.roomsLeft === 'number' &&
      typeof room.roomsLeft === 'number' &&
      room.roomsLeft < prevRoom.roomsLeft &&
      !room.soldOut
    ) {
      const sold = prevRoom.roomsLeft - room.roomsLeft
      candidates.push({
        type: 'SALE',
        roomType: room.name,
        price: prevRoom.price,
        roomsLeft: room.roomsLeft,
        message: `${ALERT_TYPES.SALE.emoji} ${competitor.name} sold ${sold}× ${room.name} at ~RM ${prevRoom.price} on ${check.otaLabel} (${label}). ${room.roomsLeft} left.`,
      })
    }

    // 2. SOLDOUT — availability exhausted.
    const wasAvailable =
      prevRoom && !prevRoom.soldOut && (prevRoom.roomsLeft === null || prevRoom.roomsLeft > 0)
    const nowGone = room.soldOut || room.roomsLeft === 0
    if (wasAvailable && nowGone) {
      candidates.push({
        type: 'SOLDOUT',
        roomType: room.name,
        price: prevRoom.price,
        roomsLeft: 0,
        message: `${ALERT_TYPES.SOLDOUT.emoji} ${competitor.name} SOLD OUT of ${room.name} on ${check.otaLabel} (${label}). Last sold at ~RM ${prevRoom.price} — pricing opportunity.`,
      })
    }

    // 3. UNDERCUT — priced below my own mapped rate.
    //    Skipped for my own hotel: tracking yourself is for OTA-parity and
    //    accuracy checks, and "you undercut yourself by RM 12" is meaningless.
    if (!competitor.isOwn && !room.soldOut && room.price > 0) {
      for (const myRoom of myHotel?.roomTypes || []) {
        const mapping = mappingFor(myRoom.id)
        const matchesByName = roomNamesMatch(room.name, myRoom.name)
        const matchesByMapping = mapping && roomNamesMatch(room.name, mapping.otaRoomName)
        if (!matchesByName && !matchesByMapping) continue
        const myPrice = Number(myRoom.basePrice)
        if (!myPrice) continue
        const gap = myPrice - room.price
        if (gap >= UNDERCUT_THRESHOLD) {
          candidates.push({
            type: 'UNDERCUT',
            roomType: myRoom.name,
            otaRoomName: room.name,
            price: room.price,
            myPrice,
            roomsLeft: room.roomsLeft,
            message: `${ALERT_TYPES.UNDERCUT.emoji} ${competitor.name} dropped ${myRoom.name} to RM ${room.price} on ${check.otaLabel} (${label}) — RM ${gap} below your RM ${myPrice}.`,
          })
        }
      }
    }

    // 4. PRICE_DROP / PRICE_RISE — generic movement.
    if (prevRoom && !room.soldOut && room.price > 0 && prevRoom.price > 0) {
      const delta = room.price - prevRoom.price
      if (Math.abs(delta) >= PRICE_MOVE_THRESHOLD) {
        const isUndercut = candidates.some((c) => c.type === 'UNDERCUT')
        if (!isUndercut) {
          const type = delta < 0 ? 'PRICE_DROP' : 'PRICE_RISE'
          const verb = delta < 0 ? 'dropped' : 'raised'
          candidates.push({
            type,
            roomType: room.name,
            price: room.price,
            previousPrice: prevRoom.price,
            roomsLeft: room.roomsLeft,
            message: `${ALERT_TYPES[type].emoji} ${competitor.name} ${verb} ${room.name} to RM ${room.price} on ${check.otaLabel} (${label}) — was RM ${prevRoom.price}.`,
          })
        }
      }
    }

    for (const candidate of candidates) {
      const dedupKey = `${check.competitorId}|${candidate.type}|${candidate.roomType}|${room.checkInDate}`
      const dayKey = `${dedupKey}|${today}`
      const recentKey = `${dedupKey}|recent`

      // Cross-OTA merge is evaluated BEFORE the day-level dedup: the two rules
      // share the same identity, so checking "already fired today" first would
      // swallow every merge and the second OTA would silently disappear.
      const recent = await store.get('alertEvents', recentKey)
      if (recent && Date.now() - new Date(recent.firedAt).getTime() < CROSS_OTA_MERGE_WINDOW_MS) {
        const existing = await store.get('alerts', recent.alertId)
        if (existing) {
          const otas = new Set([...(existing.mergedOtas || [existing.otaLabel]), check.otaLabel])
          await store.set('alerts', existing.id, {
            mergedOtas: [...otas],
            message: `${existing.message} (also seen on ${check.otaLabel})`,
          })
          await markFired(store, dayKey, existing.id)
          continue
        }
      }

      if (await alreadyFired(store, dayKey)) continue

      const alert = {
        id: newId(),
        type: candidate.type,
        competitorId: check.competitorId,
        competitorName: competitor.name,
        ota: check.ota,
        otaLabel: check.otaLabel,
        roomType: candidate.roomType,
        otaRoomName: candidate.otaRoomName || candidate.roomType,
        checkInDate: room.checkInDate,
        checkInLabel: label,
        price: candidate.price,
        previousPrice: candidate.previousPrice ?? null,
        myPrice: candidate.myPrice ?? null,
        roomsLeft: candidate.roomsLeft ?? null,
        message: candidate.message,
        read: false,
        notify: ALERT_TYPES[candidate.type].notify,
        notified: Boolean(notified),
        checkId: check.id,
        createdAt: nowIso(),
      }
      await store.set('alerts', alert.id, alert)
      await markFired(store, dayKey, alert.id)
      await store.set('alertEvents', recentKey, { alertId: alert.id, firedAt: nowIso() })
      created.push(alert)
    }
  }

  return created
}