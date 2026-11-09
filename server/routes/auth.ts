import { Router } from 'express'
import { z } from 'zod'
import {
  checkPassword,
  clearSessionCookie,
  hashPassword,
  setSessionCookie,
  signSession,
  userFromToken,
} from '../auth.js'
import { HttpError } from '../http.js'
import { rateLimit } from '../rateLimit.js'
import type { Deps } from './deps.js'

const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(200)
const password = z.string().min(8, 'Password must be at least 8 characters').max(200)

const loginBody = z.object({ email, password: z.string().min(1, 'Enter your password') })

const signupBody = z.object({
  officeName: z.string().trim().min(3, 'Office name is too short').max(80),
  name: z.string().trim().min(2, 'Enter your name').max(80),
  email,
  password,
})

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'office'

export function authRoutes(deps: Deps) {
  const { ctx, jwtSecret, secureCookies } = deps
  const r = Router()
  const loginLimiter = deps.rateLimits
    ? rateLimit({ windowMs: 15 * 60_000, max: 20, message: 'Too many sign-in attempts. Try again in a few minutes.' })
    : (_req: unknown, _res: unknown, next: () => void) => next()

  const startSession = async (res: Parameters<typeof setSessionCookie>[0], userId: number) => {
    const token = signSession(userId, jwtSecret)
    setSessionCookie(res, token, secureCookies)
    return userFromToken(ctx.db, token, jwtSecret)
  }

  r.get('/me', (req, res) => {
    res.json({ user: req.user ?? null })
  })

  r.post('/login', loginLimiter, async (req, res) => {
    const body = loginBody.parse(req.body)
    const [row] = await ctx.db.query<{ id: number; hash: string }>(
      `SELECT id, password_hash AS hash FROM users WHERE email = $1`,
      [body.email],
    )
    // Same message whether the email or the password is wrong, so emails cannot be probed.
    if (!row || !(await checkPassword(body.password, row.hash))) {
      throw new HttpError(401, 'Wrong email or password.')
    }
    res.json({ user: await startSession(res, row.id) })
  })

  /** One-click sign-in to the demo office, so visitors can try the staff and admin views. */
  r.post('/demo', async (req, res) => {
    const role = z.enum(['admin', 'staff']).parse(req.body?.role ?? 'staff')
    const [row] = await ctx.db.query<{ id: number }>(
      `SELECT u.id FROM users u JOIN offices o ON o.id = u.office_id
       WHERE o.is_demo AND u.role = $1 ORDER BY u.id LIMIT 1`,
      [role],
    )
    if (!row) throw new HttpError(404, 'The demo office is not set up on this server.')
    res.json({ user: await startSession(res, row.id) })
  })

  /** Create a new office with its first admin, a default service and a counter. */
  r.post('/signup', loginLimiter, async (req, res) => {
    const body = signupBody.parse(req.body)
    const hash = await hashPassword(body.password)
    const userId = await ctx.db.tx(async (q) => {
      const [taken] = await q.query(`SELECT 1 FROM users WHERE email = $1`, [body.email])
      if (taken) throw new HttpError(409, 'An account with that email already exists.')

      const base = slugify(body.officeName)
      let slug = base
      for (let i = 2; (await q.query(`SELECT 1 FROM offices WHERE slug = $1`, [slug])).length; i++) slug = `${base}-${i}`

      const [office] = await q.query<{ id: number }>(
        `INSERT INTO offices (slug, name) VALUES ($1, $2) RETURNING id`,
        [slug, body.officeName],
      )
      await q.query(
        `INSERT INTO services (office_id, name, prefix, description, sort_order) VALUES ($1, 'General', 'G', 'All other concerns', 0)`,
        [office.id],
      )
      await q.query(`INSERT INTO counters (office_id, name) VALUES ($1, 'Window 1')`, [office.id])
      const [user] = await q.query<{ id: number }>(
        `INSERT INTO users (office_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, 'admin') RETURNING id`,
        [office.id, body.name, body.email, hash],
      )
      return user.id
    })
    res.status(201).json({ user: await startSession(res, userId) })
  })

  r.post('/logout', (_req, res) => {
    clearSessionCookie(res)
    res.json({ ok: true })
  })

  return r
}
