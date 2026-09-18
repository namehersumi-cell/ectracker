const BASE = '/api'

async function request(path, { method = 'GET', body, headers = {}, signal } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    credentials: 'same-origin',
    signal,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (res.status === 401) {
    const err = new Error('locked')
    err.locked = true
    throw err
  }

  const contentType = res.headers.get('content-type') || ''
  const payload = contentType.includes('application/json') ? await res.json() : await res.text()

  if (!res.ok) {
    const message =
      typeof payload === 'object' && payload?.error ? payload.error : String(payload)
    const err = new Error(message || `Request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return payload
}

export const api = {
  get: (path, opts) => request(path, opts),
  post: (path, body) => request(path, { method: 'POST', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  del: (path) => request(path, { method: 'DELETE' }),
}

/** Fetch and trigger a browser download for the export endpoints. */
export async function downloadFile(path, filename) {
  const res = await fetch(`${BASE}${path}`, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`Download failed (${res.status})`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}