import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  callNext,
  callTicket,
  cancelTicket,
  completeTicket,
  createTicket,
  markNoShow,
  publicSnapshot,
  staffSnapshot,
  ticketView,
} from '../server/queue.js'
import { setup } from './helpers.js'

let t: Awaited<ReturnType<typeof setup>>

beforeEach(async () => {
  t = await setup()
})
afterEach(async () => {
  await t.db.close()
})

const join = (serviceId: number, extra: { isPriority?: boolean; customerName?: string } = {}) =>
  createTicket(t.ctx, t.officeId, { serviceId, ...extra })

describe('issuing tickets', () => {
  it('numbers each service separately, padded to three digits', async () => {
    expect((await join(t.consultId)).code).toBe('C-001')
    expect((await join(t.consultId)).code).toBe('C-002')
    expect((await join(t.labId)).code).toBe('L-001')
  })

  it('starts again from 001 the next day (Manila time, not UTC)', async () => {
    t.clock.set('2026-03-02T23:50:00+08:00')
    expect((await join(t.consultId)).code).toBe('C-001')
    expect((await join(t.consultId)).code).toBe('C-002')
    // 00:10 in Manila is still the previous day in UTC; numbering must reset anyway.
    t.clock.set('2026-03-03T00:10:00+08:00')
    expect((await join(t.consultId)).code).toBe('C-001')
  })

  it('never hands out the same number twice under concurrent joins', async () => {
    const tickets = await Promise.all(Array.from({ length: 25 }, () => join(t.consultId)))
    const codes = new Set(tickets.map((x) => x.code))
    expect(codes.size).toBe(25)
  })

  it('refuses online tickets when the office is closed, but staff can still add walk-ins', async () => {
    await t.db.query(`UPDATE offices SET is_open = FALSE WHERE id = $1`, [t.officeId])
    await expect(join(t.consultId)).rejects.toMatchObject({ status: 409 })
    await expect(createTicket(t.ctx, t.officeId, { serviceId: t.consultId, source: 'walk_in' })).resolves.toMatchObject({
      code: 'C-001',
    })
  })

  it('rejects a service from another office', async () => {
    const [other] = await t.db.query<{ id: number }>(`INSERT INTO offices (slug, name) VALUES ('x', 'X') RETURNING id`)
    await expect(createTicket(t.ctx, other.id, { serviceId: t.consultId })).rejects.toMatchObject({ status: 404 })
  })
})

