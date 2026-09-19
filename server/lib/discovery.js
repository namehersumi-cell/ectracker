import { getStore } from '../store.js'
import { nearbyHotels, distanceMeters, suggestRoomTypes, hasMapsKey } from './places.js'
import { resolveOtaUrls, extractRates } from './gemini.js'
import { suggestLinksForHotel } from './room-match.js'
import { OTAS, saveCheckFromExtraction } from './checks.js'
import { checkInDates } from './dates.js'

/**
 * Map-driven competitor discovery.
 *
 * The manual flow this replaces was: find each rival on the map, copy three OTA
 * URLs, then type their room names in by hand. Here the operator sets their
 * property and a radius, and the app proposes the comp set and reads the rooms
 * and rates itself. The only human step left is confirming which of their room
 * names correspond to mine.
 */

export const DEFAULT_RADIUS_M = 2000
export const MIN_RADIUS_M = 200
export const MAX_RADIUS_M = 10000

export function clampRadius(m) {
  const n = Number(m)
  if (!Number.isFinite(n)) return DEFAULT_RADIUS_M
  return Math.max(MIN_RADIUS_M, Math.min(MAX_RADIUS_M, Math.round(n)))
}

/** My hotel's saved map location, or null when the operator has not set it. */
export async function getMyLocation() {
  const store = await getStore()
  const myHotel = (await store.get('settings', 'myHotel')) || {}
  if (myHotel.location?.lat == null || myHotel.location?.lng == null) return null
  return myHotel.location
}

/**
 * Radius scan. Returns hotels found around my property, annotated with whether
 * they are already tracked so the UI can show "already added" instead of
 * offering a duplicate.
 */
export async function scanNearby({ radiusM, lat, lng, limit = 20 } = {}) {
  const store = await getStore()
  const mine = await getMyLocation()
  const centre =
    lat != null && lng != null ? { lat, lng } : mine ? { lat: mine.lat, lng: mine.lng } : null
  if (!centre) {
    return {
      error: 'Set your hotel location first, or supply a centre point.',
      hotels: [],
      scanned: false,
    }
  }

  const radius = clampRadius(radiusM ?? (await getStoredRadius()))
  const existing = await store.list('competitors')
  const myHotel = (await store.get('settings', 'myHotel')) || {}

  const { hotels, simulated } = await nearbyHotels({
    lat: centre.lat,
    lng: centre.lng,
    radiusM: radius,
    limit,
  })

  const byPlaceId = new Map(existing.filter((c) => c.placeId).map((c) => [c.placeId, c]))
  const byName = new Map(existing.map((c) => [c.name.toLowerCase().trim(), c]))

  // In simulated mode the fake provider cannot know about the hotels already in
  // the database, so tracked hotels inside the radius are injected back into the
  // results. Without this the "already tracked" flag would never be exercised
  // and the demo would look like it had forgotten the operator's own comp set.
  let found = hotels
  if (simulated) {
    const seen = new Set(hotels.map((h) => h.name.toLowerCase().trim()))
    const injected = existing
      .filter((c) => c.location?.lat != null && !seen.has(c.name.toLowerCase().trim()))
      .map((c) => ({
        placeId: c.placeId || `tracked-${c.id}`,
        name: c.name,
        address: c.address || null,
        lat: c.location.lat,
        lng: c.location.lng,
        rating: c.rating ?? null,
        reviews: null,
        simulated: true,
      }))
      .filter((h) => distanceMeters(centre, h) <= radius)
    found = [...hotels, ...injected]
  }

  const annotated = found.map((h) => {
    const tracked = byPlaceId.get(h.placeId) || byName.get(h.name.toLowerCase().trim()) || null
    return {
      ...h,
      distanceM: distanceMeters(centre, h),
      alreadyTracked: Boolean(tracked),
      trackedId: tracked?.id || null,
      isMyHotel:
        h.placeId === myHotel.location?.placeId ||
        h.name.toLowerCase().trim() === String(myHotel.name || '').toLowerCase().trim(),
    }
  })

  // My own hotel showing up in its own comp set is confusing, so it is dropped.
  const candidates = annotated
    .filter((h) => !h.isMyHotel)
    .sort((a, b) => a.distanceM - b.distanceM)

  return {
    centre,
    radiusM: radius,
    hotels: candidates,
    count: candidates.length,
    simulated,
    mapsConfigured: hasMapsKey(),
    scanned: true,
  }
}

