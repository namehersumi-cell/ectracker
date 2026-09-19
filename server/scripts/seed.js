/**
 * Seeds a realistic demo dataset: my own hotel, five competitors, room
 * mappings, and ~45 days of price history so the dashboard, calendar heatmap,
 * sparklines and alerts all have something meaningful to render.
 *
 * With history this long the alert engine also has a genuine previous reading
 * to compare against, which is what makes the demo show real SALE/UNDERCUT
 * behaviour rather than empty states.
 */
import { getStore, newId } from '../store.js'
import { todayInKL, addDays, checkInDates } from '../lib/dates.js'
import { normalizeRoomName } from '../lib/alerts.js'

const MY_ROOMS = [
  { name: 'Deluxe Room', basePrice: 160, capacity: 2 },
  { name: 'Twin Room', basePrice: 145, capacity: 2 },
  { name: 'Family Suite', basePrice: 260, capacity: 4 },
]

/**
 * Roughly real Kuala Lumpur coordinates, spaced so the map shows a sensible
 * comp set inside a 2 km radius of my hotel.
 */
const KL_ORIGIN = { lat: 3.1478, lng: 101.7009 }

const COMPETITORS = [
  {
    name: 'The Sterling Hotel',
    isOwn: false,
    coords: { lat: 3.1502, lng: 101.7032 },
    address: '18 Jalan Sultan Ismail, 50250 Kuala Lumpur, Malaysia',
    otaUrls: {
      booking: 'https://www.booking.com/hotel/my/the-sterling.html',
      agoda: 'https://www.agoda.com/the-sterling-hotel/hotel/kuala-lumpur-my.html',
      tripcom: 'https://www.trip.com/hotels/detail/?hotelId=sterling-kl',
    },
    prices: { 'Deluxe Room': 152, 'Twin Room': 138, 'Family Suite': 245 },
    rooms: ['Deluxe Room', 'Twin Room', 'Family Suite'],
  },
  {
    name: 'Marina Bay Suites',
    isOwn: false,
    coords: { lat: 3.1455, lng: 101.6988 },
    address: '11 Jalan Bukit Bintang, 55100 Kuala Lumpur, Malaysia',
    otaUrls: {
      booking: 'https://www.booking.com/hotel/my/marina-bay-suites.html',
      agoda: 'https://www.agoda.com/marina-bay-suites/hotel/kuala-lumpur-my.html',
      tripcom: null,
    },
    prices: { 'Deluxe Room': 143, 'Twin Room': 150, 'Family Suite': 268 },
    rooms: ['Deluxe Room', 'Twin Room', 'Family Suite'],
  },
  {
    name: 'Casa Del Rio',
    isOwn: false,
    coords: { lat: 3.1526, lng: 101.6962 },
    address: '4 Jalan Ampang, 50450 Kuala Lumpur, Malaysia',
    otaUrls: {
      booking: 'https://www.booking.com/hotel/my/casa-del-rio.html',
      agoda: null,
      tripcom: 'https://www.trip.com/hotels/detail/?hotelId=casa-del-rio',
    },
    prices: { 'Deluxe Room': 168, 'Twin Room': 132, 'Family Suite': 240 },
    rooms: ['Deluxe Room', 'Twin Room', 'Family Suite'],
  },
  {
    name: 'The Robertson',
    isOwn: false,
    coords: { lat: 3.1431, lng: 101.7055 },
    address: '22 Jalan Pudu, 55100 Kuala Lumpur, Malaysia',
    otaUrls: {
      booking: 'https://www.booking.com/hotel/my/the-robertson.html',
      agoda: 'https://www.agoda.com/the-robertson/hotel/kuala-lumpur-my.html',
      tripcom: 'https://www.trip.com/hotels/detail/?hotelId=robertson',
    },
    prices: { 'Deluxe Room': 158, 'Twin Room': 141, 'Family Suite': 255 },
    rooms: ['Deluxe Room', 'Twin Room', 'Family Suite'],
  },
  {
    name: 'Hotel Sri Petaling',
    isOwn: false,
    active: true,
    coords: { lat: 3.1385, lng: 101.6905 },
    address: '88 Jalan Tun Razak, 50400 Kuala Lumpur, Malaysia',
    otaUrls: {
      booking: 'https://www.booking.com/hotel/my/sri-petaling.html',
      agoda: null,
      tripcom: null,
    },
    prices: { 'Deluxe Room': 136, 'Twin Room': 128, 'Family Suite': 230 },
    rooms: ['Deluxe Room', 'Twin Room'],
  },
]

