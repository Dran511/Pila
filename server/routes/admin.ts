// Office setup for admins: services, counters, staff accounts, settings and analytics.

import { Router } from 'express'
import { z } from 'zod'
import { analytics } from '../analytics.js'
import { hashPassword, me, requireRole } from '../auth.js'
import { conflict, HttpError, idParam, notFound } from '../http.js'
import { getOffice } from '../queue.js'
import { resetDemo, simulateArrivals } from '../seed.js'
import type { Deps } from './deps.js'

const officeBody = z.object({
  name: z.string().trim().min(3).max(80).optional(),
  address: z.string().trim().max(160).nullable().optional(),
  isOpen: z.boolean().optional(),
})

const serviceBody = z.object({
  name: z.string().trim().min(2, 'Enter a service name').max(60),
  prefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{1,2}$/, 'Prefix must be one or two letters, e.g. C or LB'),
  description: z.string().trim().max(120).nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
})

const counterBody = z.object({
  name: z.string().trim().min(1, 'Enter a counter name').max(40),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
})

const userBody = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  role: z.enum(['admin', 'staff']),
})

const SERVICE_COLS = `id, name, prefix, description, is_active AS "isActive", sort_order AS "sortOrder"`
const COUNTER_COLS = `id, name, is_active AS "isActive", sort_order AS "sortOrder"`

