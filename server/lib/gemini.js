import { GoogleGenAI } from '@google/genai'
import { checkInDates, addDays } from './dates.js'

/**
 * Gemini extraction.
 *
 * Two grounding strategies are available and are tried in order:
 *   1. URL Context — Gemini fetches the OTA page from Google infrastructure.
 *   2. Google Search grounding — the fallback for JavaScript-heavy OTAs whose
 *      rates never appear in the raw HTML (Trip.com and Agoda in practice).
 *
 * When no API key is configured the module returns deterministic simulated
 * readings so the whole product can be exercised offline. Simulated checks are
 * always flagged (`simulated: true`) and surfaced in the UI rather than being
 * silently passed off as real data.
 */

const MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash'
const GUESTS = '2 adults, 1 room'

/** Each OTA prices the same room slightly differently; used by the simulator. */
const OTA_BIAS = { booking: 1.0, agoda: 0.97, tripcom: 1.04 }

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    roomTypes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          price: { type: 'number' },
          currency: { type: 'string' },
          roomsLeft: { type: 'number', nullable: true },
          soldOut: { type: 'boolean' },
          checkInDate: { type: 'string' },
          checkOutDate: { type: 'string' },
        },
        required: ['name', 'price', 'currency', 'soldOut', 'checkInDate'],
      },
    },
    pageReadable: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: ['roomTypes'],
}

export function buildPrompt({ hotelName, otaLabel, dates, otaRoomNames }) {
  const dateLines = dates
    .map(
      (d) =>
        `- ${d.label}: check-in ${d.date}, check-out ${addDays(d.date, 1)} (checkInDate field must be "${d.date}")`,
    )
    .join('\n')

  const mappingLine =
    otaRoomNames && otaRoomNames.length
      ? `\nWe only care about these room types (match them as they appear on this OTA; also include any others you find): ${otaRoomNames.join(', ')}.`
      : ''

  return `Fetch this hotel page on ${otaLabel} for "${hotelName}" and extract every bookable room type.

For EACH of these stays, separately:
${dateLines}

Occupancy is always ${GUESTS}. Use this exact occupancy for every price.

For every room type on every one of the stays above, extract:
- room type name exactly as shown on the OTA
- the current price per night for ${GUESTS}
- currency code as shown
- number of rooms left if the page shows it, otherwise null
- soldOut: true if the room type is not bookable for that stay

IMPORTANT pricing rules:
- Report the CHEAPEST currently bookable PUBLIC nightly rate.
- IGNORE member-only / loyalty / Genius / Insider prices.
- IGNORE crossed-out "was" prices and strike-through original rates.
- IGNORE promo badges, discounts applied only at checkout, and bundle deals.
- If only a total stay price is shown, divide by the number of nights.
- Do not invent prices. If a room type has no public price, set soldOut true and price 0.

Fall back to Google Search only if the page content is unavailable.
Return ONLY valid JSON matching the schema.${mappingLine}`
}

let client = null
export function hasApiKey() {
  return Boolean(process.env.GEMINI_API_KEY)
}

function getClient() {
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  }
  return client
}

/** Counts every Gemini call so the dashboard can show free-tier usage. */
let onCall = () => {}
export function setCallCounter(fn) {
  onCall = fn
}

async function callGemini({ prompt, useUrlContext, url }) {
  const ai = getClient()
  onCall()
  const config = {
    responseMimeType: 'application/json',
    responseSchema: RESPONSE_SCHEMA,
    temperature: 0,
  }
  if (useUrlContext) {
    config.tools = [{ urlContext: {} }]
  } else {
    config.tools = [{ googleSearch: {} }]
  }
  const contents = url ? `${prompt}\n\nURL: ${url}` : prompt

  const res = await ai.models.generateContent({
    model: MODEL,
    contents,
    config,
  })
  const text = res.text ?? res.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  return JSON.parse(text)
}

/**
 * Deterministic pseudo-random generator seeded from the check identity, so a
 * simulated reading is stable per hotel/OTA/date instead of jumping on every
 * poll. Values drift slowly with the calendar day, which makes the trend and
 * heatmap views behave realistically.
 */