// Per-OTA personality: OTAs price differently, and one of them is deliberately
// flaky so the failure watchdog and "verify manually" badges are exercised.
const OTA_BIAS = { booking: 1.0, agoda: 0.97, tripcom: 1.04 }

function seeded(seed) {
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

async function seed() {
  const store = await getStore()
  const today = todayInKL()

  const myHotel = {
    name: 'Rumah Ku Boutique Hotel',
    roomTypes: MY_ROOMS.map((r) => ({ id: newId(), ...r })),
    // Pre-set so the map and radius discovery work on first run.
    location: {
      lat: KL_ORIGIN.lat,
      lng: KL_ORIGIN.lng,
      address: '12 Jalan Sultan Ismail, 50250 Kuala Lumpur, Malaysia',
      city: 'Kuala Lumpur',
      placeId: 'seed-rumah-ku',
    },
  }
  await store.set('settings', 'myHotel', myHotel)
  await store.set('settings', 'discovery', { radiusM: 2000 })

  const compIds = {}
  for (const comp of COMPETITORS) {
    const saved = await store.add('competitors', {
      name: comp.name,
      otaUrls: comp.otaUrls,
      active: comp.active !== false,
      isOwn: Boolean(comp.isOwn),
      source: 'map',
      address: comp.address,
      location: comp.coords,
      discoveredRoomNames: comp.rooms,
    })
    compIds[comp.name] = saved.id
  }

  // The spec's manual checklist: track your own hotel so you get free accuracy
  // and OTA-parity monitoring.
  const own = await store.add('competitors', {
    name: myHotel.name,
    otaUrls: {
      booking: 'https://www.booking.com/hotel/my/rumah-ku-boutique.html',
      agoda: 'https://www.agoda.com/rumah-ku-boutique/hotel/kuala-lumpur-my.html',
      tripcom: null,
    },
    active: true,
    isOwn: true,
    source: 'map',
    address: myHotel.location.address,
    location: { lat: KL_ORIGIN.lat, lng: KL_ORIGIN.lng },
    discoveredRoomNames: MY_ROOMS.map((r) => r.name),
  })

  for (const comp of [...COMPETITORS, { name: myHotel.name, rooms: MY_ROOMS.map((r) => r.name) }]) {
    const competitorId = comp.name === myHotel.name ? own.id : compIds[comp.name]
    for (const myRoom of myHotel.roomTypes) {
      if (!comp.rooms.includes(myRoom.name)) continue
      await store.add('roomMappings', {
        competitorId,
        myRoomTypeId: myRoom.id,
        otaRoomName: myRoom.name,
      })
    }
  }

  const allCompetitors = [
    ...COMPETITORS.map((c) => ({ ...c, id: compIds[c.name] })),
    {
      name: myHotel.name,
      id: own.id,
      // Without this the alert loop below treats our own hotel as a rival and
      // seeds "you sold a room" alerts, which is noise on the dashboard.
      isOwn: true,
      prices: Object.fromEntries(MY_ROOMS.map((r) => [r.name, r.basePrice])),
      otaUrls: { booking: 'x', agoda: 'x', tripcom: null },
      rooms: MY_ROOMS.map((r) => r.name),
    },
  ]

  const DAYS = 45
  let checks = 0
  let alerts = 0

  for (let d = DAYS; d >= 0; d -= 1) {
    const day = addDays(today, -d)
    const dayDate = new Date(`${day}T09:00:00Z`)
    for (const comp of allCompetitors) {
      for (const [ota, url] of Object.entries(comp.otaUrls)) {
        if (!url) continue

        // Simulated Trip.com outage window, to prove one OTA failing never
        // takes down the others and to trip the consecutive-failure watchdog.
        if (ota === 'tripcom' && d <= 2) {
          const checkId = newId()
          await store.set('priceChecks', checkId, {
            id: checkId,
            competitorId: comp.id,
            competitorName: comp.name,
            ota,
            otaLabel: { booking: 'Booking.com', agoda: 'Agoda', tripcom: 'Trip.com' }[ota],
            checkedAt: dayDate.toISOString(),
            status: 'error',
            error: 'Page layout changed — no room types could be read',
            roomTypes: [],
            simulated: true,
          })
          await store.set('otaHealth', ota, {
            ota,
            otaLabel: 'Trip.com',
            consecutiveFailures: DAYS - d + 3,
            lastError: 'Page layout changed — no room types could be read',
            lastFailureAt: dayDate.toISOString(),
            lastSuccessAt: addDays(today, -3),
          })
          checks += 1
          continue
        }

        const rand = seeded(`${comp.name}|${ota}|${day}`)
        const rows = []
        for (const stay of checkInDates(day)) {
          for (const room of comp.rooms) {
            const base = comp.prices[room] || 150
            const lead = stay.offset === 0 ? 1.05 : stay.offset === 7 ? 1.0 : 0.95
            const dow = new Date(`${stay.date}T00:00:00Z`).getUTCDay()
            const weekend = [0, 6].includes(dow) ? 1.11 : 1
            const noise = 0.92 + rand() * 0.17
            // A slow trend so the heatmap and sparklines show real movement.
            const trend = 1 + d * 0.0018
            const price = Math.round((base * OTA_BIAS[ota] * lead * weekend * noise * trend) / 2) * 2
            const soldOut = rand() > 0.95
            const roomsLeft = soldOut ? 0 : Math.max(1, Math.round(9 - rand() * 8))
            rows.push({
              name: room,
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

        const hasSuspect = rand() > 0.96
        if (hasSuspect && rows.length) {
          rows[0] = {
            ...rows[0],
            suspect: true,
            suspectReason: 'price moved 61% since last check (RM 150 → RM 242)',
          }
        }

        const checkId = newId()
        await store.set('priceChecks', checkId, {
          id: checkId,
          competitorId: comp.id,
          competitorName: comp.name,
          ota,
          otaLabel: { booking: 'Booking.com', agoda: 'Agoda', tripcom: 'Trip.com' }[ota],
          checkedAt: dayDate.toISOString(),
          status: hasSuspect ? 'suspect' : 'ok',
          error: null,
          method: 'url_context',
          simulated: true,
          roomTypes: rows,
        })
        checks += 1

        // Seed a handful of alerts along the way so the History and Dashboard
        // panels are populated.
        if (d < 20 && rand() > 0.86 && !comp.isOwn) {
          const room = comp.rooms[Math.floor(rand() * comp.rooms.length)]
          const price = comp.prices[room] || 150
          const undercut = price < (MY_ROOMS.find((r) => r.name === room)?.basePrice || 160) - 10
          const type = undercut ? 'UNDERCUT' : rand() > 0.5 ? 'SALE' : 'PRICE_DROP'
          const otaLabel = { booking: 'Booking.com', agoda: 'Agoda', tripcom: 'Trip.com' }[ota]
          const mine = MY_ROOMS.find((r) => r.name === room)?.basePrice || 160
          const alertId = newId()
          await store.set('alerts', alertId, {
            id: alertId,
            type,
            competitorId: comp.id,
            competitorName: comp.name,
            ota,
            otaLabel: { booking: 'Booking.com', agoda: 'Agoda', tripcom: 'Trip.com' }[ota],
            roomType: room,
            otaRoomName: room,
            checkInDate: today,
            checkInLabel: 'Tonight',
            price,
            myPrice: type === 'UNDERCUT' ? mine : null,
            roomsLeft: 2,
            message:
              type === 'UNDERCUT'
                ? `🔴 ${comp.name} dropped ${room} to RM ${price} on ${otaLabel} (Tonight) — RM ${mine - price} below your RM ${mine}.`
                : type === 'SALE'
                  ? `🟡 ${comp.name} sold 2× ${room} at ~RM ${price} on ${otaLabel} (Tonight). 2 left.`
                  : `📉 ${comp.name} dropped ${room} to RM ${price} on ${otaLabel} (Tonight).`,
            read: d > 1,
            notify: true,
            notified: true,
            createdAt: dayDate.toISOString(),
          })
          alerts += 1
        }
      }
    }
  }

  await store.set('settings', 'handover', {
    current: {
      id: newId(),
      text: 'Raised Deluxe to RM 180 for the weekend. Watch Marina Bay Suites — they drop Twin rates late at night.',
      author: 'Azlin',
      createdAt: new Date().toISOString(),
    },
    notes: [
      {
        id: newId(),
        text: 'Raised Deluxe to RM 180 for the weekend. Watch Marina Bay Suites — they drop Twin rates late at night.',
        author: 'Azlin',
        createdAt: new Date().toISOString(),
      },
      {
        id: newId(),
        text: 'Casa Del Rio sold out Friday and Saturday. Hold rates.',
        author: 'Front desk',
        createdAt: addDays(new Date().toISOString().slice(0, 10), -1),
      },
    ],
  })

  await store.set('meta', 'geminiUsage', { date: today, count: 42 })

  console.log(
    `Seeded ${allCompetitors.length} hotels (1 = your own), ${checks} checks, ${alerts} alerts, ${DAYS + 1} days of history.`,
  )
  console.log('Room mapping sample:', normalizeRoomName('Deluxe Room'))
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})