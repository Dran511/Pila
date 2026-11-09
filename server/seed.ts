// The demo office: a fictional barangay health center with two weeks of realistic history,
// so the analytics have something to show and the queue looks alive whenever someone visits.
//
// History is generated with a small simulation (people arrive on a morning-heavy curve and
// three windows serve them first come, first served), so wait times are realistic, not random.

import { hashPassword } from './auth.js'
import type { Queryable } from './db/index.js'
import { callNext, createTicket, formatCode, type Ctx } from './queue.js'
import { addDays, localDate } from './time.js'

export const DEMO_SLUG = 'demo'
export const DEMO_PASSWORD = 'demo1234'
const TZ = 'Asia/Manila'
const UTC_OFFSET = '+08:00'

const SERVICES = [
  { name: 'Consultation', prefix: 'C', description: 'Check-ups with the doctor or nurse', weight: 45, mins: 7 },
  { name: 'Laboratory', prefix: 'L', description: 'Blood tests, urinalysis and other lab work', weight: 20, mins: 4 },
  { name: 'Medicine Pick-up', prefix: 'P', description: 'Prescriptions and maintenance medicines', weight: 25, mins: 2.5 },
  { name: 'Immunization', prefix: 'I', description: 'Vaccines for babies, children and adults', weight: 10, mins: 5 },
]
const COUNTERS = ['Window 1', 'Window 2', 'Window 3']

const FIRST = ['Maria', 'Jose', 'Ana', 'Juan', 'Rosa', 'Mark', 'Liza', 'Paolo', 'Grace', 'Ramon', 'Joy', 'Carlo',
  'Nena', 'Rey', 'Aileen', 'Jun', 'Tess', 'Arnel', 'Divina', 'Kevin', 'Marites', 'Rodel', 'Cristina', 'Jomar']
const LAST = 'ABCDEFGLMNPRST'

/** Deterministic pseudo-random numbers, so a given day always generates the same history. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T>(r: () => number, items: T[]) => items[Math.floor(r() * items.length)]
const weighted = <T extends { weight: number }>(r: () => number, items: T[]) => {
  let x = r() * items.reduce((s, i) => s + i.weight, 0)
  for (const i of items) if ((x -= i.weight) < 0) return i
  return items[items.length - 1]
}
export const randomName = (r: () => number = Math.random) =>
  r() < 0.25 ? null : `${pick(r, FIRST)} ${LAST[Math.floor(r() * LAST.length)]}.`

/**
 * Arrivals per hour (local). Like most health centers, many people line up before the 8 AM opening,
 * so the morning backlog is where long waits come from (and where Pila helps most).
 */
const HOURLY = { 6: 9, 7: 20, 8: 17, 9: 13, 10: 9, 11: 5, 12: 2, 13: 8, 14: 6, 15: 3 } as Record<number, number>
const OPENS_AT = '08:00'

interface SimTicket {
  serviceIdx: number
  number: number
  name: string | null
  priority: boolean
  createdAt: Date
  calledAt: Date | null
  completedAt: Date | null
  status: 'done' | 'no_show' | 'waiting' | 'serving'
  counterIdx: number | null
}

