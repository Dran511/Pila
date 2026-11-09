// The queue engine: issuing numbers, calling people to counters, and estimating waits.
// Every state change happens in a transaction, and "call next" locks rows, so two counters
// pressing the button at the same moment can never get the same person.

import type {
  CalledEvent,
  NowServing,
  PublicSnapshot,
  ServiceQueueInfo,
  StaffSnapshot,
  StaffTicket,
  TicketView,
} from '../shared/types.js'
import type { Db, Queryable } from './db/index.js'
import { conflict, notFound } from './http.js'
import { localDate, type Clock } from './time.js'

export interface Ctx {
  db: Db
  now: Clock
}

export interface OfficeRow {
  id: number
  slug: string
  name: string
  address: string | null
  timezone: string
  isOpen: boolean
  isDemo: boolean
}

/** Format a timestamp column as an ISO string, the same way on both database drivers. */
export const iso = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`

const OFFICE_COLS = `id, slug, name, address, timezone, is_open AS "isOpen", is_demo AS "isDemo"`

/** Defaults used until a service has enough history to estimate from. */
export const DEFAULT_SERVICE_SEC = 5 * 60
const MIN_SERVICE_SEC = 60
const MAX_SERVICE_SEC = 30 * 60

export async function getOffice(q: Queryable, id: number): Promise<OfficeRow> {
  const [office] = await q.query<OfficeRow>(`SELECT ${OFFICE_COLS} FROM offices WHERE id = $1`, [id])
  if (!office) throw notFound('Office not found')
  return office
}

export async function getOfficeBySlug(q: Queryable, slug: string): Promise<OfficeRow> {
  const [office] = await q.query<OfficeRow>(`SELECT ${OFFICE_COLS} FROM offices WHERE slug = $1`, [
    slug.toLowerCase(),
  ])
  if (!office) throw notFound('Office not found')
  return office
}

export const formatCode = (prefix: string, n: number) => `${prefix}-${String(n).padStart(3, '0')}`

// ─── Issuing tickets ──────────────────────────────────────────────────────────

export interface NewTicket {
  serviceId: number
  customerName?: string | null
  isPriority?: boolean
  source?: 'online' | 'walk_in'
}

export async function createTicket(ctx: Ctx, officeId: number, input: NewTicket) {
  const now = ctx.now()
  return ctx.db.tx(async (q) => {
    const office = await getOffice(q, officeId)
    const source = input.source ?? 'online'
    if (!office.isOpen && source === 'online') throw conflict('This office is not accepting new tickets right now.')

    const [service] = await q.query<{ id: number; prefix: string; name: string }>(
      `SELECT id, prefix, name FROM services WHERE id = $1 AND office_id = $2 AND is_active`,
      [input.serviceId, officeId],
    )
    if (!service) throw notFound('Service not found')

    const date = localDate(now, office.timezone)
    // Atomic per-service, per-day counter: C-001, C-002, ... and back to 001 tomorrow.
    const [{ n }] = await q.query<{ n: number }>(
      `INSERT INTO daily_sequences (service_id, service_date, last_number) VALUES ($1, $2, 1)
       ON CONFLICT (service_id, service_date)
       DO UPDATE SET last_number = daily_sequences.last_number + 1
       RETURNING last_number AS n`,
      [service.id, date],
    )
    const code = formatCode(service.prefix, n)
    const [ticket] = await q.query<{ id: string }>(
      `INSERT INTO tickets (office_id, service_id, service_date, number, code, customer_name, is_priority, source, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [officeId, service.id, date, n, code, input.customerName?.trim() || null, !!input.isPriority, source, now],
    )
    return { id: ticket.id, code, officeId }
  })
}

// ─── Serving ──────────────────────────────────────────────────────────────────