async function getStoredRadius() {
  const store = await getStore()
  const saved = await store.get('settings', 'discovery')
  return saved?.radiusM ?? DEFAULT_RADIUS_M
}

export async function saveDiscoverySettings({ radiusM }) {
  const store = await getStore()
  return store.set('settings', 'discovery', { radiusM: clampRadius(radiusM) })
}

/**
 * Turn discovered hotels into tracked competitors: resolve each one's OTA
 * pages, then read its rooms and rates across all three OTAs.
 *
 * Failures are per-hotel and per-OTA. One hotel without a Booking.com page must
 * not stop the rest of the comp set from being added.
 */
export async function addDiscoveredHotels({
  hotels = [],
  radiusM,
  onProgress,
} = {}) {
  const store = await getStore()
  const myHotel = (await store.get('settings', 'myHotel')) || { roomTypes: [] }
  const existing = await store.list('competitors')
  const existingNames = new Set(existing.map((c) => c.name.toLowerCase().trim()))
  const existingPlaceIds = new Set(existing.map((c) => c.placeId).filter(Boolean))

  if (radiusM != null) await saveDiscoverySettings({ radiusM })

  const dates = checkInDates()
  const results = []

  for (const h of hotels) {
    const name = String(h.name || '').trim()
    if (!name) continue

    // Skip duplicates by place id first, then by name, so re-running a scan is
    // safe and never creates a second copy of a hotel.
    if (h.placeId && existingPlaceIds.has(h.placeId)) {
      results.push({ name, skipped: true, reason: 'Already tracked' })
      continue
    }
    if (existingNames.has(name.toLowerCase())) {
      results.push({ name, skipped: true, reason: 'Already tracked' })
      continue
    }

    if (onProgress) onProgress({ stage: 'resolve', hotel: name })

    let urlResult = { urls: {}, confident: false, simulated: !hasMapsKey() }
    try {
      urlResult = await resolveOtaUrls({ hotelName: name, address: h.address })
    } catch (err) {
      urlResult.notes = err.message
    }

    const urls = urlResult.urls || {}
    const hasAnyUrl = OTAS.some((o) => urls[o])
    if (!hasAnyUrl) {
      results.push({
        name,
        skipped: true,
        reason: urlResult.notes || 'No OTA pages found for this hotel',
      })
      continue
    }

    const saved = await store.add('competitors', {
      name,
      otaUrls: {
        booking: urls.booking || null,
        agoda: urls.agoda || null,
        tripcom: urls.tripcom || null,
      },
      active: true,
      isOwn: false,
      // Provenance: these came from the map, so later we can re-scan the area.
      source: 'map',
      placeId: h.placeId || null,
      address: h.address || null,
      location: h.lat != null ? { lat: h.lat, lng: h.lng } : null,
      rating: h.rating ?? null,
      discoveredAt: new Date().toISOString(),
      otaResolveConfident: Boolean(urlResult.confident),
      otaResolveNotes: urlResult.notes || null,
      simulated: Boolean(urlResult.simulated),
    })

    existingNames.add(name.toLowerCase())
    if (h.placeId) existingPlaceIds.add(h.placeId)

    // Read rooms and rates for every OTA that resolved, so the operator opens
    // the linking screen with real room names and prices already in place.
    const extraction = []
    let roomNamesSeen = []
    for (const ota of OTAS) {
      if (!urls[ota]) {
        extraction.push({ ota, status: 'skipped', error: 'No URL resolved' })
        continue
      }
      if (onProgress) onProgress({ stage: 'extract', hotel: name, ota })
      const res = await extractRates({
        hotelName: name,
        ota,
        url: urls[ota],
        // No room names supplied: we want whatever the hotel actually sells,
        // not a filtered subset, so the operator sees every room to link.
        roomNames: null,
        dates,
        basePrices: {},
        previous: {},
      })
      extraction.push({
        ota,
        status: res.status,
        error: res.error || null,
        method: res.method,
        simulated: Boolean(res.simulated),
        roomCount: res.roomTypes?.length || 0,
      })
      if (res.status === 'ok') {
        roomNamesSeen = [...new Set([...roomNamesSeen, ...res.roomTypes.map((r) => r.name)])]
        // Persist the readings, not just the names. "Auto-add and track their
        // prices" is the whole point of the feature; storing only names would
        // leave the hotel in the list with no prices until a manual check.
        await saveCheckFromExtraction({
          competitor: { ...saved, name },
          ota,
          extraction: res,
        })
      }
    }

    const discoveredRoomNames = roomNamesSeen.length
      ? roomNamesSeen
      : suggestRoomTypes(name)

    await store.set('competitors', saved.id, { discoveredRoomNames })

    // Propose links so the operator confirms rather than types.
    const suggestions = suggestLinksForHotel({
      myRoomTypes: myHotel.roomTypes || [],
      competitorRoomNames: discoveredRoomNames,
    })

    results.push({
      name,
      competitorId: saved.id,
      address: h.address,
      distanceM: h.distanceM,
      otaUrls: urls,
      extraction,
      discoveredRoomNames,
      suggestions,
      autoLinked: suggestions.filter((s) => s.autoLink).length,
      needsReview: suggestions.filter((s) => !s.autoLink).length,
      simulated: Boolean(urlResult.simulated),
    })
  }

  // Catch-all: any of my room types with no suggestion at all still needs the
  // operator's attention, so it is surfaced rather than silently left unlinked.
  return { results, myRoomTypes: myHotel.roomTypes || [] }
}