/** Simulate a day: arrivals → 3 windows serving first come, first served (priority first). */
function simulateDay(date: string, r: () => number, opts: { scale?: number } = {}): SimTicket[] {
  const scale = opts.scale ?? 1
  const arrivals: { at: Date; serviceIdx: number }[] = []
  for (const [hourStr, perHour] of Object.entries(HOURLY)) {
    const hour = Number(hourStr)
    const n = Math.round(perHour * scale * (0.75 + r() * 0.5))
    for (let i = 0; i < n; i++) {
      const minute = Math.floor(r() * 60)
      const at = new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${UTC_OFFSET}`)
      arrivals.push({ at: new Date(at.getTime() + Math.floor(r() * 60_000)), serviceIdx: SERVICES.indexOf(weighted(r, SERVICES)) })
    }
  }
  arrivals.sort((a, b) => a.at.getTime() - b.at.getTime())

  const numbers = SERVICES.map(() => 0)
  const tickets: SimTicket[] = arrivals.map((a) => ({
    serviceIdx: a.serviceIdx,
    number: ++numbers[a.serviceIdx],
    name: randomName(r),
    priority: r() < 0.15,
    createdAt: a.at,
    calledAt: null,
    completedAt: null,
    status: 'waiting',
    counterIdx: null,
  }))

  const freeAt = COUNTERS.map(() => new Date(`${date}T${OPENS_AT}:00${UTC_OFFSET}`).getTime())
  const queue = [...tickets]
  while (queue.length) {
    const c = freeAt.indexOf(Math.min(...freeAt))
    const t0 = freeAt[c]
    // Among people already waiting when the window frees up, priority first.
    const arrived = queue.filter((t) => t.createdAt.getTime() <= t0)
    const next = arrived.find((t) => t.priority) ?? arrived[0] ?? queue[0]
    queue.splice(queue.indexOf(next), 1)
    const callAt = Math.max(t0, next.createdAt.getTime()) + Math.floor(r() * 40_000)
    next.calledAt = new Date(callAt)
    next.counterIdx = c
    if (r() < 0.06) {
      next.status = 'no_show'
      next.completedAt = new Date(callAt + 90_000)
    } else {
      next.status = 'done'
      next.completedAt = new Date(callAt + Math.round(SERVICES[next.serviceIdx].mins * (0.5 + r()) * 60_000))
    }
    freeAt[c] = next.completedAt.getTime()
  }
  return tickets
}

async function insertTickets(
  q: Queryable,
  officeId: number,
  date: string,
  serviceIds: number[],
  counterIds: number[],
  tickets: SimTicket[],
) {
  const rows = tickets.map((t) => [
    officeId,
    serviceIds[t.serviceIdx],
    date,
    t.number,
    formatCode(SERVICES[t.serviceIdx].prefix, t.number),
    t.name,
    t.priority,
    'online',
    t.status,
    t.counterIdx == null ? null : counterIds[t.counterIdx],
    t.createdAt,
    t.calledAt,
    t.completedAt,
  ])
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100)
    const values = chunk.map((_, j) => `(${Array.from({ length: 13 }, (_, k) => `$${j * 13 + k + 1}`).join(', ')})`)
    await q.query(
      `INSERT INTO tickets (office_id, service_id, service_date, number, code, customer_name, is_priority, source,
                            status, counter_id, created_at, called_at, completed_at)
       VALUES ${values.join(', ')}`,
      chunk.flat(),
    )
  }
  for (const [idx, id] of serviceIds.entries()) {
    const last = Math.max(0, ...tickets.filter((t) => t.serviceIdx === idx).map((t) => t.number))
    if (last > 0) {
      await q.query(
        `INSERT INTO daily_sequences (service_id, service_date, last_number) VALUES ($1, $2, $3)
         ON CONFLICT (service_id, service_date) DO UPDATE SET last_number = GREATEST(daily_sequences.last_number, $3)`,
        [id, date, last],
      )
    }
  }
}

async function demoIds(q: Queryable, officeId: number) {
  const services = await q.query<{ id: number; prefix: string }>(`SELECT id, prefix FROM services WHERE office_id = $1`, [officeId])
  const counters = await q.query<{ id: number; name: string }>(`SELECT id, name FROM counters WHERE office_id = $1`, [officeId])
  return {
    serviceIds: SERVICES.map((s) => services.find((x) => x.prefix === s.prefix)?.id ?? -1),
    counterIds: COUNTERS.map((n) => counters.find((x) => x.name === n)?.id ?? -1),
  }
}

/** Make today's queue look like a live morning: people served, two at windows, a few waiting. */
async function seedToday(q: Queryable, officeId: number, now: Date) {
  const today = localDate(now, TZ)
  // During office hours, replay the real day up to now. Outside them, pretend it is mid-morning,
  // so whoever opens the demo at night still sees a working queue.
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(now))
  const shiftMs = hour >= 9 && hour < 17 ? 0 : now.getTime() - new Date(`${today}T10:00:00${UTC_OFFSET}`).getTime()
  const r = rng(Number(today.replaceAll('-', '')) + 7)
  const sim = simulateDay(today, r, { scale: 0.9 })
    .map((t) => ({
      ...t,
      createdAt: new Date(t.createdAt.getTime() + shiftMs),
      calledAt: t.calledAt && new Date(t.calledAt.getTime() + shiftMs),
      completedAt: t.completedAt && new Date(t.completedAt.getTime() + shiftMs),
    }))
    .filter((t) => t.createdAt <= now && localDate(t.createdAt, TZ) === today)
  // Re-run the timeline cut at "now": anything not finished by now is still serving/waiting.
  for (const t of sim) {
    if (t.calledAt && t.calledAt > now) {
      t.calledAt = null
      t.completedAt = null
      t.counterIdx = null
      t.status = 'waiting'
    } else if (t.completedAt && t.completedAt > now) {
      t.completedAt = null
      t.status = 'serving'
    }
  }
  // At most one person per window, and keep a visible line of waiting people.
  const seen = new Set<number>()
  for (const t of [...sim].reverse()) {
    if (t.status !== 'serving') continue
    if (seen.has(t.counterIdx!)) {
      t.status = 'done'
      t.completedAt = new Date(t.calledAt!.getTime() + 4 * 60_000)
    } else seen.add(t.counterIdx!)
  }
  // Renumber so codes follow arrival order.
  const numbers = SERVICES.map(() => 0)
  for (const t of sim) t.number = ++numbers[t.serviceIdx]
  const { serviceIds, counterIds } = await demoIds(q, officeId)
  await insertTickets(q, officeId, today, serviceIds, counterIds, sim)
  // Top up the line to at least 6 waiting.
  const waiting = sim.filter((t) => t.status === 'waiting').length
  return Math.max(0, 6 - waiting)
}

/**
 * Create the demo office if missing, backfill any missing history days, and seed today.
 * Safe to call repeatedly (it runs at startup and every hour).
 */
export async function ensureDemo(ctx: Ctx) {
  const now = ctx.now()
  const today = localDate(now, TZ)
  const topUp = await ctx.db.tx(async (q) => {
    let [office] = await q.query<{ id: number }>(`SELECT id FROM offices WHERE slug = $1`, [DEMO_SLUG])
    if (!office) {
      ;[office] = await q.query<{ id: number }>(
        `INSERT INTO offices (slug, name, address, timezone, is_demo)
         VALUES ($1, 'Mabini Health Center', 'Brgy. Mabini, Northern Samar · Demo office', $2, TRUE) RETURNING id`,
        [DEMO_SLUG, TZ],
      )
      for (const [i, s] of SERVICES.entries()) {
        await q.query(
          `INSERT INTO services (office_id, name, prefix, description, sort_order) VALUES ($1, $2, $3, $4, $5)`,
          [office.id, s.name, s.prefix, s.description, i],
        )
      }
      for (const [i, name] of COUNTERS.entries()) {
        await q.query(`INSERT INTO counters (office_id, name, sort_order) VALUES ($1, $2, $3)`, [office.id, name, i])
      }
      const hash = await hashPassword(DEMO_PASSWORD)
      await q.query(
        `INSERT INTO users (office_id, name, email, password_hash, role) VALUES
           ($1, 'Dra. Liza Santos', 'admin@pila.demo', $2, 'admin'),
           ($1, 'Ramon Cruz', 'staff@pila.demo', $2, 'staff')`,
        [office.id, hash],
      )
    }

    const { serviceIds, counterIds } = await demoIds(q, office.id)
    if (serviceIds.includes(-1) || counterIds.includes(-1)) return 0 // someone edited the demo setup; skip

    const have = new Set(
      (
        await q.query<{ d: string }>(
          `SELECT DISTINCT service_date AS d FROM tickets WHERE office_id = $1 AND service_date >= $2`,
          [office.id, addDays(today, -14)],
        )
      ).map((r) => r.d),
    )
    for (let i = 14; i >= 1; i--) {
      const date = addDays(today, -i)
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
      if (weekday === 0 || have.has(date)) continue // closed on Sundays
      const r = rng(Number(date.replaceAll('-', '')))
      const tickets = simulateDay(date, r, { scale: weekday === 6 ? 0.45 : 1 })
      await insertTickets(q, office.id, date, serviceIds, counterIds, tickets)
    }
    if (!have.has(today)) return { officeId: office.id, n: await seedToday(q, office.id, now) }
    return 0
  })

  // A few more people arrived over the last several minutes, through the normal code path.
  if (topUp && topUp.n > 0) {
    const services = await ctx.db.query<{ id: number }>(`SELECT id FROM services WHERE office_id = $1 AND is_active ORDER BY sort_order`, [topUp.officeId])
    for (let i = 0; i < topUp.n; i++) {
      const at = new Date(now.getTime() - (topUp.n - i) * 3 * 60_000)
      await createTicket({ ...ctx, now: () => at }, topUp.officeId, {
        serviceId: weightedService(services.map((s) => s.id)),
        customerName: randomName(),
        isPriority: Math.random() < 0.15,
        source: 'online',
      })
    }
    // Make sure a couple of windows are busy, so the display board doesn't look idle.
    const idle = await ctx.db.query<{ id: number }>(
      `SELECT c.id FROM counters c
       WHERE c.office_id = $1 AND c.is_active
         AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.counter_id = c.id AND t.status = 'serving')
       ORDER BY c.sort_order LIMIT 2`,
      [topUp.officeId],
    )
    const serviceIds = services.map((s) => s.id)
    for (const [i, c] of idle.entries()) {
      const at = new Date(now.getTime() - (i + 1) * 2 * 60_000)
      await callNext({ ...ctx, now: () => at }, topUp.officeId, c.id, serviceIds, null)
    }
  }
}

function weightedService(ids: number[]) {
  const pickIdx = SERVICES.indexOf(weighted(Math.random, SERVICES))
  return ids[pickIdx] ?? ids[0]
}

/** Add `n` people to the demo queue (the "simulate walk-ins" button). */
export async function simulateArrivals(ctx: Ctx, officeId: number, n: number) {
  const services = await ctx.db.query<{ id: number; prefix: string }>(
    `SELECT id, prefix FROM services WHERE office_id = $1 AND is_active ORDER BY sort_order`,
    [officeId],
  )
  if (!services.length) return
  for (let i = 0; i < n; i++) {
    const byPrefix = SERVICES.map((s) => services.find((x) => x.prefix === s.prefix)?.id)
    const id = byPrefix.every(Boolean) ? weightedService(byPrefix as number[]) : pick(Math.random, services).id
    await createTicket(ctx, officeId, {
      serviceId: id,
      customerName: randomName(),
      isPriority: Math.random() < 0.15,
      source: Math.random() < 0.3 ? 'walk_in' : 'online',
    })
  }
}

/** Put the demo office back to how it started: default setup and a fresh "today". */
export async function resetDemo(ctx: Ctx, officeId: number) {
  const today = localDate(ctx.now(), TZ)
  await ctx.db.tx(async (q) => {
    await q.query(`DELETE FROM tickets WHERE office_id = $1 AND service_date = $2`, [officeId, today])
    await q.query(
      `DELETE FROM daily_sequences WHERE service_date = $2 AND service_id IN (SELECT id FROM services WHERE office_id = $1)`,
      [officeId, today],
    )
    await q.query(`UPDATE offices SET name = 'Mabini Health Center', is_open = TRUE WHERE id = $1`, [officeId])
    await q.query(`UPDATE services SET is_active = TRUE WHERE office_id = $1`, [officeId])
    await q.query(`UPDATE counters SET is_active = TRUE WHERE office_id = $1`, [officeId])
    for (const [i, s] of SERVICES.entries()) {
      await q.query(
        `UPDATE services SET name = $3, description = $4, sort_order = $5 WHERE office_id = $1 AND prefix = $2`,
        [officeId, s.prefix, s.name, s.description, i],
      )
    }
  })
  await ensureDemo(ctx)
}