async function lockCounter(q: Queryable, officeId: number, counterId: number) {
  const [counter] = await q.query<{ id: number; name: string }>(
    `SELECT id, name FROM counters WHERE id = $1 AND office_id = $2 AND is_active FOR UPDATE`,
    [counterId, officeId],
  )
  if (!counter) throw notFound('Counter not found')
  return counter
}

/** Finish whoever is at this counter (pressing "Next" means the last person is done). */
async function finishCurrent(q: Queryable, counterId: number, at: Date) {
  await q.query(
    `UPDATE tickets SET status = 'done', completed_at = $2 WHERE counter_id = $1 AND status = 'serving'`,
    [counterId, at],
  )
}

async function startServing(q: Queryable, ticketId: string, counter: { id: number; name: string }, userId: number | null, at: Date): Promise<CalledEvent> {
  const [row] = await q.query<{ code: string; serviceName: string }>(
    `UPDATE tickets t SET status = 'serving', counter_id = $2, served_by = $3, called_at = $4
     FROM services s WHERE t.id = $1 AND s.id = t.service_id
     RETURNING t.code, s.name AS "serviceName"`,
    [ticketId, counter.id, userId, at],
  )
  return { code: row.code, serviceName: row.serviceName, counterName: counter.name, recall: false }
}

/**
 * Call the next person for any of `serviceIds` to `counterId`.
 * Priority lane (seniors, PWDs, pregnant women) first, then first come, first served.
 * Returns null when nobody is waiting.
 */