/** Backfill OTA URLs and rooms for a competitor that has none yet. */
export async function refreshCompetitorRooms(competitorId) {
  const store = await getStore()
  const competitor = await store.get('competitors', competitorId)
  if (!competitor) return { error: 'Competitor not found' }

  let urls = competitor.otaUrls || {}
  if (!OTAS.some((o) => urls[o])) {
    const resolved = await resolveOtaUrls({
      hotelName: competitor.name,
      address: competitor.address,
    })
    urls = resolved.urls || {}
    await store.set('competitors', competitorId, {
      otaUrls: {
        booking: urls.booking || null,
        agoda: urls.agoda || null,
        tripcom: urls.tripcom || null,
      },
      otaResolveConfident: Boolean(resolved.confident),
      otaResolveNotes: resolved.notes || null,
    })
  }

  const dates = checkInDates()
  const names = new Set(competitor.discoveredRoomNames || [])
  const extraction = []
  for (const ota of OTAS) {
    if (!urls[ota]) {
      extraction.push({ ota, status: 'skipped', error: 'No URL resolved' })
      continue
    }
    const res = await extractRates({
      hotelName: competitor.name,
      ota,
      url: urls[ota],
      roomNames: null,
      dates,
      basePrices: {},
      previous: {},
    })
    extraction.push({
      ota,
      status: res.status,
      error: res.error || null,
      roomCount: res.roomTypes?.length || 0,
    })
    if (res.status === 'ok') {
      for (const r of res.roomTypes) names.add(r.name)
      // Same as the add flow: store the readings so "Find rooms" is not just a
      // discovery of names that the operator then has to pay to fetch again.
      await saveCheckFromExtraction({ competitor, ota, extraction: res })
    }
  }

  const discoveredRoomNames = [...names]
  await store.set('competitors', competitorId, { discoveredRoomNames })
  return { otaUrls: urls, extraction, discoveredRoomNames }
}