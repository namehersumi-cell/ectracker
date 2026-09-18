/**
 * Tests for the per-room-type / per-OTA price matrix.
 *
 * This is the table the operator prices against, so the tests focus on the two
 * ways it can mislead: telling them they are competitive when they are not, and
 * dropping an OTA from the table because its last successful check was not run
 * today.
 *
 * Run with: node --test server/test/
 */
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ectrackr-matrix-'))
process.env.DATA_DIR = TMP
delete process.env.GEMINI_API_KEY

const { getStore, newId } = await import('../store.js')
const { getRoomPriceMatrix } = await import('../lib/checks.js')
const { addDays, todayInKL } = await import('../lib/dates.js')

const TODAY = todayInKL()

async function reset() {
  const store = await getStore()
  for (const col of ['settings', 'competitors', 'priceChecks', 'roomMappings']) {
    for (const row of await store.list(col)) await store.delete(col, row.id)
  }
  return store
}

/** One check row holding room readings for the given stay offsets. */
function checkRow({
  competitorId,
  competitorName,
  ota,
  offset = 0,
  roomName,
  price,
  daysAgo = 0,
  readings,
}) {
  const runDate = addDays(TODAY, -daysAgo)
  const rows = readings || [{ offset, price, roomName }]
  return {
    id: newId(),
    competitorId,
    competitorName,
    ota,
    otaLabel: ota,
    status: 'ok',
    checkedAt: `${runDate}T09:00:00.000Z`,
    roomTypes: rows.map((r) => ({
      name: r.roomName || roomName,
      price: r.price,
      currency: 'MYR',
      roomsLeft: 4,
      soldOut: false,
      checkInDate: addDays(runDate, r.offset),
      checkOutDate: addDays(runDate, r.offset + 1),
    })),
  }
}

let store

describe('room price matrix', () => {
  beforeEach(async () => {
    store = await reset()
    await store.set('settings', 'myHotel', {
      name: 'My Hotel',
      roomTypes: [{ id: 'mine-1', name: 'Deluxe Room', basePrice: 160, capacity: 2 }],
    })
  })

  afterEach(async () => {
    await reset()
  })

  test('market low comes from every competitor, not just the headline OTA cell', async () => {
    // A rival is cheaper on an OTA that is not the headline for any row. The
    // matrix must still report RM 150 as the market low, otherwise it would tell
    // the operator they are below market when they are not.
    const cheap = await store.add('competitors', { name: 'Cheap Rival', otaUrls: { booking: 'x' } })
    const pricey = await store.add('competitors', { name: 'Pricey Rival', otaUrls: { booking: 'x' } })

    await store.add('priceChecks', checkRow({ competitorId: cheap.id, competitorName: 'Cheap Rival', ota: 'agoda', roomName: 'Deluxe Room', price: 150 }))
    await store.add('priceChecks', checkRow({ competitorId: pricey.id, competitorName: 'Pricey Rival', ota: 'booking', roomName: 'Deluxe Room', price: 220 }))
    await store.add('priceChecks', checkRow({ competitorId: pricey.id, competitorName: 'Pricey Rival', ota: 'agoda', roomName: 'Deluxe Room', price: 230 }))

    const { rooms } = await getRoomPriceMatrix({ offset: 0 })
    const room = rooms[0]
    assert.equal(room.marketLow, 150, 'market low must include the cheap rival')
    assert.equal(room.marketLowHotel, 'Cheap Rival')
    // RM 160 vs a RM 150 market low is above market, and must say so.
    assert.equal(room.myPriceVsMarket, 10)
  })

  test('an OTA is still reported when its last success was days ago', async () => {
    // Check-in dates are absolute, so a check run 3 days ago holds a "tonight"
    // of 3 days ago. Matching on the date would drop Trip.com entirely.
    const rival = await store.add('competitors', { name: 'Rival', otaUrls: { booking: 'x' } })
    await store.add('priceChecks', checkRow({ competitorId: rival.id, competitorName: 'Rival', ota: 'booking', roomName: 'Deluxe Room', price: 200, daysAgo: 0 }))
    await store.add('priceChecks', checkRow({ competitorId: rival.id, competitorName: 'Rival', ota: 'tripcom', roomName: 'Deluxe Room', price: 180, daysAgo: 3 }))

    const { rooms } = await getRoomPriceMatrix({ offset: 0 })
    assert.equal(rooms[0].otas.tripcom.price, 180, 'stale-but-successful OTA was dropped')
    assert.equal(rooms[0].otas.booking.price, 200)
  })

  test('stays are separated by offset, not confused across dates', async () => {
    const rival = await store.add('competitors', { name: 'Rival', otaUrls: { booking: 'x' } })
    // A real check holds every stay in one row.
    await store.add('priceChecks', checkRow({
      competitorId: rival.id,
      competitorName: 'Rival',
      ota: 'booking',
      roomName: 'Deluxe Room',
      readings: [
        { offset: 0, price: 200 },
        { offset: 7, price: 175 },
        { offset: 30, price: 140 },
      ],
    }))

    const tonight = await getRoomPriceMatrix({ offset: 0 })
    const nextWeek = await getRoomPriceMatrix({ offset: 7 })
    const nextMonth = await getRoomPriceMatrix({ offset: 30 })
    assert.equal(tonight.rooms[0].otas.booking.price, 200)
    assert.equal(nextWeek.rooms[0].otas.booking.price, 175)
    assert.equal(nextMonth.rooms[0].otas.booking.price, 140)
  })

  test('my own listing never hides a cheaper competitor on the headline row', async () => {
    const mine = await store.add('competitors', { name: 'My Hotel', isOwn: true, otaUrls: { booking: 'x' } })
    const rival = await store.add('competitors', { name: 'Rival', otaUrls: { booking: 'x' } })
    await store.add('priceChecks', checkRow({ competitorId: mine.id, competitorName: 'My Hotel', ota: 'booking', roomName: 'Deluxe Room', price: 155 }))
    await store.add('priceChecks', checkRow({ competitorId: rival.id, competitorName: 'Rival', ota: 'booking', roomName: 'Deluxe Room', price: 170 }))

    const { rooms } = await getRoomPriceMatrix({ offset: 0 })
    assert.equal(rooms[0].otas.booking.price, 155, 'cheapest listing wins the headline cell')
    assert.equal(rooms[0].otas.booking.competitorIsOwn, true)
  })

  test('a linked room name is matched even when it differs from mine', async () => {
    const rival = await store.add('competitors', { name: 'Rival', otaUrls: { booking: 'x' } })
    await store.add('roomMappings', {
      competitorId: rival.id,
      myRoomTypeId: 'mine-1',
      otaRoomName: 'STANDARD QUEEN ROOM',
    })
    await store.add('priceChecks', checkRow({ competitorId: rival.id, competitorName: 'Rival', ota: 'booking', roomName: 'STANDARD QUEEN ROOM', price: 149 }))

    const { rooms } = await getRoomPriceMatrix({ offset: 0 })
    assert.equal(rooms[0].otas.booking.price, 149, 'explicit link was not honoured')
  })

  test('suspect readings are excluded from the comparison', async () => {
    const rival = await store.add('competitors', { name: 'Rival', otaUrls: { booking: 'x' } })
    const row = checkRow({ competitorId: rival.id, competitorName: 'Rival', ota: 'booking', roomName: 'Deluxe Room', price: 90 })
    row.roomTypes[0].suspect = true
    await store.add('priceChecks', row)

    const { rooms } = await getRoomPriceMatrix({ offset: 0 })
    assert.equal(rooms[0].otas.booking.price, null, 'a suspect price must not be shown as fact')
    assert.equal(rooms[0].marketLow, null)
  })
})

