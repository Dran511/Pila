import cookieParser from 'cookie-parser'
import express from 'express'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { loadUser } from './auth.js'
import type { Db } from './db/index.js'
import { errorHandler, notFound } from './http.js'
import type { Ctx } from './queue.js'
import { createRealtime, type Realtime } from './realtime.js'
import { adminRoutes } from './routes/admin.js'
import { authRoutes } from './routes/auth.js'
import { publicRoutes } from './routes/public.js'
import { staffRoutes } from './routes/staff.js'
import { systemClock, type Clock } from './time.js'

export interface AppOptions {
  db: Db
  jwtSecret: string
  now?: Clock
  secureCookies?: boolean
  rateLimits?: boolean
  /** Folder with the built React app to serve (production). */
  clientDir?: string
}

/** Build the HTTP + WebSocket server. Kept separate from index.ts so tests can create isolated instances. */
export function createApp(opts: AppOptions) {
  const ctx: Ctx = { db: opts.db, now: opts.now ?? systemClock }
  const app = express()
  const server = createServer(app)
  const realtime: Realtime = createRealtime(server, ctx, opts.jwtSecret)

  const deps = {
    ctx,
    notify: realtime.notify,
    jwtSecret: opts.jwtSecret,
    secureCookies: opts.secureCookies ?? false,
    rateLimits: opts.rateLimits ?? true,
  }

  app.set('trust proxy', 1) // behind Render/Railway's proxy, so req.ip is the real client
  app.disable('x-powered-by')
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'same-origin')
    res.setHeader('X-Frame-Options', 'SAMEORIGIN')
    next()
  })
  app.use(express.json({ limit: '20kb' }))
  app.use(cookieParser())
  app.use(loadUser(opts.db, opts.jwtSecret))

  app.get('/api/health', async (_req, res) => {
    await opts.db.query('SELECT 1')
    res.json({ ok: true, db: opts.db.driver })
  })
  app.use('/api/auth', authRoutes(deps))
  app.use('/api/public', publicRoutes(deps))
  app.use('/api/staff', staffRoutes(deps))
  app.use('/api/admin', adminRoutes(deps))
  app.use('/api', (_req, _res, next) => next(notFound('No such API route')))

  // Serve the React app; any non-API path falls back to index.html for client-side routing.
  if (opts.clientDir && existsSync(opts.clientDir)) {
    app.use(express.static(opts.clientDir, { index: false, maxAge: '1h' }))
    app.get(/^\/(?!api|socket\.io).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache')
      res.sendFile(path.join(opts.clientDir!, 'index.html'))
    })
  }

  app.use(errorHandler)

  return { app, server, realtime, ctx }
}
