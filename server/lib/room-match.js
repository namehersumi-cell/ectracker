/**
 * Room-type linkage.
 *
 * OTAs let every hotel name its rooms however it likes, so "STANDARD QUEEN
 * ROOM" at my hotel may be "DELUXE QUEEN ROOM" at the hotel next door. Linking
 * them is the one job the operator must do by hand, so this module exists to
 * make that as close to zero-effort as possible: it scores every candidate pair
 * and only asks for confirmation on the plausible ones.
 *
 * The matcher is deliberately conservative. A wrong link silently corrupts
 * every comparison that depends on it (undercut alerts, comp-set positioning),
 * which is far worse than leaving a room unlinked and asking a human.
 */

import { normalizeRoomName, roomNamesMatch } from './alerts.js'

/** Bed size is the strongest signal that two rooms are the same product. */
const BED_TOKENS = ['king', 'queen', 'twin', 'single', 'double', 'bunk']

/** Room class, ordered loosely from basic to premium. */
const CLASS_TOKENS = ['standard', 'superior', 'deluxe', 'executive', 'premier', 'premium', 'suite', 'family']

/** Occupancy clues that distinguish otherwise similar rooms. */
const OCCUPANCY_TOKENS = ['single', 'double', 'triple', 'quad', 'family']

function tokens(name) {
  return normalizeRoomName(name).split(' ').filter(Boolean)
}

function pick(list, tokenSet) {
  return list.filter((t) => tokenSet.includes(t))
}

/**
 * Score two room names from 0 (unrelated) to 1 (same room).
 *
 * Bed configuration and occupancy are treated as hard conflicts: "Deluxe Queen"
 * and "Deluxe Twin" are different products. Marketing tier is NOT — hotels
 * routinely sell the same physical room as "Standard" or "Deluxe", which is
 * exactly the case the operator needs to link. A differing tier therefore still
 * produces a suggestion, it just never auto-links, so a human confirms it.
 */
export function scoreRoomMatch(myName, competitorName) {
  const a = normalizeRoomName(myName)
  const b = normalizeRoomName(competitorName)
  if (!a || !b) return { score: 0, reason: 'Missing room name' }

  if (a === b) {
    return { score: 1, reason: 'Names match exactly', autoLink: true }
  }

  const ta = tokens(myName)
  const tb = tokens(competitorName)
  const setB = new Set(tb)

  const overlap = ta.filter((t) => setB.has(t)).length
  const union = new Set([...ta, ...tb]).size
  const jaccard = union ? overlap / union : 0

  const bedA = pick(ta, BED_TOKENS)
  const bedB = pick(tb, BED_TOKENS)
  const classA = pick(ta, CLASS_TOKENS)
  const classB = pick(tb, CLASS_TOKENS)
  const occA = pick(ta, OCCUPANCY_TOKENS)
  const occB = pick(tb, OCCUPANCY_TOKENS)

  let score = jaccard
  const reasons = []
  let conflict = null
  let classTension = false

  if (bedA.length && bedB.length) {
    if (bedA.some((x) => bedB.includes(x))) {
      score += 0.35
      reasons.push(`same bed type (${bedA[0]})`)
    } else {
      conflict = `different beds (${bedA[0]} vs ${bedB.join('/')})`
    }
  } else if (bedA.length || bedB.length) {
    // One side states the bed and the other is silent: weak positive only,
    // because the silent side could be a different configuration.
    score += 0.05
    reasons.push('bed stated on one side only')
  }

  if (occA.length && occB.length) {
    if (occA.some((x) => occB.includes(x))) {
      score += 0.15
      reasons.push('same occupancy')
    } else {
      conflict = conflict || `different occupancy (${occA[0]} vs ${occB.join('/')})`
    }
  }

  if (classA.length && classB.length) {
    const shared = classA.filter((x) => classB.includes(x))
    // "Suite" on its own is a container word, not a tier: two different suites
    // are not the same product, so it earns little and blocks auto-linking.
    const sharedSpecific = shared.filter((t) => t !== 'suite')
    if (sharedSpecific.length) {
      score += 0.2
      reasons.push(`same class (${sharedSpecific[0]})`)
    } else if (shared.includes('suite')) {
      score += 0.05
      classTension = true
      reasons.push('both are suites')
    } else {
      // Adjacent or distant tiers are normal naming differences between
      // hotels, so this lowers confidence without declaring a conflict.
      classTension = true
      reasons.push(`different tier (${classA[0]} vs ${classB[0]})`)
    }
  }

  if (conflict) {
    // A conflict caps confidence: the rooms share words but are not the same.
    score = Math.min(score, 0.34)
  }

  score = Math.max(0, Math.min(1, score))
  const rounded = Number(score.toFixed(2))
  const reason =
    reasons.length > 0
      ? `${reasons.join(', ')}${conflict ? `; ${conflict}` : ''}`
      : conflict || 'Partial name overlap'

  return {
    score: rounded,
    reason,
    conflict: Boolean(conflict),
    // Only an unambiguous match links without the operator looking at it. Any
    // tension in tier or suite wording forces a confirmation click.
    autoLink: !conflict && !classTension && rounded >= 0.85,
    // Above this the UI leads with the pairing; below it, it stays collapsed.
    suggestion: !conflict && rounded >= 0.5,
  }
}

/** Name similarity used only as a fallback signal, kept for explainability. */
export function sameRoom(myName, competitorName) {
  return roomNamesMatch(myName, competitorName)
}

/**
 * For one of my room types, rank a competitor's room names best-first.
 * Returns only plausible candidates plus a `rest` bucket.
 */
export function suggestLinks(myRoomName, competitorRoomNames) {
  const scored = (competitorRoomNames || []).map((name) => ({
    competitorRoomName: name,
    ...scoreRoomMatch(myRoomName, name),
  }))
  scored.sort((a, b) => b.score - a.score)
  const best = scored[0] || null
  return {
    best,
    candidates: scored.filter((s) => s.suggestion),
    rest: scored.filter((s) => !s.suggestion),
  }
}

/**
 * Build link suggestions for a whole hotel: every one of my room types against
 * every room the competitor sells on any OTA.
 *
 * Links are one-to-one per competitor — two of my rooms must not claim the same
 * competitor room, or their prices would be double-counted in the comp set.
 */
export function suggestLinksForHotel({ myRoomTypes, competitorRoomNames, exclude }) {
  const taken = new Set(exclude || [])
  const rows = []

  // Greedy assignment by descending confidence: the most obvious pairing is
  // made first so a strong match is never lost to a weaker one.
  const pairs = []
  for (const mine of myRoomTypes) {
    for (const theirs of competitorRoomNames) {
      const s = scoreRoomMatch(mine.name, theirs)
      if (s.suggestion) pairs.push({ mine, theirs, ...s })
    }
  }
  pairs.sort((a, b) => b.score - a.score)

  const usedMine = new Set()
  for (const p of pairs) {
    if (usedMine.has(p.mine.id) || taken.has(p.theirs)) continue
    usedMine.add(p.mine.id)
    taken.add(p.theirs)
    rows.push({
      myRoomTypeId: p.mine.id,
      myRoomName: p.mine.name,
      otaRoomName: p.theirs,
      score: p.score,
      reason: p.reason,
      autoLink: p.autoLink,
    })
  }
  return rows
}