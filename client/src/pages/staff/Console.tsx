import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { CalledEvent, StaffSnapshot, StaffTicket } from '../../../../shared/types'
import { Modal, useDocumentTitle, useToast } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { duration, minutesShort, secondsSince, useNow } from '../../lib/format'
import { useStaffQueue } from '../../lib/socket'

function useStored<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : fallback
    } catch {
      return fallback
    }
  })
  const set = useCallback(
    (v: T) => {
      setValue(v)
      try {
        localStorage.setItem(key, JSON.stringify(v))
      } catch {
        /* storage unavailable: still works for this visit */
      }
    },
    [key],
  )
  return [value, set] as const
}

/** The counter screen: call the next person, recall, finish, mark no-show, add walk-ins. */
export function Console() {
  useDocumentTitle('Counter · Pila')
  const { user } = useAuth()
  const toast = useToast()
  const [initial, setInitial] = useState<StaffSnapshot | null>(null)
  const snap = useStaffQueue(initial)
  const now = useNow(1000)
  const [counterId, setCounterId] = useStored<number | null>(`pila.counter.${user?.id}`, null)
  const [chosen, setChosen] = useStored<number[] | null>(`pila.services.${user?.id}`, null)
  const [onlyMine, setOnlyMine] = useState(true)
  const [busy, setBusy] = useState(false)
  const [walkIn, setWalkIn] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setInitial(await api<StaffSnapshot>('/staff/queue'))
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }, [toast])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const activeCounters = useMemo(() => snap?.counters.filter((c) => c.isActive) ?? [], [snap])
  const activeServices = useMemo(() => snap?.services.filter((s) => s.isActive) ?? [], [snap])
  const counter = activeCounters.find((c) => c.id === counterId) ?? activeCounters[0]
  const serviceIds = (chosen ?? activeServices.map((s) => s.id)).filter((id) => activeServices.some((s) => s.id === id))
  const current = snap?.serving.find((t) => t.counterId === counter?.id) ?? null
  const myWaiting = snap?.waiting.filter((t) => serviceIds.includes(t.serviceId)) ?? []
  const shown = onlyMine ? myWaiting : (snap?.waiting ?? [])
  const waitingByService = new Map<number, number>()
  for (const t of snap?.waiting ?? []) waitingByService.set(t.serviceId, (waitingByService.get(t.serviceId) ?? 0) + 1)

  const run = useCallback(
    async (fn: () => Promise<unknown>, success?: string) => {
      if (busy) return
      setBusy(true)
      try {
        await fn()
        if (success) toast(success)
        await refresh()
      } catch (err) {
        toast(errorMessage(err), 'error')
      } finally {
        setBusy(false)
      }
    },
    [busy, refresh, toast],
  )

  const next = useCallback(() => {
    if (!counter) return
    void run(async () => {
      const { called } = await api<{ called: CalledEvent | null }>(`/staff/counters/${counter.id}/next`, { body: { serviceIds } })
      if (!called) toast('No one is waiting for your services.')
    })
  }, [counter, run, serviceIds, toast])

  const recall = useCallback(() => {
    if (current) void run(() => api(`/staff/tickets/${current.id}/recall`, { method: 'POST' }), `Calling ${current.code} again`)
  }, [current, run])

  const complete = useCallback(() => {
    if (current) void run(() => api(`/staff/tickets/${current.id}/complete`, { method: 'POST' }), `${current.code} done`)
  }, [current, run])

  const noShow = useCallback(() => {
    if (current) void run(() => api(`/staff/tickets/${current.id}/no-show`, { method: 'POST' }), `${current.code} marked as no-show`)
  }, [current, run])

  // Keyboard shortcuts: N next, R recall, D done. Ignored while typing or with a dialog open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || walkIn) return
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, select, [contenteditable]')) return
      const k = e.key.toLowerCase()
      if (k === 'n') next()
      else if (k === 'r') recall()
      else if (k === 'd') complete()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, recall, complete, walkIn])

  if (!snap) return <div className="page-loading" aria-busy="true" />

  if (!activeCounters.length) {
    return (
      <div className="card card-pad">
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>No counters yet</h1>
        <p className="muted">
          {user?.role === 'admin' ? 'Add a counter in Setup to start serving people.' : 'Ask your office admin to add a counter.'}
        </p>
      </div>
    )
  }

  const toggleService = (id: number) => {
    const set = new Set(serviceIds)
    if (set.has(id)) set.delete(id)
    else set.add(id)
    setChosen([...set])
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Counter</h1>
          <p>
            {myWaiting.length === 0
              ? 'No one waiting for your services.'
              : `${myWaiting.length} waiting for your services${myWaiting.some((t) => t.isPriority) ? ', including priority' : ''}.`}
          </p>
        </div>
        <button type="button" className="btn" onClick={() => setWalkIn(true)}>
          + Walk-in ticket
        </button>
      </div>

      {!snap.isOpen && (
        <div className="notice" style={{ marginBottom: 16 }}>
          Online joining is paused for this office. You can still call people and add walk-ins.
        </div>
      )}

      <div className="console">
        <div className="console-side">
          <div className="card card-pad counter-picker">
            <label className="field">
              <span>My counter</span>
              <select className="input" value={counter?.id} onChange={(e) => setCounterId(Number(e.target.value))}>
                {activeCounters.map((c) => {
                  const busyWith = snap.serving.find((t) => t.counterId === c.id)
                  return (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {busyWith ? ` (serving ${busyWith.code})` : ''}
                    </option>
                  )
                })}
              </select>
            </label>
            <div className="field">
              <span>Services I handle</span>
              <div className="service-toggles">
                {activeServices.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    className="service-toggle"
                    aria-pressed={serviceIds.includes(s.id)}
                    onClick={() => toggleService(s.id)}
                  >
                    {s.prefix} · {s.name} <span className="count">{waitingByService.get(s.id) ?? 0}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <section className={`card current ${current ? 'has-ticket' : ''}`} aria-live="polite">
            <div className="card-head">
              <h2>{counter?.name}</h2>
              {current && <span className="badge badge-sun num">Serving {duration(secondsSince(current.calledAt, now))}</span>}
            </div>
            <div className="current-body">
              {current ? (
                <>
                  <div className="current-code">{current.code}</div>
                  <div className="current-name">{current.customerName ?? 'No name given'}</div>
                  <div className="current-meta">
                    <span className="badge">{current.serviceName}</span>
                    {current.isPriority && <span className="badge badge-priority">Priority: check ID</span>}
                    <span className="badge">{current.source === 'walk_in' ? 'Walk-in' : 'Joined online'}</span>
                    <span className="badge num">Waited {minutesShort(secondsSince(current.createdAt, new Date(current.calledAt!).getTime()))}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="current-code muted" style={{ opacity: 0.35 }}>
                    —
                  </div>
                  <p className="muted" style={{ marginTop: 8 }}>
                    This counter is free.
                  </p>
                </>
              )}
            </div>
            <div className="current-actions">
              <button
                type="button"
                className="btn btn-primary btn-lg btn-next"
                onClick={next}
                disabled={busy || serviceIds.length === 0}
              >
                {current ? 'Done, call next' : 'Call next'} <kbd>N</kbd>
              </button>
              <button type="button" className="btn" onClick={recall} disabled={busy || !current}>
                Call again <kbd>R</kbd>
              </button>
              <button type="button" className="btn" onClick={complete} disabled={busy || !current}>
                Done <kbd>D</kbd>
              </button>
              <button type="button" className="btn btn-danger" onClick={noShow} disabled={busy || !current} style={{ gridColumn: '1 / -1' }}>
                Didn’t show up
              </button>
            </div>
          </section>

          <div className="stat-row">
            <div>
              <span>Served today</span>
              <b>{snap.stats.servedToday}</b>
            </div>
            <div>
              <span>No-shows</span>
              <b>{snap.stats.noShowToday}</b>
            </div>
            <div>
              <span>Avg wait</span>
              <b>{minutesShort(snap.stats.avgWaitSecToday)}</b>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>All counters</h3>
            </div>
            <div className="counters-mini">
              {activeCounters.map((c) => {
                const t = snap.serving.find((s) => s.counterId === c.id)
                return (
                  <div key={c.id}>
                    <span>{c.name}</span>
                    <b className="num">{t ? t.code : <span className="muted">free</span>}</b>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <section className="card">
          <div className="card-head">
            <h2>Waiting ({shown.length})</h2>
            <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" className="switch" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
              Only my services
            </label>
          </div>
          {shown.length === 0 ? (
            <div className="empty">The line is empty. 🎉</div>
          ) : (
            <div className="table-wrap">
              <table className="list">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Number</th>
                    <th>Service</th>
                    <th className="hide-sm">Name</th>
                    <th>Waiting</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((t, i) => (
                    <WaitingRow
                      key={t.id}
                      t={t}
                      i={i}
                      now={now}
                      canCall={!!counter && !busy}
                      onCall={() =>
                        counter &&
                        run(() => api(`/staff/tickets/${t.id}/call`, { body: { counterId: counter.id } }), `Called ${t.code} to ${counter.name}`)
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {walkIn && <WalkInDialog snap={snap} defaultService={serviceIds[0]} onClose={() => setWalkIn(false)} onIssued={refresh} />}
    </>
  )
}

function WaitingRow({ t, i, now, canCall, onCall }: { t: StaffTicket; i: number; now: number; canCall: boolean; onCall: () => void }) {
  const waited = secondsSince(t.createdAt, now) ?? 0
  return (
    <tr>
      <td className="muted num">{i + 1}</td>
      <td className="code-cell">
        {t.code}{' '}
        {t.isPriority && (
          <span className="badge badge-priority" title="Senior citizen, PWD or pregnant">
            Priority
          </span>
        )}
      </td>
      <td>{t.serviceName}</td>
      <td className="hide-sm">
        {t.customerName ?? <span className="muted">—</span>}
        {t.source === 'walk_in' && <span className="muted small"> · walk-in</span>}
      </td>
      <td className={`num ${waited > 45 * 60 ? 'late' : ''}`}>{minutesShort(waited)}</td>
      <td className="actions">
        <button type="button" className="btn btn-sm" onClick={onCall} disabled={!canCall}>
          Call
        </button>
      </td>
    </tr>
  )
}

function WalkInDialog({
  snap,
  defaultService,
  onClose,
  onIssued,
}: {
  snap: StaffSnapshot
  defaultService?: number
  onClose: () => void
  onIssued: () => void
}) {
  const services = snap.services.filter((s) => s.isActive)
  const [serviceId, setServiceId] = useState(defaultService ?? services[0]?.id)
  const [name, setName] = useState('')
  const [priority, setPriority] = useState(false)
  const [issued, setIssued] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const t = await api<{ code: string }>('/staff/tickets', { body: { serviceId, customerName: name || null, isPriority: priority } })
      setIssued(t.code)
      onIssued()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  if (issued) {
    return (
      <Modal title="Ticket issued" onClose={onClose}>
        <div className="issued">
          <p className="muted">Tell the person their number:</p>
          <div className="ticket-code">{issued}</div>
          <p className="muted small">It’s now on the display board’s “Next in line” list.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 20 }}>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setIssued(null)
              setName('')
              setPriority(false)
            }}
          >
            Issue another
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Walk-in ticket" onClose={onClose}>
      <p className="muted small" style={{ marginTop: -8, marginBottom: 16 }}>
        For people without a phone. They join the same line as everyone else.
      </p>
      <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
        <label className="field">
          <span>Service</span>
          <select className="input" value={serviceId} onChange={(e) => setServiceId(Number(e.target.value))}>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.prefix} · {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Name (optional)</span>
          <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={priority} onChange={(e) => setPriority(e.target.checked)} />
          <span>
            <b>Priority lane</b>
            <span className="small muted" style={{ display: 'block' }}>
              Senior citizen, PWD or pregnant
            </span>
          </span>
        </label>
        {error && <div className="form-error">{error}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary">Issue ticket</button>
        </div>
      </form>
    </Modal>
  )
}
