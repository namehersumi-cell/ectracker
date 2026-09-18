import { newId } from '../store.js'

/**
 * Google Places integration: address/hotel autocomplete, radius search around
 * my hotel, and place details.
 *
 * Uses the Places API (New) when GOOGLE_MAPS_API_KEY is set. Without a key the
 * app falls back to a deterministic simulator so the discovery flow can be
 * exercised offline — every simulated payload is tagged `simulated: true` so
 * the UI can label it rather than passing invented hotels off as real ones.
 */

const PLACES_BASE = 'https://places.googleapis.com/v1'

export function hasMapsKey() {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY)
}

/** Earth radius in metres. */
const R = 6371000

export function distanceMeters(a, b) {
  if (!a || !b) return null
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(h)))
}

/** Deterministic PRNG so a given centre always yields the same simulated set. */
function seededRandom(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function hashString(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/* ------------------------------------------------------------ autocomplete */

/**
 * Suggest hotels/addresses as the operator types. Returns a small, ordered list
 * of { placeId, name, address, lat, lng }.
 */
export async function searchPlaces(query, { limit = 6, sessionToken } = {}) {
  const q = String(query || '').trim()
  if (q.length < 3) return { suggestions: [], simulated: !hasMapsKey() }

  if (!hasMapsKey()) {
    return { suggestions: simulateSuggestions(q, limit), simulated: true }
  }

  const body = {
    input: q,
    // Bias toward hotels/addresses; the operator is picking a property.
    includedPrimaryTypes: ['lodging'],
    languageCode: 'en',
    ...(sessionToken ? { sessionToken } : {}),
  }
  const res = await fetch(`${PLACES_BASE}/places:autocomplete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Places autocomplete failed (${res.status}): ${text.slice(0, 200)}`)
  }
  const data = await res.json()
  const suggestions = (data.suggestions || [])
    .map((s) => s.placePrediction)
    .filter(Boolean)
    .slice(0, limit)
    .map((p) => ({
      placeId: p.placeId,
      name: p.structuredFormat?.mainText?.text || p.text?.text || '',
      address: p.structuredFormat?.secondaryText?.text || '',
      // Autocomplete does not return coordinates; callers resolve via details.
      lat: null,
      lng: null,
    }))
  return { suggestions, simulated: false }
}

/* --------------------------------------------------------------- details */

export async function placeDetails(placeId) {
  if (!placeId) throw new Error('placeId is required')

  if (!hasMapsKey()) {
    return simulateDetails(placeId)
  }

  const fields = 'id,displayName,formattedAddress,location,addressComponents'
  const res = await fetch(`${PLACES_BASE}/places/${encodeURIComponent(placeId)}`, {
    headers: {
      'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
      'X-Goog-FieldMask': fields,
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Place details failed (${res.status}): ${text.slice(0, 200)}`)
  }
  const p = await res.json()
  const city = (p.addressComponents || []).find((c) =>
    (c.types || []).includes('locality'),
  )
  return {
    placeId: p.id,
    name: p.displayName?.text || '',
    address: p.formattedAddress || '',
    city: city?.longText || null,
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    simulated: false,
  }
}

/* ------------------------------------------------------------ nearby hotels */

/**
 * Hotels within `radiusM` of the centre. This is the core of the map flow: set
 * the property and a radius, and the comp set is proposed rather than typed in
 * by hand.
 */
export async function nearbyHotels({ lat, lng, radiusM = 2000, limit = 20, excludePlaceIds = [] }) {
  if (lat == null || lng == null) throw new Error('A centre point (lat/lng) is required')
  const exclude = new Set(excludePlaceIds.filter(Boolean))

  if (!hasMapsKey()) {
    const found = simulateNearby({ lat, lng, radiusM, limit })
    return {
      hotels: found
        .filter((h) => !exclude.has(h.placeId))
        .map((h) => ({ ...h, distanceM: distanceMeters({ lat, lng }, h) })),
      simulated: true,
      radiusM,
    }
  }

  const res = await fetch(`${PLACES_BASE}/places:searchNearby`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount',
    },
    body: JSON.stringify({
      includedTypes: ['lodging'],
      maxResultCount: Math.min(limit, 20),
      locationRestriction: {
        circle: { center: { latitude: lat, longitude: lng }, radius: Math.min(radiusM, 50000) },
      },
      languageCode: 'en',
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Nearby search failed (${res.status}): ${text.slice(0, 200)}`)
  }
  const data = await res.json()
  const hotels = (data.places || [])
    .map((p) => ({
      placeId: p.id,
      name: p.displayName?.text || '',
      address: p.formattedAddress || '',
      lat: p.location?.latitude ?? null,
      lng: p.location?.longitude ?? null,
      rating: p.rating ?? null,
      reviews: p.userRatingCount ?? null,
      simulated: false,
    }))
    .filter((h) => !exclude.has(h.placeId))
    .map((h) => ({ ...h, distanceM: distanceMeters({ lat, lng }, h) }))
    .sort((a, b) => a.distanceM - b.distanceM)
  return { hotels, simulated: false, radiusM }
}

/* --------------------------------------------------------------- simulator */

const KL_CENTRE = { lat: 3.139, lng: 101.6869 }

const SIM_HOTEL_NAMES = [
  'The Sterling Hotel',
  'Marina Bay Suites',
  'Hotel Sri Petaling',
  'Casa Del Rio',
  'The Robertson',
  'Bukit Bintang Residence',
  'Ceylon Hill Hotel',
  'Pudu Sentral Inn',
  'Ampang Park Hotel',
  'Chow Kit Grand',
  'Bangsar South Suites',
  'Damansara Heights Hotel',
  'Sunway Lagoon Resort',
  'KLCC View Hotel',
  'Old Klang Road Inn',
  'Mont Kiara Suites',
  'Sentul East Hotel',
  'Titiwangsa Lake Hotel',
  'Brickfields Central',
  'Jalan Alor Boutique',
  'Medan Tuanku Hotel',
  'Kampung Baru Homestay',
  'Desa Park City Hotel',
  'Segambut Green Hotel',
]

const STREETS = [
  'Jalan Sultan Ismail',
  'Jalan Bukit Bintang',
  'Jalan Ampang',
  'Jalan Pudu',
  'Jalan Tun Razak',
  'Persiaran KLCC',
  'Jalan Imbi',
  'Jalan Raja Chulan',
]

function simulateSuggestions(query, limit) {
  const q = query.toLowerCase()
  const pool = SIM_HOTEL_NAMES.map((name, i) => ({
    placeId: `sim-place-${hashString(name).toString(36)}`,
    name,
    address: `${10 + (i % 80)} ${STREETS[i % STREETS.length]}, 50250 Kuala Lumpur, Malaysia`,
    lat: null,
    lng: null,
  }))
  const matches = pool.filter(
    (p) => p.name.toLowerCase().includes(q) || p.address.toLowerCase().includes(q),
  )
  if (matches.length) return matches.slice(0, limit)

  // Nothing in the fake pool matches. A real autocomplete answers this by
  // returning the place the query names, so synthesise one from the query
  // instead of offering unrelated hotels — otherwise picking your own property
  // in the demo would silently select someone else's.
  const trimmed = query.trim()
  return [
    {
      placeId: `sim-place-${hashString(trimmed).toString(36)}`,
      name: trimmed.replace(/\b\w/g, (c) => c.toUpperCase()),
      address: `1 ${STREETS[hashString(trimmed) % STREETS.length]}, 50250 Kuala Lumpur, Malaysia`,
      lat: null,
      lng: null,
    },
  ].slice(0, limit)
}

function simulateDetails(placeId) {
  const known = placeId.startsWith('sim-place-')
    ? SIM_HOTEL_NAMES.find((n) => `sim-place-${hashString(n).toString(36)}` === placeId)
    : null

  // Coordinates are derived from the id when the name is not in the fake pool,
  // so a synthesised suggestion still resolves to somewhere on the map.
  const seed = hashString(placeId)
  const i = known ? SIM_HOTEL_NAMES.indexOf(known) : seed % SIM_HOTEL_NAMES.length
  return {
    placeId,
    // The caller already holds the name and address it showed in the dropdown,
    // so an unknown place leaves them null rather than inventing a plausible
    // but wrong one. The client falls back to what the user actually clicked.
    name: known || null,
    address: known ? `${10 + (i % 80)} ${STREETS[i % STREETS.length]}, 50250 Kuala Lumpur, Malaysia` : null,
    city: 'Kuala Lumpur',
    lat: KL_CENTRE.lat + (i % 5) * 0.004 - 0.008,
    lng: KL_CENTRE.lng + Math.floor(i / 5) * 0.004 - 0.008,
    simulated: true,
  }
}

/**
 * Deterministically scatter hotels around the centre. Only those inside the
 * radius come back, so widening the radius visibly grows the comp set.
 */
function simulateNearby({ lat, lng, radiusM, limit }) {
  const rand = seededRandom(hashString(`${lat.toFixed(4)},${lng.toFixed(4)}`))
  const out = []
  for (let i = 0; i < SIM_HOTEL_NAMES.length && out.length < limit; i += 1) {
    // Spread candidates from ~200m out to ~6km so radius changes matter.
    const dist = 200 + rand() * 5800
    const bearing = rand() * Math.PI * 2
    const dLat = (dist * Math.cos(bearing)) / 111320
    const dLng = (dist * Math.sin(bearing)) / (111320 * Math.cos((lat * Math.PI) / 180))
    const hLat = lat + dLat
    const hLng = lng + dLng
    const distance = distanceMeters({ lat, lng }, { lat: hLat, lng: hLng })
    if (distance > radiusM) continue
    const name = SIM_HOTEL_NAMES[i]
    out.push({
      placeId: `sim-place-${hashString(name).toString(36)}`,
      name,
      address: `${10 + (i % 80)} ${STREETS[i % STREETS.length]}, ${
        distance < 3000 ? '50250' : '50480'
      } Kuala Lumpur, Malaysia`,
      lat: hLat,
      lng: hLng,
      rating: Number((3.6 + rand() * 1.4).toFixed(1)),
      reviews: Math.round(80 + rand() * 2400),
      simulated: true,
    })
  }
  return out.sort((a, b) => distanceMeters({ lat, lng }, a) - distanceMeters({ lat, lng }, b))
}

/* --------------------------------------------------- room-type suggestions */

/**
 * Room types a hotel is likely to sell. Used when a newly discovered hotel has
 * no OTA URL resolved yet, so the operator can start linking rooms immediately.
 */
export const COMMON_ROOM_TYPES = [
  'Standard Queen Room',
  'Deluxe Queen Room',
  'Deluxe King Room',
  'Superior Twin Room',
  'Executive Suite',
  'Family Suite',
]

export function suggestRoomTypes(name, seed = '') {
  const rand = seededRandom(hashString(`${name}|${seed}`))
  const count = 3 + Math.floor(rand() * 3)
  const shuffled = [...COMMON_ROOM_TYPES].sort(
    (a, b) => hashString(a + seed) - hashString(b + seed),
  )
  return shuffled.slice(0, count)
}

export { newId }