const KL_OFFSET_MINUTES = 8 * 60

/** Format a price the way the spec requires everywhere: "RM 150". */
export function rm(value) {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return `RM ${n % 1 === 0 ? n.toLocaleString('en-MY') : n.toFixed(2)}`
}

/** All times are shown in Asia/Kuala_Lumpur, never the browser's timezone. */
export function klDate(date) {
  return new Date(new Date(date).getTime() + KL_OFFSET_MINUTES * 60_000)
}

export function formatKL(date, opts = {}) {
  if (!date) return '—'
  const kl = klDate(date)
  const iso = kl.toISOString()
  if (opts.dateOnly) return iso.slice(0, 10)
  if (opts.timeOnly) return iso.slice(11, 16)
  if (opts.short) {
    return kl.toLocaleString('en-MY', {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  }
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`
}

export function relativeTime(iso) {
  if (!iso) return 'never'
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function minutesSince(iso) {
  if (!iso) return Infinity
  return (Date.now() - new Date(iso).getTime()) / 60_000
}

export const OTA_LABELS = {
  booking: 'Booking.com',
  agoda: 'Agoda',
  tripcom: 'Trip.com',
}

export const OTA_STYLES = {
  booking: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200',
  agoda: 'bg-fuchsia-50 text-fuchsia-700 ring-1 ring-inset ring-fuchsia-200',
  tripcom: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200',
}

export const ALERT_META = {
  SALE: { emoji: '🟡', label: 'Sale', tone: 'amber' },
  SOLDOUT: { emoji: '✅', label: 'Sold out', tone: 'emerald' },
  UNDERCUT: { emoji: '🔴', label: 'Undercut', tone: 'red' },
  PRICE_DROP: { emoji: '📉', label: 'Price drop', tone: 'teal' },
  PRICE_RISE: { emoji: '📈', label: 'Price rise', tone: 'slate' },
}

export const TONES = {
  amber: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
  emerald: 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200',
  red: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
  teal: 'bg-teal-50 text-teal-800 ring-1 ring-inset ring-teal-200',
  slate: 'bg-ink-100 text-ink-600 ring-1 ring-inset ring-ink-200',
  brand: 'bg-brand-50 text-brand-800 ring-1 ring-inset ring-brand-200',
}

/** Rooms-left colour: green ≥3, amber 1–2, red 0/sold out. */
export function roomsTone(roomsLeft, soldOut) {
  if (soldOut || roomsLeft === 0) return 'red'
  if (roomsLeft === null || roomsLeft === undefined) return 'slate'
  if (roomsLeft >= 3) return 'emerald'
  return 'amber'
}

export function roomsLabel(roomsLeft, soldOut) {
  if (soldOut || roomsLeft === 0) return 'Sold out'
  if (roomsLeft === null || roomsLeft === undefined) return 'n/a'
  return `${roomsLeft} left`
}

/** Position vs my own rate: green cheaper, red above, grey no mapping. */
export function comparison(theirPrice, myPrice) {
  if (!myPrice || !theirPrice) return { tone: 'slate', text: 'no mapping' }
  const diff = myPrice - theirPrice
  if (Math.abs(diff) < 1) return { tone: 'slate', text: 'same as you' }
  if (diff > 0) return { tone: 'emerald', text: `RM ${diff} cheaper than you` }
  return { tone: 'red', text: `RM ${Math.abs(diff)} above you` }
}

export function cx(...parts) {
  return parts.filter(Boolean).join(' ')
}

/**
 * Green → red price scale. Domain is the observed min/max so the heatmap uses
 * its full colour range instead of washing out.
 */
export function heatColor(value, min, max) {
  if (value == null || min == null || max == null) return '#eceef2'
  if (max === min) return '#26a3a4'
  const t = Math.min(1, Math.max(0, (value - min) / (max - min)))
  const stops = [
    [0, [16, 132, 106]],
    [0.5, [214, 168, 40]],
    [1, [190, 44, 44]],
  ]
  let a = stops[0]
  let b = stops[stops.length - 1]
  for (let i = 0; i < stops.length - 1; i += 1) {
    if (t >= stops[i][0] && t <= stops[i + 1][0]) {
      a = stops[i]
      b = stops[i + 1]
      break
    }
  }
  const local = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0])
  const mix = a[1].map((c, i) => Math.round(c + (b[1][i] - c) * local))
  return `rgb(${mix.join(',')})`
}

export const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
