import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

/**
 * Persistence layer.
 *
 * Firestore is the production target, but a hotel front desk must be able to
 * run this on a laptop with no cloud project, so we transparently fall back to
 * a JSON document store. Both expose the same tiny document API, which keeps
 * the route handlers storage-agnostic.
 */

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data')
const DB_FILE = path.join(DATA_DIR, 'db.json')

const COLLECTIONS = [
  'settings', // myHotel, notifications, handover
  'competitors',
  'priceChecks',
  'alerts',
  'roomMappings',
  'actions',
  'alertEvents', // dedup ledger for fired alert events
  'otaHealth', // consecutive failure counters per OTA
  'telegramQueue', // messages held during quiet hours
  'meta', // usage counters, scheduler heartbeat
]

export function newId() {
  return crypto.randomBytes(12).toString('hex')
}

export function nowIso() {
  return new Date().toISOString()
}

class JsonStore {
  constructor() {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    this.data = this._load()
  }

  _load() {
    try {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
    } catch {
      return Object.fromEntries(COLLECTIONS.map((c) => [c, {}]))
    }
  }

  _flush() {
    const tmp = `${DB_FILE}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2))
    fs.renameSync(tmp, DB_FILE)
  }

  _col(name) {
    if (!this.data[name]) this.data[name] = {}
    return this.data[name]
  }

  async list(collection) {
    return Object.values(this._col(collection)).map((d) => ({ ...d }))
  }

  async get(collection, id) {
    const doc = this._col(collection)[id]
    return doc ? { ...doc } : null
  }

  async set(collection, id, data) {
    const existing = this._col(collection)[id] || {}
    const doc = { ...existing, ...data, id }
    if (!existing.createdAt) doc.createdAt = data.createdAt || nowIso()
    doc.updatedAt = nowIso()
    this._col(collection)[id] = doc
    this._flush()
    return { ...doc }
  }

  async add(collection, data) {
    return this.set(collection, data.id || newId(), data)
  }

  async delete(collection, id) {
    const col = this._col(collection)
    const found = Boolean(col[id])
    delete col[id]
    this._flush()
    return found
  }

  async query(collection, predicate) {
    const rows = await this.list(collection)
    return predicate ? rows.filter(predicate) : rows
  }
}

/**
 * Firestore-backed store using firebase-admin. Activated only when
 * FIRESTORE_ENABLED=true and credentials are present; otherwise the JSON store
 * is used so the app always boots.
 */
class FirestoreStore {
  constructor(db) {
    this.db = db
  }

  _col(name) {
    return this.db.collection(name)
  }

  async list(collection) {
    const snap = await this._col(collection).get()
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  }

  async get(collection, id) {
    const snap = await this._col(collection).doc(id).get()
    return snap.exists ? { id: snap.id, ...snap.data() } : null
  }

  async set(collection, id, data) {
    const ref = this._col(collection).doc(id)
    const existing = await ref.get()
    const payload = { ...data, updatedAt: nowIso() }
    if (!existing.exists) payload.createdAt = data.createdAt || nowIso()
    await ref.set(payload, { merge: true })
    const after = await ref.get()
    return { id, ...after.data() }
  }

  async add(collection, data) {
    return this.set(collection, data.id || newId(), data)
  }

  async delete(collection, id) {
    const ref = this._col(collection).doc(id)
    const existing = await ref.get()
    await ref.delete()
    return existing.exists
  }

  async query(collection, predicate) {
    const rows = await this.list(collection)
    return predicate ? rows.filter(predicate) : rows
  }
}

let store = null

export async function getStore() {
  if (store) return store
  const hasCreds =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (process.env.FIRESTORE_ENABLED === 'true' && hasCreds) {
    try {
      const { initializeApp, cert, applicationDefault } = await import('firebase-admin/app')
      const { getFirestore } = await import('firebase-admin/firestore')
      const app = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
        ? initializeApp({
            credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)),
          })
        : initializeApp({ credential: applicationDefault() })
      store = new FirestoreStore(getFirestore(app))
      console.log('[store] using Firestore')
      return store
    } catch (err) {
      console.warn('[store] Firestore unavailable, falling back to JSON:', err.message)
    }
  }
  store = new JsonStore()
  console.log(`[store] using JSON store at ${DB_FILE}`)
  return store
}

export const storeKind = () =>
  store instanceof FirestoreStore ? 'firestore' : 'json'