describe('saving an extraction', () => {
  beforeEach(async () => {
    store = await reset()
    await store.set('settings', 'myHotel', {
      name: 'My Hotel',
      roomTypes: [{ id: 'mine-1', name: 'Deluxe Room', basePrice: 160, capacity: 2 }],
    })
  })

  afterEach(async () => {
    await reset()
  })

  const extraction = () => ({
    status: 'ok',
    method: 'simulated',
    simulated: true,
    roomTypes: [
      {
        name: 'Deluxe Room',
        price: 175,
        currency: 'MYR',
        roomsLeft: 3,
        soldOut: false,
        checkInDate: addDays(TODAY, 0),
        checkOutDate: addDays(TODAY, 1),
      },
    ],
  })

  test('a saved extraction is immediately visible in the matrix', async () => {
    // The discovery flow adds hotels and reads their rates; if those readings
    // were not persisted, the hotel would show room names but no prices.
    const rival = await store.add('competitors', { name: 'Rival', otaUrls: { booking: 'x' } })
    const { saveCheckFromExtraction } = await import('../lib/checks.js')

    await saveCheckFromExtraction({
      competitor: rival,
      ota: 'booking',
      extraction: extraction(),
    })

    const { rooms } = await getRoomPriceMatrix({ offset: 0 })
    assert.equal(rooms[0].otas.booking.price, 175, 'saved price did not reach the matrix')
    assert.equal(rooms[0].marketLow, 175)
  })

  test('a convertible foreign price is converted, not compared raw', async () => {
    // The guard must not be bypassable by saving through discovery instead of
    // the scheduled check pipeline. A "$45" reading is ~RM 200, never RM 45.
    const rival = await store.add('competitors', { name: 'Rival', otaUrls: { booking: 'x' } })
    const { saveCheckFromExtraction } = await import('../lib/checks.js')

    const usd = extraction()
    usd.roomTypes[0].currency = 'USD'
    usd.roomTypes[0].price = 45
    const check = await saveCheckFromExtraction({ competitor: rival, ota: 'booking', extraction: usd })

    const room = check.roomTypes[0]
    assert.equal(room.originalCurrency, 'USD')
    assert.equal(room.originalPrice, 45)
    assert.ok(room.price > 100, `USD 45 became RM ${room.price}, which is not a conversion`)
  })

  test('an unconvertible currency is flagged suspect and kept out of the matrix', async () => {
    const rival = await store.add('competitors', { name: 'Rival', otaUrls: { booking: 'x' } })
    const { saveCheckFromExtraction } = await import('../lib/checks.js')

    const exotic = extraction()
    exotic.roomTypes[0].currency = 'XYZ'
    const check = await saveCheckFromExtraction({ competitor: rival, ota: 'booking', extraction: exotic })

    assert.ok(check.roomTypes[0].suspect, 'an unknown currency must never be trusted')
    const { rooms } = await getRoomPriceMatrix({ offset: 0 })
    assert.equal(rooms[0].marketLow, null, 'a suspect price leaked into the comparison')
  })
})