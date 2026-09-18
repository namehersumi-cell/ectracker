import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { scoreRoomMatch, suggestLinks, suggestLinksForHotel } from '../lib/room-match.js'
import {
  clampRadius,
  DEFAULT_RADIUS_M,
  MAX_RADIUS_M,
  MIN_RADIUS_M,
} from '../lib/discovery.js'
import { distanceMeters } from '../lib/places.js'

describe('room name matching', () => {
  test('identical names link automatically', () => {
    const r = scoreRoomMatch('Deluxe Room', 'Deluxe Room')
    assert.equal(r.score, 1)
    assert.equal(r.autoLink, true)
  })

  test('the stated case links: STANDARD QUEEN ROOM vs DELUXE QUEEN ROOM', () => {
    // The operator's own example. Same bed, adjacent class, so it is a
    // plausible pairing that is offered — but NOT auto-merged, because the
    // classes differ and only a human knows whether they consider them equal.
    const r = scoreRoomMatch('STANDARD QUEEN ROOM', 'DELUXE QUEEN ROOM')
    assert.ok(r.score >= 0.5, `expected a suggestion, got ${r.score}`)
    assert.equal(r.autoLink, false, 'differing classes must not link without review')
    assert.match(r.reason, /same bed type \(queen\)/)
  })

  test('different bed types never link even with the same class word', () => {
    const r = scoreRoomMatch('Deluxe Queen Room', 'Deluxe Twin Room')
    assert.equal(r.autoLink, false)
    assert.ok(r.score <= 0.34, `conflicting beds must cap confidence, got ${r.score}`)
    assert.match(r.reason, /different beds/)
  })

  test('a shared generic "suite" word is not treated as the same class', () => {
    // Executive Suite and Family Suite are different products. The reason text
    // must not claim they share a class just because both say "suite".
    const r = scoreRoomMatch('Executive Suite', 'Family Suite')
    assert.ok(!/same class/.test(r.reason), `misleading reason: ${r.reason}`)
    assert.equal(r.autoLink, false)
  })

  test('mismatched occupancy is treated as a conflict', () => {
    const r = scoreRoomMatch('Standard Double Room', 'Standard Single Room')
    assert.equal(r.autoLink, false)
    assert.ok(r.score <= 0.34)
  })

  test('"Deluxe" and "Deluxe Room" line up', () => {
    const r = scoreRoomMatch('Deluxe', 'Deluxe Room')
    assert.ok(r.score >= 0.5)
  })

  test('unrelated rooms do not suggest', () => {
    const r = scoreRoomMatch('Deluxe Room', 'Penthouse Loft')
    assert.equal(r.suggestion, false)
  })

  test('suggestLinks ranks the best candidate first', () => {
    const out = suggestLinks('Twin Room', [
      'Superior Twin Room',
      'Deluxe King Room',
      'Family Suite',
    ])
    assert.equal(out.best.competitorRoomName, 'Superior Twin Room')
  })

  test('greedy assignment never gives two of my rooms the same competitor room', () => {
    // A duplicate link would double-count that room's price in the comp set.
    const rows = suggestLinksForHotel({
      myRoomTypes: [
        { id: 'm1', name: 'Deluxe Room' },
        { id: 'm2', name: 'Deluxe King Room' },
      ],
      competitorRoomNames: ['Deluxe King Room'],
    })
    const used = rows.map((r) => r.otaRoomName)
    assert.equal(new Set(used).size, used.length, 'a competitor room was claimed twice')
  })

  test('already-linked competitor rooms are not suggested again', () => {
    const rows = suggestLinksForHotel({
      myRoomTypes: [{ id: 'm1', name: 'Twin Room' }],
      competitorRoomNames: ['Superior Twin Room'],
      exclude: ['Superior Twin Room'],
    })
    assert.equal(rows.length, 0)
  })
})

describe('discovery radius', () => {
  test('radius is clamped to a sane range', () => {
    assert.equal(clampRadius(50), MIN_RADIUS_M)
    assert.equal(clampRadius(999999), MAX_RADIUS_M)
    assert.equal(clampRadius('abc'), DEFAULT_RADIUS_M)
    assert.equal(clampRadius(1500), 1500)
  })
})

describe('distance', () => {
  test('distance is zero at the same point', () => {
    assert.equal(distanceMeters({ lat: 3.139, lng: 101.6869 }, { lat: 3.139, lng: 101.6869 }), 0)
  })

  test('~1 degree of latitude is about 111 km', () => {
    const d = distanceMeters({ lat: 3, lng: 101 }, { lat: 4, lng: 101 })
    assert.ok(d > 110000 && d < 112000, `got ${d}`)
  })

  test('missing coordinates return null rather than NaN', () => {
    assert.equal(distanceMeters(null, { lat: 1, lng: 1 }), null)
    assert.equal(distanceMeters({ lat: 1, lng: 1 }, null), null)
  })
})