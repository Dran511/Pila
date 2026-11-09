import type { Analytics } from '../shared/types.js'
import { getOffice, type Ctx } from './queue.js'
import { addDays, localDate } from './time.js'

const round = (v: number | null) => (v == null ? null : Math.round(v))

/** Office performance for the last `days` days (including today), in the office's local time. */
export async function analytics(ctx: Ctx, officeId: number, days = 14): Promise<Analytics> {
  const q = ctx.db
  const office = await getOffice(q, officeId)
  const tz = office.timezone
  const today = localDate(ctx.now(), tz)
  const from = addDays(today, -(days - 1))

  const [[t], hourly, daily, byService] = await Promise.all([
    q.query<{
      issued: number
      served: number
      waiting: number
      noShows: number
      avgWait: number | null
      avgService: number | null
    }>(
      `SELECT count(*)::int AS issued,
              count(*) FILTER (WHERE status = 'done')::int AS served,
              count(*) FILTER (WHERE status = 'waiting')::int AS waiting,
              count(*) FILTER (WHERE status = 'no_show')::int AS "noShows",
              avg(extract(epoch FROM called_at - created_at)) FILTER (WHERE called_at IS NOT NULL)::float AS "avgWait",
              avg(extract(epoch FROM completed_at - called_at)) FILTER (WHERE status = 'done')::float AS "avgService"
       FROM tickets WHERE office_id = $1 AND service_date = $2`,
      [officeId, today],
    ),
    q.query<{ hour: number; isToday: boolean; n: number; activeDays: number }>(
      `SELECT extract(hour FROM created_at AT TIME ZONE $4)::int AS hour,
              (service_date = $3) AS "isToday",
              count(*)::int AS n,
              count(DISTINCT service_date)::int AS "activeDays"
       FROM tickets WHERE office_id = $1 AND service_date BETWEEN $2 AND $3
       GROUP BY 1, 2`,
      [officeId, from, today, tz],
    ),
    q.query<{ date: string; served: number; noShows: number; avgWait: number | null }>(
      `SELECT service_date AS date,
              count(*) FILTER (WHERE status = 'done')::int AS served,
              count(*) FILTER (WHERE status = 'no_show')::int AS "noShows",
              avg(extract(epoch FROM called_at - created_at)) FILTER (WHERE called_at IS NOT NULL)::float AS "avgWait"
       FROM tickets WHERE office_id = $1 AND service_date BETWEEN $2 AND $3
       GROUP BY service_date ORDER BY service_date`,
      [officeId, from, today],
    ),
    q.query<{
      serviceId: number
      name: string
      prefix: string
      served: number
      avgWait: number | null
      avgService: number | null
    }>(
      `SELECT s.id AS "serviceId", s.name, s.prefix,
              count(t.id) FILTER (WHERE t.status = 'done')::int AS served,
              avg(extract(epoch FROM t.called_at - t.created_at)) FILTER (WHERE t.called_at IS NOT NULL)::float AS "avgWait",
              avg(extract(epoch FROM t.completed_at - t.called_at)) FILTER (WHERE t.status = 'done')::float AS "avgService"
       FROM services s
       LEFT JOIN tickets t ON t.service_id = s.id AND t.service_date BETWEEN $2 AND $3
       WHERE s.office_id = $1
       GROUP BY s.id ORDER BY s.sort_order, s.id`,
      [officeId, from, today],
    ),
  ])

  // Average per hour across the past days the office actually had visitors (closed days don't dilute it).
  const pastDays = new Set(daily.filter((d) => d.date !== today && d.served + d.noShows > 0).map((d) => d.date)).size
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, today: 0, average: 0 }))
  for (const h of hourly) {
    if (h.isToday) hours[h.hour].today = h.n
    else if (pastDays > 0) hours[h.hour].average = Math.round((h.n / pastDays) * 10) / 10
  }

  const byDate = new Map(daily.map((d) => [d.date, d]))
  const dailyFilled = Array.from({ length: days }, (_, i) => {
    const date = addDays(from, i)
    const d = byDate.get(date)
    return { date, served: d?.served ?? 0, noShows: d?.noShows ?? 0, avgWaitSec: round(d?.avgWait ?? null) }
  })

  const totals = dailyFilled.reduce((a, d) => ({ served: a.served + d.served, noShows: a.noShows + d.noShows }), {
    served: 0,
    noShows: 0,
  })
  const busiest = hours.reduce<{ hour: number; v: number } | null>((best, h) => {
    const v = h.average + h.today / Math.max(1, pastDays + 1)
    return v > 0 && (!best || v > best.v) ? { hour: h.hour, v } : best
  }, null)

  return {
    days,
    today: {
      issued: t.issued,
      served: t.served,
      waiting: t.waiting,
      noShows: t.noShows,
      avgWaitSec: round(t.avgWait),
      avgServiceSec: round(t.avgService),
    },
    hourly: hours,
    daily: dailyFilled,
    byService: byService.map((s) => ({
      serviceId: s.serviceId,
      name: s.name,
      prefix: s.prefix,
      served: s.served,
      avgWaitSec: round(s.avgWait),
      avgServiceSec: round(s.avgService),
    })),
    busiestHour: busiest?.hour ?? null,
    noShowRate: totals.served + totals.noShows > 0 ? totals.noShows / (totals.served + totals.noShows) : null,
  }
}