function seededRandom(seed) {
  let h = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return () => {
    h += 0x6d2b79f5
    let t = h
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function simulate({ hotelName, ota, dates, roomNames, basePrice, basePrices = {}, previous = {} }) {
  const rand = seededRandom(`${hotelName}|${ota}`)
  const dayIndex = Math.floor(Date.now() / 86_400_000)
  const dayRand = seededRandom(`${hotelName}|${ota}|${dayIndex}`)
  const names = roomNames?.length ? roomNames : ['Deluxe Room', 'Twin Room', 'Suite']
  const bias = OTA_BIAS[ota] || 1

  const rows = []
  for (const stay of dates) {
    for (const name of names) {
      const r = rand()
      const weekend = [0, 5, 6].includes(
        new Date(`${stay.date}T00:00:00Z`).getUTCDay(),
      )
      const lead = stay.offset === 0 ? 1.05 : stay.offset === 7 ? 1.0 : 0.95
      const weekendBump = weekend ? 1.11 : 1
      const base = (basePrices[name] ?? basePrice) * bias
      // Structural target for this room and stay, then a small random walk from
      // the previous reading. Applying the lead/weekend multipliers on top of
      // the previous price instead would compound and inflate rates on every
      // successive check.
      const target = base * lead * weekendBump
      const prior = previous[`${name}|${stay.date}`]
      const noise = (dayRand() - 0.5) * target * 0.03
      const price = Math.max(
        70,
        Math.round((prior == null ? target + noise : prior + (target - prior) * 0.25 + noise) / 2) * 2,
      )
      const soldOut = r > 0.93
      const roomsLeft = soldOut ? 0 : Math.max(1, Math.round(9 - r * 8))
      rows.push({
        name,
        price: soldOut ? 0 : price,
        currency: 'MYR',
        roomsLeft,
        soldOut,
        checkInDate: stay.date,
        checkOutDate: addDays(stay.date, 1),
        simulated: true,
      })
    }
  }
  return { roomTypes: rows, pageReadable: true, notes: 'simulated', simulated: true }
}

const OTA_LABELS = { booking: 'Booking.com', agoda: 'Agoda', tripcom: 'Trip.com' }

/**
 * Run one extraction for a competitor on one OTA across all check-in dates.
 * Never throws: a failure is returned as status "error" so one dead OTA cannot
 * take down the rest of the batch.
 */
export async function extractRates({
  hotelName,
  ota,
  url,
  roomNames,
  basePrice = 150,
  dates = checkInDates(),
  previous = {},
  basePrices = {},
}) {
  const otaLabel = OTA_LABELS[ota] || ota
  const prompt = buildPrompt({ hotelName, otaLabel, dates, otaRoomNames: roomNames })

  if (!hasApiKey()) {
    return {
      status: 'ok',
      method: 'simulated',
      roomTypes: simulate({
        hotelName,
        ota,
        dates,
        roomNames,
        basePrice,
        basePrices,
        previous,
      }).roomTypes,
      notes: 'No GEMINI_API_KEY configured — showing simulated readings.',
      simulated: true,
    }
  }

  if (!url) {
    return { status: 'error', error: `No ${otaLabel} URL configured for ${hotelName}` }
  }

  try {
    const data = await callGemini({ prompt, useUrlContext: true, url })
    return normalize(data, { method: 'url_context', dates })
  } catch (primaryErr) {
    try {
      const searchPrompt = `${prompt}\n\nIf rooms-left counts are unavailable, set roomsLeft to null.`
      const data = await callGemini({
        prompt: searchPrompt,
        useUrlContext: false,
        url: `${url} (search the web for the current nightly rates for "${hotelName}" on ${otaLabel})`,
      })
      const normalized = normalize(data, { method: 'google_search', dates })
      normalized.notes = `URL context failed (${primaryErr.message}); recovered via Google Search grounding.`
      return normalized
    } catch (fallbackErr) {
      return {
        status: 'error',
        error: `URL context: ${primaryErr.message}; search fallback: ${fallbackErr.message}`,
      }
    }
  }
}

function normalize(data, { method, dates }) {
  const allowed = new Set(dates.map((d) => d.date))
  const rows = Array.isArray(data?.roomTypes) ? data.roomTypes : []
  const roomTypes = rows
    .filter((r) => r && typeof r.name === 'string' && r.name.trim())
    .map((r) => {
      const checkInDate = allowed.has(r.checkInDate) ? r.checkInDate : dates[0].date
      const price = Number(r.price) || 0
      const roomsLeft =
        r.roomsLeft === null || r.roomsLeft === undefined ? null : Number(r.roomsLeft)
      return {
        name: r.name.trim(),
        price,
        currency: (r.currency || 'MYR').toUpperCase(),
        roomsLeft,
        soldOut: Boolean(r.soldOut) || price === 0,
        checkInDate,
        checkOutDate: r.checkOutDate || addDays(checkInDate, 1),
      }
    })

  return {
    status: roomTypes.length ? 'ok' : 'error',
    error: roomTypes.length ? null : 'Gemini returned no room types for this page.',
    method,
    roomTypes,
    notes: data?.notes || null,
  }
}

export { OTA_LABELS, GUESTS, RESPONSE_SCHEMA }