/**
 * Tests for the alert engine and its guards. These cover the logic that can
 * actually cost the hotel money if it's wrong: currency mixing, the >40%
 * sanity check, dedup, cross-OTA merging, and undercut detection.
 *
 * Run with: node --test server/test/
 */
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// The store reads DATA_DIR at import time, so point it at a scratch directory
// before anything else is loaded.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hoteltrackr-test-'))
process.env.DATA_DIR = TMP
process.env.CRON_SECRET = 'test-secret'
delete process.env.GEMINI_API_KEY // force the simulated extractor

const {
  normalizeRoomName,
  roomNamesMatch,
  applyCurrencyGuard,
  flagSuspicious,
  detectAlerts,
  UNDERCUT_THRESHOLD,
  SUSPECT_DEVIATION,
} = await import('../lib/alerts.js')
const { getStore } = await import('../store.js')
const { checkInDates, addDays, isWithinQuietHours, klDateString } = await import('../lib/dates.js')

afterEach(() => {
  for (const f of fs.readdirSync(TMP)) fs.rmSync(path.join(TMP, f), { force: true })
})

describe('room name matching', () => {
  test('normalizes OTA naming noise', () => {
    assert.equal(normalizeRoomName('Deluxe Room'), 'deluxe')
    assert.equal(normalizeRoomName('DELUXE  room, with breakfast'), 'deluxe')
    assert.equal(normalizeRoomName('The Twin Room'), 'twin')
  })

  test('matches OTAs that rename the same room', () => {
    assert.ok(roomNamesMatch('Deluxe Room', 'Deluxe'))
    assert.ok(roomNamesMatch('Deluxe', 'Deluxe Room'))
    assert.ok(roomNamesMatch('Family Suite Room', 'Family Suite'))
  })

  test('does not match genuinely different rooms', () => {
    assert.equal(roomNamesMatch('Deluxe Room', 'Twin Room'), false)
    assert.equal(roomNamesMatch('Suite', 'Standard'), false)
  })
})

describe('currency guard', () => {
  test('leaves MYR untouched', () => {
    const out = applyCurrencyGuard({ name: 'Deluxe', price: 150, currency: 'MYR' })
    assert.equal(out.price, 150)
    assert.equal(out.currency, 'MYR')
    assert.ok(!out.suspect)
  })

  test('converts a known foreign currency instead of treating it as RM', () => {
    const out = applyCurrencyGuard({ name: 'Deluxe', price: 45, currency: 'USD' })
    // The spec's exact fear: "$45" must never be read as RM 45.
    assert.notEqual(out.price, 45)
    assert.equal(out.converted, true)
    assert.equal(out.originalCurrency, 'USD')
    assert.equal(out.originalPrice, 45)
    assert.ok(out.price > 200 && out.price < 220)
  })

  test('flags an unknown currency as suspect rather than guessing', () => {
    const out = applyCurrencyGuard({ name: 'Deluxe', price: 45, currency: 'XYZ' })
    assert.equal(out.suspect, true)
    assert.match(out.suspectReason, /^currency: XYZ/)
  })
})

describe('sanity check', () => {
  test('flags a swing larger than the deviation threshold', () => {
    const out = flagSuspicious({ name: 'Deluxe', price: 242 }, { price: 150 })
    assert.equal(out.suspect, true)
    assert.match(out.suspectReason, /61%/)
  })

  test('allows a normal movement', () => {
    const out = flagSuspicious({ name: 'Deluxe', price: 158 }, { price: 150 })
    assert.ok(!out.suspect)
  })

  test('is a no-op without a previous reading', () => {
    const out = flagSuspicious({ name: 'Deluxe', price: 999 }, null)
    assert.ok(!out.suspect)
  })

  test('threshold is the documented 40%', () => {
    assert.equal(SUSPECT_DEVIATION, 0.4)
  })
})

describe('check-in dates', () => {
  test('covers tonight, +7d and +30d', () => {
    const dates = checkInDates('2026-03-01')
    assert.deepEqual(
      dates.map((d) => d.date),
      ['2026-03-01', '2026-03-08', '2026-03-31'],
    )
    assert.deepEqual(dates.map((d) => d.label), ['Tonight', '+7d', '+30d'])
  })

  test('handles month boundaries', () => {
    assert.equal(addDays('2026-01-31', 1), '2026-02-01')
    assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  })
})

describe('quiet hours', () => {
  test('detects a window that wraps past midnight', () => {
    const at = (h, m = 0) => new Date(Date.UTC(2026, 0, 1, h - 8, m)) // 8h offset -> KL hour h
    assert.equal(isWithinQuietHours(at(23), 23 * 60, 7 * 60), true)
    assert.equal(isWithinQuietHours(at(2), 23 * 60, 7 * 60), true)
    assert.equal(isWithinQuietHours(at(6, 59), 23 * 60, 7 * 60), true)
    assert.equal(isWithinQuietHours(at(7), 23 * 60, 7 * 60), false)
    assert.equal(isWithinQuietHours(at(14), 23 * 60, 7 * 60), false)
  })
})

