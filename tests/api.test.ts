import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hashPassword } from '../server/auth.js'
import { seedOffice, setupApp } from './helpers.js'

let t: Awaited<ReturnType<typeof setupApp>>

beforeEach(async () => {
  t = await setupApp()
  const hash = await hashPassword('password123')
  await t.db.query(
    `INSERT INTO users (office_id, name, email, password_hash, role) VALUES
       ($1, 'Admin', 'admin@rhu.test', $2, 'admin'), ($1, 'Staff', 'staff@rhu.test', $2, 'staff')`,
    [t.officeId, hash],
  )
})
afterEach(async () => {
  await t.close()
})

async function signIn(email: string) {
  const agent = t.agent()
  const res = await agent.post('/api/auth/login').send({ email, password: 'password123' })
  expect(res.status).toBe(200)
  return agent
}

describe('auth', () => {
  it('signs in with an httpOnly cookie and reports the user', async () => {
    const agent = t.agent()
    const res = await agent.post('/api/auth/login').send({ email: 'ADMIN@rhu.test', password: 'password123' })
    expect(res.status).toBe(200)
    expect(res.headers['set-cookie'][0]).toMatch(/pila_session=.*HttpOnly/i)
    const me = await agent.get('/api/auth/me')
    expect(me.body.user).toMatchObject({ email: 'admin@rhu.test', role: 'admin', office: { slug: 'rhu' } })
  })

  it('gives the same error for a wrong password and an unknown email', async () => {
    const a = await t.agent().post('/api/auth/login').send({ email: 'admin@rhu.test', password: 'nope-nope' })
    const b = await t.agent().post('/api/auth/login').send({ email: 'ghost@rhu.test', password: 'nope-nope' })
    expect(a.status).toBe(401)
    expect(b.status).toBe(401)
    expect(a.body.error).toBe(b.body.error)
  })

  it('rejects forged session cookies', async () => {
    const res = await t.agent().get('/api/staff/queue').set('Cookie', 'pila_session=not.a.real.token')
    expect(res.status).toBe(401)
  })

  it('creates a new office with a unique link on sign-up', async () => {
    const one = await t.agent().post('/api/auth/signup').send({
      officeName: 'Barangay Hall', name: 'Ana', email: 'ana@hall.test', password: 'longenough',
    })
    const two = await t.agent().post('/api/auth/signup').send({
      officeName: 'Barangay Hall', name: 'Ben', email: 'ben@hall.test', password: 'longenough',
    })
    expect(one.status).toBe(201)
    expect(one.body.user.office.slug).toBe('barangay-hall')
    expect(two.body.user.office.slug).toBe('barangay-hall-2')
    const dup = await t.agent().post('/api/auth/signup').send({
      officeName: 'Other', name: 'Ana', email: 'ana@hall.test', password: 'longenough',
    })
    expect(dup.status).toBe(409)
  })

  it('validates input with helpful messages', async () => {
    const res = await t.agent().post('/api/auth/signup').send({ officeName: 'Hall', name: 'A', email: 'bad', password: 'short' })
    expect(res.status).toBe(400)
    expect(res.body.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['email', 'password']))
  })
})

describe('permissions', () => {
  it('requires sign-in for staff routes', async () => {
    expect((await t.agent().get('/api/staff/queue')).status).toBe(401)
  })

  it('keeps admin routes away from staff', async () => {
    const staff = await signIn('staff@rhu.test')
    expect((await staff.get('/api/staff/queue')).status).toBe(200)
    expect((await staff.get('/api/admin/analytics')).status).toBe(403)
    expect((await staff.post('/api/admin/services').send({ name: 'X-ray', prefix: 'X' })).status).toBe(403)
  })

  it('does not let one office act on another office’s tickets or counters', async () => {
    const other = await seedOffice(t.db, 'other', 'Other Office')
    const join = await t.agent().post('/api/public/offices/other/tickets').send({ serviceId: other.consultId })
    expect(join.status).toBe(201)

    const staff = await signIn('staff@rhu.test')
    expect((await staff.post(`/api/staff/tickets/${join.body.id}/no-show`)).status).toBe(409)
    expect((await staff.post(`/api/staff/counters/${other.w1}/next`).send({ serviceIds: [other.consultId] })).status).toBe(404)
    const snap = await staff.get('/api/staff/queue')
    expect(snap.body.waiting).toHaveLength(0)
  })
})