export async function callNext(
  ctx: Ctx,
  officeId: number,
  counterId: number,
  serviceIds: number[],
  userId: number | null,
): Promise<CalledEvent | null> {
  const now = ctx.now()
  return ctx.db.tx(async (q) => {
    const office = await getOffice(q, officeId)
    const counter = await lockCounter(q, officeId, counterId)
    await finishCurrent(q, counter.id, now)
    if (serviceIds.length === 0) return null
    const [next] = await q.query<{ id: string }>(
      `SELECT id FROM tickets
       WHERE office_id = $1 AND service_date = $2 AND status = 'waiting' AND service_id = ANY($3::int[])
       ORDER BY is_priority DESC, created_at, number
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [officeId, localDate(now, office.timezone), serviceIds],
    )
    if (!next) return null
    return startServing(q, next.id, counter, userId, now)
  })
}

/** Call one specific waiting ticket (e.g. staff skip ahead for an emergency). */
export async function callTicket(ctx: Ctx, officeId: number, ticketId: string, counterId: number, userId: number | null) {
  const now = ctx.now()
  return ctx.db.tx(async (q) => {
    const counter = await lockCounter(q, officeId, counterId)
    const [ticket] = await q.query<{ id: string }>(
      `SELECT id FROM tickets WHERE id = $1 AND office_id = $2 AND status = 'waiting' FOR UPDATE`,
      [ticketId, officeId],
    )
    if (!ticket) throw conflict('That ticket is no longer waiting.')
    await finishCurrent(q, counter.id, now)
    return startServing(q, ticket.id, counter, userId, now)
  })
}

/** Announce the current ticket again (the person did not hear it). */
export async function recallTicket(ctx: Ctx, officeId: number, ticketId: string): Promise<CalledEvent> {
  const [row] = await ctx.db.query<{ code: string; serviceName: string; counterName: string }>(
    `SELECT t.code, s.name AS "serviceName", c.name AS "counterName"
     FROM tickets t JOIN services s ON s.id = t.service_id JOIN counters c ON c.id = t.counter_id
     WHERE t.id = $1 AND t.office_id = $2 AND t.status = 'serving'`,
    [ticketId, officeId],
  )
  if (!row) throw conflict('That ticket is not at a counter.')
  return { ...row, recall: true }
}

export async function completeTicket(ctx: Ctx, officeId: number, ticketId: string) {
  const rows = await ctx.db.query(
    `UPDATE tickets SET status = 'done', completed_at = $3
     WHERE id = $1 AND office_id = $2 AND status = 'serving' RETURNING id`,
    [ticketId, officeId, ctx.now()],
  )
  if (!rows.length) throw conflict('That ticket is not at a counter.')
}

export async function markNoShow(ctx: Ctx, officeId: number, ticketId: string) {
  const rows = await ctx.db.query(
    `UPDATE tickets SET status = 'no_show', completed_at = $3
     WHERE id = $1 AND office_id = $2 AND status IN ('waiting', 'serving') RETURNING id`,
    [ticketId, officeId, ctx.now()],
  )
  if (!rows.length) throw conflict('That ticket is already closed.')
}

/** The ticket holder leaves the line. Anyone with the ticket link can do this. */
export async function cancelTicket(ctx: Ctx, ticketId: string): Promise<number> {
  const [row] = await ctx.db.query<{ officeId: number }>(
    `UPDATE tickets SET status = 'cancelled', completed_at = $2
     WHERE id = $1 AND status = 'waiting' RETURNING office_id AS "officeId"`,
    [ticketId, ctx.now()],
  )
  if (!row) throw conflict('Only a waiting ticket can be cancelled.')
  return row.officeId
}

/** Close anything left open from previous days (people who never came back, counters never closed). */
export async function closeStaleTickets(db: Db) {
  return db.query(
    `UPDATE tickets t SET status = 'cancelled'
     FROM offices o
     WHERE o.id = t.office_id AND t.status IN ('waiting', 'serving')
       AND t.service_date < (now() AT TIME ZONE o.timezone)::date
     RETURNING t.office_id AS "officeId"`,
  )
}

// ─── Wait-time estimates ──────────────────────────────────────────────────────

interface ServiceStats {
  avgServiceSec: number
  activeCounters: number
}

/**
 * Per service: the average time a counter spends on one person (last 30 served, past 14 days)
 * and how many counters have served it in the past hour. Wait ≈ people ahead × avg ÷ counters.
 */
async function serviceStats(q: Queryable, officeId: number, now: Date): Promise<Map<number, ServiceStats>> {
  const since = new Date(now.getTime() - 14 * 86400_000)
  const hourAgo = new Date(now.getTime() - 3600_000)
  const [avgs, counters] = await Promise.all([
    q.query<{ serviceId: number; avgSec: number }>(
      `SELECT service_id AS "serviceId", avg(sec)::float AS "avgSec" FROM (
         SELECT service_id, extract(epoch FROM completed_at - called_at) AS sec,
                row_number() OVER (PARTITION BY service_id ORDER BY completed_at DESC) AS rn
         FROM tickets
         WHERE office_id = $1 AND status = 'done' AND completed_at > $2 AND called_at IS NOT NULL
       ) recent WHERE rn <= 30 GROUP BY service_id`,
      [officeId, since],
    ),
    q.query<{ serviceId: number; n: number }>(
      `SELECT service_id AS "serviceId", count(DISTINCT counter_id)::int AS n
       FROM tickets WHERE office_id = $1 AND called_at > $2 AND counter_id IS NOT NULL
       GROUP BY service_id`,
      [officeId, hourAgo],
    ),
  ])
  const map = new Map<number, ServiceStats>()
  for (const a of avgs) {
    map.set(a.serviceId, {
      avgServiceSec: Math.round(Math.min(MAX_SERVICE_SEC, Math.max(MIN_SERVICE_SEC, a.avgSec))),
      activeCounters: 1,
    })
  }
  for (const c of counters) {
    const s = map.get(c.serviceId) ?? { avgServiceSec: DEFAULT_SERVICE_SEC, activeCounters: 1 }
    s.activeCounters = Math.max(1, c.n)
    map.set(c.serviceId, s)
  }
  return map
}

export const estimateWaitSec = (ahead: number, s: ServiceStats | undefined) =>
  Math.round((ahead * (s?.avgServiceSec ?? DEFAULT_SERVICE_SEC)) / Math.max(1, s?.activeCounters ?? 1))

// ─── Snapshots ────────────────────────────────────────────────────────────────

export async function publicSnapshot(ctx: Ctx, officeId: number): Promise<PublicSnapshot> {
  const now = ctx.now()
  const q = ctx.db
  const office = await getOffice(q, officeId)
  const date = localDate(now, office.timezone)

  const [services, waitingCounts, nowServing, upNext, [served], stats] = await Promise.all([
    q.query<{ id: number; name: string; prefix: string; description: string | null }>(
      `SELECT id, name, prefix, description FROM services WHERE office_id = $1 AND is_active ORDER BY sort_order, id`,
      [officeId],
    ),
    q.query<{ serviceId: number; n: number }>(
      `SELECT service_id AS "serviceId", count(*)::int AS n FROM tickets
       WHERE office_id = $1 AND service_date = $2 AND status = 'waiting' GROUP BY service_id`,
      [officeId, date],
    ),
    q.query<NowServing>(
      `SELECT c.id AS "counterId", c.name AS "counterName", t.code, t.service_id AS "serviceId",
              ${iso('t.called_at')} AS "calledAt"
       FROM counters c
       LEFT JOIN tickets t ON t.counter_id = c.id AND t.status = 'serving'
       WHERE c.office_id = $1 AND c.is_active ORDER BY c.sort_order, c.id`,
      [officeId],
    ),
    q.query<{ code: string; serviceId: number; isPriority: boolean }>(
      `SELECT code, service_id AS "serviceId", is_priority AS "isPriority" FROM tickets
       WHERE office_id = $1 AND service_date = $2 AND status = 'waiting'
       ORDER BY is_priority DESC, created_at, number LIMIT 12`,
      [officeId, date],
    ),
    q.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM tickets WHERE office_id = $1 AND service_date = $2 AND status = 'done'`,
      [officeId, date],
    ),
    serviceStats(q, officeId, now),
  ])

  const waiting = new Map(waitingCounts.map((w) => [w.serviceId, w.n]))
  const serviceInfo: ServiceQueueInfo[] = services.map((s) => {
    const n = waiting.get(s.id) ?? 0
    const st = stats.get(s.id)
    return {
      ...s,
      waiting: n,
      avgServiceSec: st?.avgServiceSec ?? DEFAULT_SERVICE_SEC,
      estWaitSec: estimateWaitSec(n, st),
    }
  })

  return {
    office: { slug: office.slug, name: office.name, address: office.address, isOpen: office.isOpen },
    services: serviceInfo,
    nowServing,
    upNext,
    servedToday: served.n,
    generatedAt: now.toISOString(),
  }
}