/** Build a check document the way the pipeline would. */
function makeCheck({ competitorId, ota, rooms, status = 'ok' }) {
  return {
    id: `check-${Math.random().toString(36).slice(2)}`,
    competitorId,
    ota,
    otaLabel: { booking: 'Booking.com', agoda: 'Agoda', tripcom: 'Trip.com' }[ota],
    checkedAt: new Date().toISOString(),
    status,
    roomTypes: rooms,
  }
}

const MY_HOTEL = {
  name: 'My Hotel',
  roomTypes: [{ id: 'my-deluxe', name: 'Deluxe Room', basePrice: 160, capacity: 2 }],
}

const COMPETITOR = { id: 'comp-1', name: 'Hotel B', otaUrls: { booking: 'x', agoda: 'y' } }

async function seedPrevious(rooms, { ota = 'booking', competitorId = 'comp-1' } = {}) {
  const store = await getStore()
  await store.set('priceChecks', `prev-${ota}`, makeCheck({ competitorId, ota, rooms }))
}

describe('alert detection', () => {
  beforeEach(async () => {
    const store = await getStore()
    for (const col of ['priceChecks', 'alerts', 'alertEvents', 'roomMappings']) {
      for (const row of await store.list(col)) await store.delete(col, row.id)
    }
  })

  test('SALE fires when inventory decreases, using the last known price', async () => {
    const today = checkInDates()[0].date
    await seedPrevious([
      { name: 'Deluxe Room', price: 150, currency: 'MYR', roomsLeft: 4, soldOut: false, checkInDate: today },
    ])
    const check = makeCheck({
      competitorId: 'comp-1',
      ota: 'booking',
      rooms: [
        { name: 'Deluxe Room', price: 150, currency: 'MYR', roomsLeft: 2, soldOut: false, checkInDate: today },
      ],
    })
    const alerts = await detectAlerts({ check, competitor: COMPETITOR, myHotel: MY_HOTEL, mappings: [] })
    const sale = alerts.find((a) => a.type === 'SALE')
    assert.ok(sale, 'expected a SALE alert')
    assert.equal(sale.price, 150)
    assert.equal(sale.roomsLeft, 2)
    assert.match(sale.message, /sold 2×/)
    assert.equal(sale.read, false)
  })

  test('SOLDOUT fires only when the room was previously available', async () => {
    const today = checkInDates()[0].date
    await seedPrevious([
      { name: 'Deluxe Room', price: 150, currency: 'MYR', roomsLeft: 2, soldOut: false, checkInDate: today },
    ])
    const check = makeCheck({
      competitorId: 'comp-1',
      ota: 'booking',
      rooms: [
        { name: 'Deluxe Room', price: 0, currency: 'MYR', roomsLeft: 0, soldOut: true, checkInDate: today },
      ],
    })
    const alerts = await detectAlerts({ check, competitor: COMPETITOR, myHotel: MY_HOTEL, mappings: [] })
    const soldOut = alerts.find((a) => a.type === 'SOLDOUT')
    assert.ok(soldOut, 'expected a SOLDOUT alert')
    assert.equal(soldOut.price, 150)
  })

  test('UNDERCUT fires at the RM 10 threshold, using my mapped rate', async () => {
    const today = checkInDates()[0].date
    const check = makeCheck({
      competitorId: 'comp-1',
      ota: 'booking',
      rooms: [
        { name: 'Deluxe Room', price: 150, currency: 'MYR', roomsLeft: 5, soldOut: false, checkInDate: today },
      ],
    })
    const alerts = await detectAlerts({ check, competitor: COMPETITOR, myHotel: MY_HOTEL, mappings: [] })
    const undercut = alerts.find((a) => a.type === 'UNDERCUT')
    assert.ok(undercut, 'expected an UNDERCUT alert at exactly RM 10 below')
    assert.equal(undercut.myPrice, 160)
    assert.equal(undercut.price, 150)
    assert.match(undercut.message, /RM 10 below your RM 160/)
  })

  test('does not undercut below the RM 10 threshold', async () => {
    const today = checkInDates()[0].date
    const check = makeCheck({
      competitorId: 'comp-1',
      ota: 'booking',
      rooms: [
        { name: 'Deluxe Room', price: 151, currency: 'MYR', roomsLeft: 5, soldOut: false, checkInDate: today },
      ],
    })
    const alerts = await detectAlerts({ check, competitor: COMPETITOR, myHotel: MY_HOTEL, mappings: [] })
    assert.equal(alerts.find((a) => a.type === 'UNDERCUT'), undefined)
    assert.equal(UNDERCUT_THRESHOLD, 10)
  })

  test('suspect readings never create alerts', async () => {
    const today = checkInDates()[0].date
    const check = makeCheck({
      competitorId: 'comp-1',
      ota: 'booking',
      status: 'suspect',
      rooms: [
        {
          name: 'Deluxe Room',
          price: 90,
          currency: 'MYR',
          roomsLeft: 1,
          soldOut: false,
          checkInDate: today,
          suspect: true,
          suspectReason: 'price moved 70% since last check',
        },
      ],
    })
    const alerts = await detectAlerts({ check, competitor: COMPETITOR, myHotel: MY_HOTEL, mappings: [] })
    assert.equal(alerts.length, 0)
  })

  test('dedup: the same event does not fire twice on the same day', async () => {
    const today = checkInDates()[0].date
    const check = makeCheck({
      competitorId: 'comp-1',
      ota: 'booking',
      rooms: [
        { name: 'Deluxe Room', price: 150, currency: 'MYR', roomsLeft: 5, soldOut: false, checkInDate: today },
      ],
    })
    const first = await detectAlerts({ check, competitor: COMPETITOR, myHotel: MY_HOTEL, mappings: [] })
    assert.ok(first.some((a) => a.type === 'UNDERCUT'))
    const second = await detectAlerts({ check, competitor: COMPETITOR, myHotel: MY_HOTEL, mappings: [] })
    assert.equal(second.length, 0, 'second identical run must not duplicate the alert')
  })

  test('cross-OTA dedup merges the same event into one alert', async () => {
    const today = checkInDates()[0].date
    const bookingCheck = makeCheck({
      competitorId: 'comp-1',
      ota: 'booking',
      rooms: [
        { name: 'Deluxe Room', price: 150, currency: 'MYR', roomsLeft: 5, soldOut: false, checkInDate: today },
      ],
    })
    const agodaCheck = makeCheck({
      competitorId: 'comp-1',
      ota: 'agoda',
      rooms: [
        { name: 'Deluxe Room', price: 148, currency: 'MYR', roomsLeft: 5, soldOut: false, checkInDate: today },
      ],
    })
    const first = await detectAlerts({ check: bookingCheck, competitor: COMPETITOR, myHotel: MY_HOTEL, mappings: [] })
    assert.equal(first.length, 1)

    const store = await getStore()
    const before = (await store.list('alerts')).length
    const second = await detectAlerts({ check: agodaCheck, competitor: COMPETITOR, myHotel: MY_HOTEL, mappings: [] })

    assert.equal(second.length, 0, 'the second OTA should not create a new alert')
    assert.equal((await store.list('alerts')).length, before, 'no new alert document')
    const merged = await store.get('alerts', first[0].id)
    assert.ok(merged.mergedOtas.includes('Agoda'), 'the existing alert should record the merged OTA')
  })

  test('different check-in dates are tracked independently', async () => {
    const [tonight, plus7] = checkInDates()
    const check = makeCheck({
      competitorId: 'comp-1',
      ota: 'booking',
      rooms: [
        { name: 'Deluxe Room', price: 150, currency: 'MYR', roomsLeft: 5, soldOut: false, checkInDate: tonight.date },
        { name: 'Deluxe Room', price: 150, currency: 'MYR', roomsLeft: 5, soldOut: false, checkInDate: plus7.date },
      ],
    })
    const alerts = await detectAlerts({ check, competitor: COMPETITOR, myHotel: MY_HOTEL, mappings: [] })
    const undercuts = alerts.filter((a) => a.type === 'UNDERCUT')
    assert.equal(undercuts.length, 2, 'one undercut per check-in date, not a single merged one')
    assert.deepEqual(
      undercuts.map((a) => a.checkInLabel).sort(),
      ['+7d', 'Tonight'],
    )
  })

  test('my own hotel never undercuts itself', async () => {
    const today = checkInDates()[0].date
    const check = makeCheck({
      competitorId: 'comp-own',
      ota: 'booking',
      rooms: [
        { name: 'Deluxe Room', price: 120, currency: 'MYR', roomsLeft: 5, soldOut: false, checkInDate: today },
      ],
    })
    // My own hotel, priced well below my own published rate.
    const alerts = await detectAlerts({
      check,
      competitor: { id: 'comp-own', name: 'My Hotel', isOwn: true, otaUrls: { booking: 'x' } },
      myHotel: MY_HOTEL,
      mappings: [],
    })
    assert.equal(
      alerts.find((a) => a.type === 'UNDERCUT'),
      undefined,
      'a self-comparison is not an undercut — tracking yourself is for OTA parity only',
    )
  })

  test('tracking my own hotel still reports OTA parity problems', async () => {
    const today = checkInDates()[0].date
    await seedPrevious(
      [
        { name: 'Deluxe Room', price: 160, currency: 'MYR', roomsLeft: 4, soldOut: false, checkInDate: today },
      ],
      { ota: 'agoda', competitorId: 'comp-own' },
    )
    const check = makeCheck({
      competitorId: 'comp-own',
      ota: 'agoda',
      rooms: [
        { name: 'Deluxe Room', price: 150, currency: 'MYR', roomsLeft: 4, soldOut: false, checkInDate: today },
      ],
    })
    const alerts = await detectAlerts({
      check,
      competitor: { id: 'comp-own', name: 'My Hotel', isOwn: true, otaUrls: { agoda: 'y' } },
      myHotel: MY_HOTEL,
      mappings: [],
    })
    // The own hotel is on Agoda cheaper than my published rate: that gap is a
    // parity problem worth knowing about, so PRICE_DROP still fires.
    assert.ok(alerts.some((a) => a.type === 'PRICE_DROP'))
    assert.equal(alerts.find((a) => a.type === 'UNDERCUT'), undefined)
  })

  test('PRICE_RISE defaults to notify: false to reduce noise', async () => {
    const today = checkInDates()[0].date
    await seedPrevious([
      { name: 'Deluxe Room', price: 200, currency: 'MYR', roomsLeft: 5, soldOut: false, checkInDate: today },
    ])
    const check = makeCheck({
      competitorId: 'comp-1',
      ota: 'booking',
      rooms: [
        { name: 'Deluxe Room', price: 230, currency: 'MYR', roomsLeft: 5, soldOut: false, checkInDate: today },
      ],
    })
    const alerts = await detectAlerts({ check, competitor: COMPETITOR, myHotel: MY_HOTEL, mappings: [] })
    const rise = alerts.find((a) => a.type === 'PRICE_RISE')
    assert.ok(rise, 'expected a PRICE_RISE alert')
    assert.equal(rise.notify, false, 'price rises are stored but not notified by default')
  })
})