describe('the full flow', () => {
  it('join → see position → get called → served', async () => {
    const citizen = t.agent()
    const office = await citizen.get('/api/public/offices/rhu')
    expect(office.body.services.map((s: { prefix: string }) => s.prefix)).toEqual(['C', 'L'])

    const first = await citizen.post('/api/public/offices/rhu/tickets').send({ serviceId: t.consultId, customerName: 'Jose' })
    const second = await citizen.post('/api/public/offices/rhu/tickets').send({ serviceId: t.consultId })
    expect(first.body.code).toBe('C-001')

    let mine = await citizen.get(`/api/public/tickets/${second.body.id}`)
    expect(mine.body).toMatchObject({ status: 'waiting', ahead: 1, code: 'C-002' })

    const staff = await signIn('staff@rhu.test')
    const call = await staff.post(`/api/staff/counters/${t.w1}/next`).send({ serviceIds: [t.consultId] })
    expect(call.body.called).toMatchObject({ code: 'C-001', counterName: 'Window 1' })

    mine = await citizen.get(`/api/public/tickets/${second.body.id}`)
    expect(mine.body.ahead).toBe(0)

    await staff.post(`/api/staff/counters/${t.w1}/next`).send({ serviceIds: [t.consultId] })
    mine = await citizen.get(`/api/public/tickets/${second.body.id}`)
    expect(mine.body).toMatchObject({ status: 'serving', counterName: 'Window 1' })

    await staff.post(`/api/staff/tickets/${second.body.id}/complete`)
    mine = await citizen.get(`/api/public/tickets/${second.body.id}`)
    expect(mine.body.status).toBe('done')
  })

  it('lets the ticket holder cancel while waiting', async () => {
    const join = await t.agent().post('/api/public/offices/rhu/tickets').send({ serviceId: t.consultId })
    const res = await t.agent().post(`/api/public/tickets/${join.body.id}/cancel`)
    expect(res.body.status).toBe('cancelled')
  })

  it('returns 404 for unknown offices and malformed ticket ids', async () => {
    expect((await t.agent().get('/api/public/offices/nope')).status).toBe(404)
    expect((await t.agent().get('/api/public/tickets/123')).status).toBe(404)
  })

  it('reports analytics for admins', async () => {
    const citizen = t.agent()
    for (let i = 0; i < 3; i++) await citizen.post('/api/public/offices/rhu/tickets').send({ serviceId: t.consultId })
    const admin = await signIn('admin@rhu.test')
    await admin.post(`/api/staff/counters/${t.w1}/next`).send({ serviceIds: [t.consultId] })
    t.clock.advance(4)
    await admin.post(`/api/staff/counters/${t.w1}/next`).send({ serviceIds: [t.consultId] })
    const res = await admin.get('/api/admin/analytics?days=7')
    expect(res.status).toBe(200)
    expect(res.body.today).toMatchObject({ issued: 3, served: 1, waiting: 1 })
    expect(res.body.today.avgServiceSec).toBe(240)
    expect(res.body.daily).toHaveLength(7)
    expect(res.body.hourly[9].today).toBe(3) // all joined at 9 AM Manila time
  })

  it('protects service history from deletion', async () => {
    await t.agent().post('/api/public/offices/rhu/tickets').send({ serviceId: t.consultId })
    const admin = await signIn('admin@rhu.test')
    expect((await admin.delete(`/api/admin/services/${t.consultId}`)).status).toBe(409)
    expect((await admin.patch(`/api/admin/services/${t.consultId}`).send({ isActive: false })).body.isActive).toBe(false)
  })
})