export function adminRoutes(deps: Deps) {
  const { ctx, notify } = deps
  const db = ctx.db
  const r = Router()
  r.use(requireRole('admin'))

  const officeId = (req: Parameters<typeof me>[0]) => me(req).office.id
  const blockInDemo = (req: Parameters<typeof me>[0]) => {
    if (me(req).office.isDemo) throw new HttpError(403, 'Staff accounts can’t be changed in the demo office. Create your own office to try this.')
  }

  // ── Office ──
  r.get('/office', async (req, res) => {
    res.json(await getOffice(db, officeId(req)))
  })

  r.patch('/office', async (req, res) => {
    const body = officeBody.parse(req.body)
    await db.query(
      `UPDATE offices SET name = COALESCE($2, name),
                          address = CASE WHEN $3::boolean THEN $4 ELSE address END,
                          is_open = COALESCE($5, is_open)
       WHERE id = $1`,
      [officeId(req), body.name ?? null, body.address !== undefined, body.address ?? null, body.isOpen ?? null],
    )
    notify(officeId(req))
    res.json(await getOffice(db, officeId(req)))
  })

  // ── Services ──
  r.get('/services', async (req, res) => {
    res.json(await db.query(`SELECT ${SERVICE_COLS} FROM services WHERE office_id = $1 ORDER BY sort_order, id`, [officeId(req)]))
  })

  r.post('/services', async (req, res) => {
    const b = serviceBody.parse(req.body)
    const [row] = await db.query(
      `INSERT INTO services (office_id, name, prefix, description, is_active, sort_order)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, (SELECT COALESCE(max(sort_order) + 1, 0) FROM services WHERE office_id = $1)))
       RETURNING ${SERVICE_COLS}`,
      [officeId(req), b.name, b.prefix, b.description ?? null, b.isActive ?? true, b.sortOrder ?? null],
    )
    notify(officeId(req))
    res.status(201).json(row)
  })

  r.patch('/services/:id', async (req, res) => {
    const b = serviceBody.partial().parse(req.body)
    const [row] = await db.query(
      `UPDATE services SET name = COALESCE($3, name), prefix = COALESCE($4, prefix),
              description = CASE WHEN $5::boolean THEN $6 ELSE description END,
              is_active = COALESCE($7, is_active), sort_order = COALESCE($8, sort_order)
       WHERE id = $1 AND office_id = $2 RETURNING ${SERVICE_COLS}`,
      [idParam(req), officeId(req), b.name ?? null, b.prefix ?? null, b.description !== undefined, b.description ?? null,
        b.isActive ?? null, b.sortOrder ?? null],
    )
    if (!row) throw notFound('Service not found')
    notify(officeId(req))
    res.json(row)
  })

  r.delete('/services/:id', async (req, res) => {
    const id = idParam(req)
    const [used] = await db.query(`SELECT 1 FROM tickets WHERE service_id = $1 LIMIT 1`, [id])
    if (used) throw conflict('This service has ticket history. Turn it off instead, so your reports stay complete.')
    const rows = await db.query(`DELETE FROM services WHERE id = $1 AND office_id = $2 RETURNING id`, [id, officeId(req)])
    if (!rows.length) throw notFound('Service not found')
    notify(officeId(req))
    res.json({ ok: true })
  })

  // ── Counters ──
  r.get('/counters', async (req, res) => {
    res.json(await db.query(`SELECT ${COUNTER_COLS} FROM counters WHERE office_id = $1 ORDER BY sort_order, id`, [officeId(req)]))
  })

  r.post('/counters', async (req, res) => {
    const b = counterBody.parse(req.body)
    const [row] = await db.query(
      `INSERT INTO counters (office_id, name, is_active, sort_order)
       VALUES ($1, $2, $3, COALESCE($4, (SELECT COALESCE(max(sort_order) + 1, 0) FROM counters WHERE office_id = $1)))
       RETURNING ${COUNTER_COLS}`,
      [officeId(req), b.name, b.isActive ?? true, b.sortOrder ?? null],
    )
    notify(officeId(req))
    res.status(201).json(row)
  })

  r.patch('/counters/:id', async (req, res) => {
    const b = counterBody.partial().parse(req.body)
    const id = idParam(req)
    if (b.isActive === false) {
      const [busy] = await db.query(`SELECT 1 FROM tickets WHERE counter_id = $1 AND status = 'serving'`, [id])
      if (busy) throw conflict('Someone is being served at this counter. Finish with them first.')
    }
    const [row] = await db.query(
      `UPDATE counters SET name = COALESCE($3, name), is_active = COALESCE($4, is_active), sort_order = COALESCE($5, sort_order)
       WHERE id = $1 AND office_id = $2 RETURNING ${COUNTER_COLS}`,
      [id, officeId(req), b.name ?? null, b.isActive ?? null, b.sortOrder ?? null],
    )
    if (!row) throw notFound('Counter not found')
    notify(officeId(req))
    res.json(row)
  })

  r.delete('/counters/:id', async (req, res) => {
    const id = idParam(req)
    const [used] = await db.query(`SELECT 1 FROM tickets WHERE counter_id = $1 LIMIT 1`, [id])
    if (used) throw conflict('This counter has served people before. Turn it off instead, so your reports stay complete.')
    const rows = await db.query(`DELETE FROM counters WHERE id = $1 AND office_id = $2 RETURNING id`, [id, officeId(req)])
    if (!rows.length) throw notFound('Counter not found')
    notify(officeId(req))
    res.json({ ok: true })
  })

  // ── Staff accounts ──
  r.get('/users', async (req, res) => {
    res.json(
      await db.query(
        `SELECT id, name, email, role, ${`to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`} AS "createdAt"
         FROM users WHERE office_id = $1 ORDER BY role, name`,
        [officeId(req)],
      ),
    )
  })

  r.post('/users', async (req, res) => {
    blockInDemo(req)
    const b = userBody.parse(req.body)
    const [taken] = await db.query(`SELECT 1 FROM users WHERE email = $1`, [b.email])
    if (taken) throw conflict('An account with that email already exists.')
    const [row] = await db.query(
      `INSERT INTO users (office_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email, role`,
      [officeId(req), b.name, b.email, await hashPassword(b.password), b.role],
    )
    res.status(201).json(row)
  })

  r.delete('/users/:id', async (req, res) => {
    blockInDemo(req)
    const id = idParam(req)
    if (id === me(req).id) throw conflict('You can’t remove your own account.')
    const rows = await db.query(`DELETE FROM users WHERE id = $1 AND office_id = $2 RETURNING id`, [id, officeId(req)])
    if (!rows.length) throw notFound('User not found')
    res.json({ ok: true })
  })

  // ── Analytics ──
  r.get('/analytics', async (req, res) => {
    const days = z.coerce.number().int().min(7).max(90).catch(14).parse(req.query.days)
    res.json(await analytics(ctx, officeId(req), days))
  })

  // ── Demo helpers (demo office only) ──
  r.post('/demo/simulate', async (req, res) => {
    if (!me(req).office.isDemo) throw new HttpError(403, 'Only available in the demo office.')
    const n = z.number().int().min(1).max(10).catch(5).parse(req.body?.count)
    await simulateArrivals(ctx, officeId(req), n)
    notify(officeId(req))
    res.json({ ok: true, added: n })
  })

  r.post('/demo/reset', async (req, res) => {
    if (!me(req).office.isDemo) throw new HttpError(403, 'Only available in the demo office.')
    await resetDemo(ctx, officeId(req))
    notify(officeId(req))
    res.json({ ok: true })
  })

  return r
}