describe('check pipeline', () => {
  test('one failing OTA does not stop the others', async () => {
    const { checkCompetitorOta } = await import('../lib/checks.js')
    const competitor = {
      id: 'comp-pipeline',
      name: 'Pipeline Hotel',
      otaUrls: { booking: 'https://example.com/ok', agoda: null, tripcom: null },
    }
    const noUrl = await checkCompetitorOta({
      competitor,
      ota: 'agoda',
      myHotel: MY_HOTEL,
      mappings: [],
    })
    assert.equal(noUrl.status, 'skipped')

    const ok = await checkCompetitorOta({
      competitor,
      ota: 'booking',
      myHotel: MY_HOTEL,
      mappings: [],
    })
    assert.equal(ok.status, 'ok')
    assert.equal(ok.check.simulated, true, 'no API key means simulated readings')
    // Three check-in dates x one mapped room.
    assert.equal(ok.check.roomTypes.length, 3)
    assert.equal([...new Set(ok.check.roomTypes.map((r) => r.checkInDate))].length, 3)
  })

  test('reports a simulated reading honestly rather than as real data', async () => {
    const { checkCompetitorOta } = await import('../lib/checks.js')
    const result = await checkCompetitorOta({
      competitor: { id: 'c2', name: 'X', otaUrls: { booking: 'https://example.com' } },
      ota: 'booking',
      myHotel: MY_HOTEL,
      mappings: [],
    })
    assert.equal(result.check.simulated, true)
    assert.equal(result.check.method, 'simulated')
  })
})

