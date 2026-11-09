// Counter actions for signed-in staff. Every query is scoped to the user's own office,
// so a staff member can never touch another office's tickets, even with a valid ticket id.

import { Router } from 'express'
import { z } from 'zod'
import { me, requireRole } from '../auth.js'
import { idParam, uuidParam } from '../http.js'
import {
  callNext,
  callTicket,
  completeTicket,
  createTicket,
  markNoShow,
  recallTicket,
  staffSnapshot,
} from '../queue.js'
import type { Deps } from './deps.js'

const nextBody = z.object({ serviceIds: z.array(z.number().int().positive()).max(50) })
const callBody = z.object({ counterId: z.number().int().positive() })
const walkInBody = z.object({
  serviceId: z.number().int().positive(),
  customerName: z.string().trim().max(60).optional().nullable(),
  isPriority: z.boolean().optional(),
})

export function staffRoutes(deps: Deps) {
  const { ctx, notify } = deps
  const r = Router()
  r.use(requireRole('staff'))

  r.get('/queue', async (req, res) => {
    res.json(await staffSnapshot(ctx, me(req).office.id))
  })

  r.post('/counters/:id/next', async (req, res) => {
    const officeId = me(req).office.id
    const { serviceIds } = nextBody.parse(req.body)
    const called = await callNext(ctx, officeId, idParam(req), serviceIds, me(req).id)
    notify(officeId, called)
    res.json({ called })
  })

  r.post('/tickets', async (req, res) => {
    const officeId = me(req).office.id
    const body = walkInBody.parse(req.body)
    const ticket = await createTicket(ctx, officeId, { ...body, source: 'walk_in' })
    notify(officeId)
    res.status(201).json(ticket)
  })

  r.post('/tickets/:id/call', async (req, res) => {
    const officeId = me(req).office.id
    const { counterId } = callBody.parse(req.body)
    const called = await callTicket(ctx, officeId, uuidParam(req), counterId, me(req).id)
    notify(officeId, called)
    res.json({ called })
  })

  r.post('/tickets/:id/recall', async (req, res) => {
    const officeId = me(req).office.id
    const called = await recallTicket(ctx, officeId, uuidParam(req))
    notify(officeId, called)
    res.json({ called })
  })

  r.post('/tickets/:id/complete', async (req, res) => {
    const officeId = me(req).office.id
    await completeTicket(ctx, officeId, uuidParam(req))
    notify(officeId)
    res.json({ ok: true })
  })

  r.post('/tickets/:id/no-show', async (req, res) => {
    const officeId = me(req).office.id
    await markNoShow(ctx, officeId, uuidParam(req))
    notify(officeId)
    res.json({ ok: true })
  })

  return r
}