const STAFF_TICKET_COLS = `
  t.id, t.code, t.service_id AS "serviceId", s.name AS "serviceName", t.customer_name AS "customerName",
  t.is_priority AS "isPriority", t.status, t.source, t.counter_id AS "counterId",
  ${iso('t.created_at')} AS "createdAt", ${iso('t.called_at')} AS "calledAt"`

export async function staffSnapshot(ctx: Ctx, officeId: number): Promise<StaffSnapshot> {
  const now = ctx.now()
  const q = ctx.db
  const office = await getOffice(q, officeId)
  const date = localDate(now, office.timezone)
  const [waiting, serving, counters, services, [stats]] = await Promise.all([
    q.query<StaffTicket>(
      `SELECT ${STAFF_TICKET_COLS} FROM tickets t JOIN services s ON s.id = t.service_id
       WHERE t.office_id = $1 AND t.service_date = $2 AND t.status = 'waiting'
       ORDER BY t.is_priority DESC, t.created_at, t.number`,
      [officeId, date],
    ),
    q.query<StaffTicket>(
      `SELECT ${STAFF_TICKET_COLS} FROM tickets t JOIN services s ON s.id = t.service_id
       WHERE t.office_id = $1 AND t.status = 'serving'`,
      [officeId],
    ),
    q.query(
      `SELECT id, name, is_active AS "isActive" FROM counters WHERE office_id = $1 ORDER BY sort_order, id`,
      [officeId],
    ),
    q.query(
      `SELECT id, name, prefix, description, is_active AS "isActive", sort_order AS "sortOrder"
       FROM services WHERE office_id = $1 ORDER BY sort_order, id`,
      [officeId],
    ),
    q.query<{ served: number; noShow: number; avgWait: number | null }>(
      `SELECT count(*) FILTER (WHERE status = 'done')::int AS served,
              count(*) FILTER (WHERE status = 'no_show')::int AS "noShow",
              avg(extract(epoch FROM called_at - created_at)) FILTER (WHERE called_at IS NOT NULL)::float AS "avgWait"
       FROM tickets WHERE office_id = $1 AND service_date = $2`,
      [officeId, date],
    ),
  ])
  return {
    waiting,
    serving,
    counters: counters as never,
    services: services as never,
    stats: {
      servedToday: stats.served,
      noShowToday: stats.noShow,
      avgWaitSecToday: stats.avgWait == null ? null : Math.round(stats.avgWait),
    },
    isOpen: office.isOpen,
  }
}