describe('cron endpoint auth', () => {
  test('rejects a missing or wrong key and accepts the configured secret', async () => {
    const { default: api } = await import('../routes/api.js')
    const express = (await import('express')).default
    const cookieParser = (await import('cookie-parser')).default
    const app = express()
    app.use(express.json())
    app.use(cookieParser())
    app.use('/api', api)

    const server = app.listen(0)
    const port = server.address().port
    const call = (headers = {}) =>
      fetch(`http://127.0.0.1:${port}/api/cron/run-checks`, { headers })

    try {
      assert.equal((await call()).status, 401, 'no key must be rejected')
      assert.equal((await call({ 'x-cron-key': 'wrong' })).status, 401, 'wrong key must be rejected')
      const good = await call({ 'x-cron-key': 'test-secret' })
      assert.equal(good.status, 200)
      const body = await good.text()
      assert.match(body, /total=\d+/)
    } finally {
      server.close()
    }
  })

  test('today is expressed in Kuala Lumpur time', () => {
    // KL is UTC+8; the date string must never be derived from a bare UTC day.
    assert.equal(klDateString(new Date('2026-01-01T15:30:00Z')), '2026-01-01')
    assert.equal(klDateString(new Date('2026-01-01T16:30:00Z')), '2026-01-02')
  })
})