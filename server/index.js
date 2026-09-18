import 'dotenv/config'
import express from 'express'
import cookieParser from 'cookie-parser'
import path from 'node:path'
import fs from 'node:fs'
import api from './routes/api.js'
import { getStore } from './store.js'

const app = express()
const PORT = Number(process.env.PORT || 12000)

app.disable('x-powered-by')
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())

app.use('/api', api)

// Serve the built SPA when it exists, so a single `npm start` runs the whole
// product on one port. In development Vite serves the client and proxies /api.
const distDir = path.join(process.cwd(), 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next()
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

// eslint-disable-next-line no-unused-vars -- Express requires the 4-arg shape
app.use((err, req, res, next) => {
  console.error('[api:error]', err)
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
})

async function start() {
  await getStore()
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`HotelTrackr server listening on http://0.0.0.0:${PORT}`)
    if (!process.env.GEMINI_API_KEY) {
      console.log('GEMINI_API_KEY not set — extraction runs in simulated mode.')
    }
  })
}

start()