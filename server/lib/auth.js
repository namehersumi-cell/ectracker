import crypto from 'node:crypto'

/**
 * Lightweight PIN gate. Firebase Auth is far too heavy for a single-user tool
 * on a front desk phone, so this is a signed session cookie:
 *
 *   PIN (hashed, never stored in plaintext) -> HMAC-signed cookie with expiry
 *
 * The signing secret is generated once if unset, which is safe here because the
 * server runs in a single trusted environment; setting SESSION_SECRET is still
 * recommended for production so sessions survive a redeploy.
 */

const COOKIE_NAME = 'hoteltrackr_session'
const SESSION_DAYS = 30

function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET
  if (!globalThis.__ht_session_secret) {
    globalThis.__ht_session_secret = crypto.randomBytes(32).toString('hex')
    console.warn('[auth] SESSION_SECRET not set — generated an ephemeral secret.')
  }
  return globalThis.__ht_session_secret
}

export function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin)).digest('hex')
}

/**
 * The configured PIN lives in env. When it is absent the tool is open and the
 * UI says so, rather than pretending to be locked.
 */
export function pinGateEnabled() {
  return Boolean(process.env.APP_PIN_HASH || process.env.APP_PIN)
}

function expectedPinHash() {
  if (process.env.APP_PIN_HASH) return process.env.APP_PIN_HASH
  if (process.env.APP_PIN) return hashPin(process.env.APP_PIN)
  return null
}

export function verifyPin(pin) {
  const expected = expectedPinHash()
  if (!expected) return true
  const given = hashPin(pin)
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('hex')
}

export function createSessionToken() {
  const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000
  const payload = `${expires}`
  return `${payload}.${sign(payload)}`
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return false
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return false
  const expected = sign(payload)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false
  return Number(payload) > Date.now()
}

export const sessionCookie = {
  name: COOKIE_NAME,
  options: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  },
}

/** Express middleware guarding the API. */
export function requireSession(req, res, next) {
  if (!pinGateEnabled()) return next()
  if (verifySessionToken(req.cookies?.[COOKIE_NAME])) return next()
  return res.status(401).json({ error: 'locked', message: 'PIN required' })
}