describe('calling people to a counter', () => {
  it('serves first come, first served', async () => {
    await join(t.consultId)
    t.clock.advance(1)
    await join(t.consultId)
    const first = await callNext(t.ctx, t.officeId, t.w1, [t.consultId], null)
    expect(first).toMatchObject({ code: 'C-001', counterName: 'Window 1', recall: false })
  })

  it('serves the priority lane (seniors, PWDs, pregnant women) first', async () => {
    await join(t.consultId)
    t.clock.advance(1)
    await join(t.consultId, { isPriority: true })
    expect((await callNext(t.ctx, t.officeId, t.w1, [t.consultId], null))?.code).toBe('C-002')
    expect((await callNext(t.ctx, t.officeId, t.w1, [t.consultId], null))?.code).toBe('C-001')
  })

  it('only calls services the counter handles', async () => {
    await join(t.consultId)
    t.clock.advance(1)
    await join(t.labId)
    expect((await callNext(t.ctx, t.officeId, t.w1, [t.labId], null))?.code).toBe('L-001')
  })

  it('marks the previous person done when calling the next one', async () => {
    const a = await join(t.consultId)
    await join(t.consultId)
    await callNext(t.ctx, t.officeId, t.w1, [t.consultId], null)
    t.clock.advance(5)
    await callNext(t.ctx, t.officeId, t.w1, [t.consultId], null)
    const view = await ticketView(t.ctx, a.id)
    expect(view.status).toBe('done')
  })

  it('returns null when nobody is waiting', async () => {
    expect(await callNext(t.ctx, t.officeId, t.w1, [t.consultId], null)).toBeNull()
  })

  it('gives two counters pressing "Next" at the same time different people', async () => {
    await join(t.consultId)
    await join(t.consultId)
    const [a, b] = await Promise.all([
      callNext(t.ctx, t.officeId, t.w1, [t.consultId], null),
      callNext(t.ctx, t.officeId, t.w2, [t.consultId], null),
    ])
    expect(new Set([a?.code, b?.code])).toEqual(new Set(['C-001', 'C-002']))
  })

  it('can call a specific ticket out of order, but not one already taken', async () => {
    await join(t.consultId)
    const second = await join(t.consultId)
    expect((await callTicket(t.ctx, t.officeId, second.id, t.w1, null)).code).toBe('C-002')
    await expect(callTicket(t.ctx, t.officeId, second.id, t.w2, null)).rejects.toMatchObject({ status: 409 })
  })

  it('cannot touch a ticket from another office', async () => {
    const ticket = await join(t.consultId)
    const [other] = await t.db.query<{ id: number }>(`INSERT INTO offices (slug, name) VALUES ('y', 'Y') RETURNING id`)
    await expect(markNoShow(t.ctx, other.id, ticket.id)).rejects.toMatchObject({ status: 409 })
    await expect(callTicket(t.ctx, other.id, ticket.id, t.w1, null)).rejects.toMatchObject({ status: 404 })
  })

  it('tracks complete, no-show and cancel transitions', async () => {
    const a = await join(t.consultId)
    const b = await join(t.consultId)
    const c = await join(t.consultId)

    await cancelTicket(t.ctx, c.id)
    await expect(cancelTicket(t.ctx, c.id)).rejects.toMatchObject({ status: 409 })

    await callNext(t.ctx, t.officeId, t.w1, [t.consultId], null)
    await completeTicket(t.ctx, t.officeId, a.id)
    await expect(completeTicket(t.ctx, t.officeId, a.id)).rejects.toMatchObject({ status: 409 })

    await markNoShow(t.ctx, t.officeId, b.id)
    const snap = await staffSnapshot(t.ctx, t.officeId)
    expect(snap.waiting).toHaveLength(0)
    expect(snap.stats).toMatchObject({ servedToday: 1, noShowToday: 1 })
  })
})

describe('position and wait estimates', () => {
  it('counts people ahead in the same service, priority lane included', async () => {
    await join(t.consultId)
    await join(t.labId) // a different line; not ahead of anyone in consultation
    t.clock.advance(1)
    const me = await join(t.consultId)
    t.clock.advance(1)
    await join(t.consultId, { isPriority: true }) // arrives later but goes ahead

    const view = await ticketView(t.ctx, me.id)
    expect(view.ahead).toBe(2)
    expect(view.estWaitSec).toBe(2 * 5 * 60) // no history yet: default 5 minutes each
  })

  it('learns the real service time from history', async () => {
    for (let i = 0; i < 3; i++) await join(t.consultId)
    // Serve two people, 2 minutes each.
    await callNext(t.ctx, t.officeId, t.w1, [t.consultId], null)
    t.clock.advance(2)
    await callNext(t.ctx, t.officeId, t.w1, [t.consultId], null)
    t.clock.advance(2)
    await callNext(t.ctx, t.officeId, t.w1, [], null) // finish without calling anyone
    const snap = await publicSnapshot(t.ctx, t.officeId)
    const consult = snap.services.find((s) => s.id === t.consultId)!
    expect(consult.avgServiceSec).toBe(120)
    expect(consult.waiting).toBe(1)
    expect(consult.estWaitSec).toBe(120)
  })

  it('shows the counter while serving and hides names from the public snapshot', async () => {
    const a = await join(t.consultId, { customerName: 'Maria Santos' })
    await callNext(t.ctx, t.officeId, t.w2, [t.consultId], null)
    const view = await ticketView(t.ctx, a.id)
    expect(view).toMatchObject({ status: 'serving', counterName: 'Window 2', ahead: null })

    const snap = await publicSnapshot(t.ctx, t.officeId)
    expect(snap.nowServing.find((n) => n.counterId === t.w2)?.code).toBe('C-001')
    expect(JSON.stringify(snap)).not.toContain('Maria')
    expect(JSON.stringify(snap)).not.toContain(a.id)
  })
})
