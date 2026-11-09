import type { RequestHandler } from 'express'
import { HttpError } from './http.js'

/**
 * A small fixed-window rate limiter kept in memory (fine for one server instance).
 * Used to slow down password guessing and ticket spamming.
 */
export function rateLimit(opts: { windowMs: number; max: number; message: string }): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>()
  setInterval(() => {
    const now = Date.now()
    for (const [key, v] of hits) if (v.resetAt <= now) hits.delete(key)
  }, opts.windowMs).unref()

  return (req, res, next) => {
    const key = `${req.ip}`
    const now = Date.now()
    let entry = hits.get(key)
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + opts.windowMs }
      hits.set(key, entry)
    }
    entry.count++
    if (entry.count > opts.max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000))
      return next(new HttpError(429, opts.message))
    }
    next()
  }
}
