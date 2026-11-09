import request from 'supertest'
import { createApp } from '../server/app.js'
import { openDb, type Db } from '../server/db/index.js'
import type { Ctx } from '../server/queue.js'

/** A controllable clock: starts at 9:00 AM Manila time on a Monday. */
export function testClock(start = '2026-03-02T09:00:00+08:00') {
  let t = new Date(start).getTime()
  const now = () => new Date(t)
  return {
    now,
    advance(minutes: number) {
      t += minutes * 60_000
    },
    set(iso: string) {
      t = new Date(iso).getTime()
    },
  }
}

/** A fresh in-memory database with one office (2 services, 2 counters, an admin and a staff user). */
export async function setup() {
  const db = await openDb({ url: 'memory' })
  const clock = testClock()
  const ctx: Ctx = { db, now: clock.now }
  const office = await seedOffice(db, 'rhu', 'Test Rural Health Unit')
  return { db, clock, ctx, ...office }
}

export async function seedOffice(db: Db, slug: string, name: string) {
  const [office] = await db.query<{ id: number }>(`INSERT INTO offices (slug, name) VALUES ($1, $2) RETURNING id`, [slug, name])
  const [consult] = await db.query<{ id: number }>(
    `INSERT INTO services (office_id, name, prefix, sort_order) VALUES ($1, 'Consultation', 'C', 0) RETURNING id`,
    [office.id],
  )
  const [lab] = await db.query<{ id: number }>(
    `INSERT INTO services (office_id, name, prefix, sort_order) VALUES ($1, 'Laboratory', 'L', 1) RETURNING id`,
    [office.id],
  )
  const [w1] = await db.query<{ id: number }>(`INSERT INTO counters (office_id, name) VALUES ($1, 'Window 1') RETURNING id`, [office.id])
  const [w2] = await db.query<{ id: number }>(`INSERT INTO counters (office_id, name) VALUES ($1, 'Window 2') RETURNING id`, [office.id])
  return { officeId: office.id, consultId: consult.id, labId: lab.id, w1: w1.id, w2: w2.id }
}

/** A full app instance plus a cookie-keeping supertest agent. */
export async function setupApp() {
  const base = await setup()
  const { app, server, realtime } = createApp({ db: base.db, jwtSecret: 'test-secret', now: base.clock.now, rateLimits: false })
  const agent = () => request.agent(app)
  const close = async () => {
    await realtime.close()
    server.close()
    await base.db.close()
  }
  return { ...base, app, agent, close }
}