export async function ticketView(ctx: Ctx, ticketId: string): Promise<TicketView> {
  const [t] = await ctx.db.query<{
    id: string
    code: string
    status: TicketView['status']
    isPriority: boolean
    customerName: string | null
    serviceId: number
    serviceName: string
    officeId: number
    officeSlug: string
    officeName: string
    counterName: string | null
    ahead: number
    createdAt: string
    calledAt: string | null
    completedAt: string | null
  }>(
    `SELECT t.id, t.code, t.status, t.is_priority AS "isPriority", t.customer_name AS "customerName",
            s.id AS "serviceId", s.name AS "serviceName",
            o.id AS "officeId", o.slug AS "officeSlug", o.name AS "officeName",
            c.name AS "counterName",
            (SELECT count(*)::int FROM tickets a
              WHERE a.service_id = t.service_id AND a.service_date = t.service_date AND a.status = 'waiting'
                AND ((a.is_priority AND NOT t.is_priority)
                  OR (a.is_priority = t.is_priority AND (a.created_at, a.number) < (t.created_at, t.number)))
            ) AS ahead,
            ${iso('t.created_at')} AS "createdAt", ${iso('t.called_at')} AS "calledAt",
            ${iso('t.completed_at')} AS "completedAt"
     FROM tickets t
     JOIN services s ON s.id = t.service_id
     JOIN offices o ON o.id = t.office_id
     LEFT JOIN counters c ON c.id = t.counter_id
     WHERE t.id = $1`,
    [ticketId],
  )
  if (!t) throw notFound('Ticket not found')
  const waiting = t.status === 'waiting'
  const stats = waiting ? (await serviceStats(ctx.db, t.officeId, ctx.now())).get(t.serviceId) : undefined
  return {
    id: t.id,
    code: t.code,
    status: t.status,
    isPriority: t.isPriority,
    customerName: t.customerName,
    service: { id: t.serviceId, name: t.serviceName },
    office: { slug: t.officeSlug, name: t.officeName },
    counterName: t.status === 'serving' ? t.counterName : null,
    ahead: waiting ? t.ahead : null,
    estWaitSec: waiting ? estimateWaitSec(t.ahead, stats) : null,
    createdAt: t.createdAt,
    calledAt: t.calledAt,
    completedAt: t.completedAt,
  }
}

/** Which office a ticket belongs to (for routing real-time updates). */
export async function ticketOffice(db: Db, ticketId: string): Promise<number> {
  const [row] = await db.query<{ officeId: number }>(`SELECT office_id AS "officeId" FROM tickets WHERE id = $1`, [ticketId])
  if (!row) throw notFound('Ticket not found')
  return row.officeId
}
