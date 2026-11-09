// Routes for the public: no sign-in. A ticket's UUID works as its "claim check":
// whoever has the link can follow or cancel it, and it cannot be guessed.

import { Router } from 'express'
import { z } from 'zod'
import { uuidParam } from '../http.js'
import { cancelTicket, createTicket, getOfficeBySlug, publicSnapshot, ticketView } from '../queue.js'
import { rateLimit } from '../rateLimit.js'
import type { Deps } from './deps.js'

const joinBody = z.object({
  serviceId: z.number().int().positive(),
  customerName: z.string().trim().max(60).optional().nullable(),
  isPriority: z.boolean().optional(),
})

export function publicRoutes(deps: Deps) {
  const { ctx, notify } = deps
  const r = Router()
  const joinLimiter = deps.rateLimits
    ? rateLimit({ windowMs: 10 * 60_000, max: 8, message: 'Too many tickets from this device. Please wait a few minutes.' })
    : (_req: unknown, _res: unknown, next: () => void) => next()

  r.get('/offices/:slug', async (req, res) => {
    const office = await getOfficeBySlug(ctx.db, String(req.params.slug))
    res.json(await publicSnapshot(ctx, office.id))
  })

  r.post('/offices/:slug/tickets', joinLimiter, async (req, res) => {
    const body = joinBody.parse(req.body)
    const office = await getOfficeBySlug(ctx.db, String(req.params.slug))
    const ticket = await createTicket(ctx, office.id, { ...body, source: 'online' })
    notify(office.id)
    res.status(201).json({ id: ticket.id, code: ticket.code })
  })

  r.get('/tickets/:id', async (req, res) => {
    res.json(await ticketView(ctx, uuidParam(req)))
  })

  r.post('/tickets/:id/cancel', async (req, res) => {
    const id = uuidParam(req)
    const officeId = await cancelTicket(ctx, id)
    notify(officeId)
    res.json(await ticketView(ctx, id))
  })

  return r
}
