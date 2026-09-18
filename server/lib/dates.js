/**
 * Every date the hotel cares about is anchored to Asia/Kuala_Lumpur (UTC+8),
 * regardless of where the server runs. Malaysia has had no DST since 1982, so a
 * fixed offset is exact here and avoids pulling in a tz database.
 */

const KL_OFFSET_MINUTES = 8 * 60

/** Current wall-clock time in Kuala Lumpur, expressed as a Date. */
export function klNow() {
  return new Date(Date.now() + KL_OFFSET_MINUTES * 60_000)
}

/** YYYY-MM-DD for "today" in Kuala Lumpur. */
export function todayInKL() {
  return klNow().toISOString().slice(0, 10)
}

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * The three check-in dates the tracker always evaluates. Rates are compared per
 * check-in date, so a Tuesday-night rate never reads as a drop against a
 * Saturday-night rate.
 */
export function checkInDates(base = todayInKL()) {
  return [
    { label: 'Tonight', date: base, offset: 0 },
    { label: '+7d', date: addDays(base, 7), offset: 7 },
    { label: '+30d', date: addDays(base, 30), offset: 30 },
  ]
}

export function checkInLabel(checkInDate, base = todayInKL()) {
  if (checkInDate === base) return 'Tonight'
  if (checkInDate === addDays(base, 7)) return '+7d'
  if (checkInDate === addDays(base, 30)) return '+30d'
  return checkInDate
}

/** Hour of day (0-23) in Kuala Lumpur. */
export function klHour(date = new Date()) {
  return new Date(date.getTime() + KL_OFFSET_MINUTES * 60_000).getUTCHours()
}

/** Minutes since midnight in Kuala Lumpur; used for quiet-hour windows. */
export function klMinutesOfDay(date = new Date()) {
  const kl = new Date(date.getTime() + KL_OFFSET_MINUTES * 60_000)
  return kl.getUTCHours() * 60 + kl.getUTCMinutes()
}

export function klDateString(date = new Date()) {
  return new Date(date.getTime() + KL_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10)
}

/** Human label used in Telegram messages and the UI. */
export function formatKL(date, opts = {}) {
  const kl = new Date(new Date(date).getTime() + KL_OFFSET_MINUTES * 60_000)
  const datePart = kl.toISOString().slice(0, 10)
  const timePart = kl.toISOString().slice(11, 16)
  if (opts.dateOnly) return datePart
  if (opts.timeOnly) return timePart
  return `${datePart} ${timePart}`
}

export function relativeTime(iso, from = Date.now()) {
  const diffMs = from - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/** Parse "23:00" into minutes since midnight. */
export function parseHHMM(value, fallbackMinutes) {
  if (typeof value !== 'string') return fallbackMinutes
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) return fallbackMinutes
  const h = Math.min(23, Math.max(0, Number(m[1])))
  const min = Math.min(59, Math.max(0, Number(m[2])))
  return h * 60 + min
}

export function formatHHMM(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * True when `at` falls inside a quiet window that may wrap past midnight
 * (e.g. 23:00 → 07:00).
 */
export function isWithinQuietHours(at, startMinutes, endMinutes) {
  const cur = klMinutesOfDay(at)
  if (startMinutes === endMinutes) return false
  if (startMinutes < endMinutes) return cur >= startMinutes && cur < endMinutes
  return cur >= startMinutes || cur < endMinutes
}

export { KL_OFFSET_MINUTES }