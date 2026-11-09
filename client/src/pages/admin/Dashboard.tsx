import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Analytics } from '../../../../shared/types'
import { BarChart } from '../../components/BarChart'
import { useDocumentTitle, useToast } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { hourLabel, minutesShort, pct } from '../../lib/format'
import { useStaffQueue } from '../../lib/socket'

export function AdminDashboard() {
  useDocumentTitle('Dashboard · Pila')
  const { user } = useAuth()
  const toast = useToast()
  const [days, setDays] = useState(14)
  const [data, setData] = useState<Analytics | null>(null)
  const [busy, setBusy] = useState(false)
  // Re-pull analytics whenever the live queue changes, so "today" numbers stay current.
  const live = useStaffQueue(null)

  const load = useCallback(async () => {
    try {
      setData(await api<Analytics>(`/admin/analytics?days=${days}`))
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }, [days, toast])

  useEffect(() => {
    void load()
  }, [load, live])

  async function demo(action: 'simulate' | 'reset') {
    setBusy(true)
    try {
      await api(`/admin/demo/${action}`, { body: { count: 5 } })
      toast(action === 'simulate' ? '5 people just joined the line' : 'Demo office reset')
      await load()
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!data) return <div className="page-loading" aria-busy="true" />

  const openHours = data.hourly.filter((h) => h.hour >= 6 && h.hour <= 18)
  const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
  const weekday = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-PH', { weekday: 'short' })

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>How {user?.office.name} is doing today and over the last {days} days.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select className="input" style={{ width: 'auto', minHeight: 40 }} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
          <Link to="/poster" className="btn">
            Print QR poster
          </Link>
        </div>
      </div>

      {user?.office.isDemo && (
        <div className="card card-pad" style={{ marginBottom: 20, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <b>Demo tools</b>
            <p className="small muted">Add a rush of people to watch the counter, display board and wait estimates react.</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => demo('simulate')}>
              Simulate 5 arrivals
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => demo('reset')}>
              Reset demo
            </button>
          </div>
        </div>
      )}

      <div className="kpis">
        <Kpi label="Served today" value={data.today.served} sub={`${data.today.issued} numbers issued`} />
        <Kpi label="Waiting now" value={data.today.waiting} sub={live ? `${live.serving.length} at a counter` : undefined} />
        <Kpi label="Avg wait today" value={minutesShort(data.today.avgWaitSec)} sub="from joining to being called" />
        <Kpi label="Avg time at counter" value={minutesShort(data.today.avgServiceSec)} sub="per person, today" />
        <Kpi label="No-show rate" value={pct(data.noShowRate)} sub={`last ${days} days`} />
        <Kpi label="Busiest hour" value={data.busiestHour == null ? '—' : hourLabel(data.busiestHour)} sub="add staff around then" />
      </div>

      <div className="grid-2">
        <section className="card card-pad">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <h2 style={{ fontSize: 16 }}>Arrivals by hour</h2>
            <div className="chart-legend">
              <span>
                <i style={{ background: 'var(--brand)' }} />
                Today
              </span>
              <span>
                <i style={{ background: 'var(--sun)' }} />
                Average day
              </span>
            </div>
          </div>
          <BarChart
            title="People who joined the queue each hour, today compared with an average day"
            data={openHours.map((h) => ({
              label: hourLabel(h.hour),
              value: h.today,
              line: h.average,
              tip: `${hourLabel(h.hour)}: ${h.today} today · ${h.average} on average`,
            }))}
          />
        </section>

        <section className="card">
          <div className="card-head">
            <h2>By service</h2>
            <span className="small muted">last {days} days</span>
          </div>
          <div className="table-wrap">
            <table className="list">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Served</th>
                  <th>Avg wait</th>
                  <th>At counter</th>
                </tr>
              </thead>
              <tbody>
                {data.byService.map((s) => (
                  <tr key={s.serviceId}>
                    <td>
                      <span className="badge" style={{ marginRight: 6 }}>{s.prefix}</span>
                      {s.name}
                    </td>
                    <td className="num">{s.served}</td>
                    <td className="num">{minutesShort(s.avgWaitSec)}</td>
                    <td className="num">{minutesShort(s.avgServiceSec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="card card-pad">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <h2 style={{ fontSize: 16 }}>People served per day</h2>
          <span className="small muted">Hover a bar for the average wait that day</span>
        </div>
        <BarChart
          title={`People served per day over the last ${days} days`}
          height={200}
          showEvery={days > 14 ? 3 : 1}
          data={data.daily.map((d) => ({
            label: days > 14 ? fmtDay(d.date) : weekday(d.date),
            value: d.served,
            tip: `${fmtDay(d.date)}: ${d.served} served, ${d.noShows} no-shows, avg wait ${minutesShort(d.avgWaitSec)}`,
          }))}
        />
      </section>
    </>
  )
}

function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card kpi">
      <span>{label}</span>
      <b>{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  )
}
