import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { Counter, OfficeSettings, Service, StaffMember } from '../../../../shared/types'
import { absoluteUrl, CopyButton, Qr, useDocumentTitle, useToast } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'

export function Setup() {
  useDocumentTitle('Setup · Pila')
  const [params] = useSearchParams()
  const { user } = useAuth()
  const toast = useToast()
  const [office, setOffice] = useState<OfficeSettings | null>(null)
  const [services, setServices] = useState<Service[]>([])
  const [counters, setCounters] = useState<Counter[]>([])
  const [team, setTeam] = useState<StaffMember[]>([])

  const load = useCallback(async () => {
    try {
      const [o, s, c, u] = await Promise.all([
        api<OfficeSettings>('/admin/office'),
        api<Service[]>('/admin/services'),
        api<Counter[]>('/admin/counters'),
        api<StaffMember[]>('/admin/users'),
      ])
      setOffice(o)
      setServices(s)
      setCounters(c)
      setTeam(u)
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  /** Run a change, show any error, then reload everything from the server (the source of truth). */
  const save = useCallback(
    async (fn: () => Promise<unknown>, ok?: string) => {
      try {
        await fn()
        if (ok) toast(ok)
      } catch (err) {
        toast(errorMessage(err), 'error')
      }
      await load()
    },
    [load, toast],
  )

  if (!office) return <div className="page-loading" aria-busy="true" />

  const joinUrl = absoluteUrl(`/q/${office.slug}`)
  const displayUrl = absoluteUrl(`/display/${office.slug}`)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Setup</h1>
          <p>Services people can line up for, the counters that serve them, and who can sign in.</p>
        </div>
      </div>

      {params.get('welcome') && (
        <div className="card card-pad" style={{ marginBottom: 20, borderColor: 'var(--brand)' }}>
          <b>Your office is ready. 🎉</b>
          <p className="muted small" style={{ marginTop: 4 }}>
            We added a “General” service and “Window 1” to start. Rename them below, then print the QR poster for your
            entrance and open the display board on a TV.
          </p>
        </div>
      )}

      <div className="setup-grid">
        <div style={{ display: 'grid', gap: 20 }}>
          <OfficeCard office={office} save={save} />
          <ServicesCard services={services} save={save} />
          <CountersCard counters={counters} save={save} />
        </div>
        <div style={{ display: 'grid', gap: 20 }}>
          <section className="card">
            <div className="card-head">
              <h2>Links</h2>
              <Link to="/poster" className="btn btn-sm">
                Print poster
              </Link>
            </div>
            <div className="card-pad" style={{ display: 'grid', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 16, alignItems: 'center' }}>
                <div style={{ width: 120 }}>
                  <Qr value={joinUrl} label="QR code for the join page" />
                </div>
                <p className="small muted">
                  People scan this at the entrance to get a number. No app, no sign-up. Print it with the poster button.
                </p>
              </div>
              <div className="field">
                <span>Join page (for the public)</span>
                <div className="link-box">
                  <code>{joinUrl}</code>
                  <CopyButton text={joinUrl} />
                </div>
              </div>
              <div className="field">
                <span>Display board (open on a TV)</span>
                <div className="link-box">
                  <code>{displayUrl}</code>
                  <CopyButton text={displayUrl} />
                  <a className="btn btn-sm" href={displayUrl} target="_blank" rel="noreferrer">
                    Open
                  </a>
                </div>
              </div>
            </div>
          </section>
          <TeamCard team={team} meId={user!.id} isDemo={office.isDemo} save={save} />
        </div>
      </div>
    </>
  )
}

type Save = (fn: () => Promise<unknown>, ok?: string) => Promise<void>

function OfficeCard({ office, save }: { office: OfficeSettings; save: Save }) {
  const [name, setName] = useState(office.name)
  const [address, setAddress] = useState(office.address ?? '')
  useEffect(() => {
    setName(office.name)
    setAddress(office.address ?? '')
  }, [office])
  const dirty = name !== office.name || address !== (office.address ?? '')
  return (
    <section className="card">
      <div className="card-head">
        <h2>Office</h2>
        <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontWeight: 600 }}>
          {office.isOpen ? 'Accepting online tickets' : 'Online joining paused'}
          <input
            type="checkbox"
            className="switch"
            checked={office.isOpen}
            onChange={(e) =>
              save(
                () => api('/admin/office', { method: 'PATCH', body: { isOpen: e.target.checked } }),
                e.target.checked ? 'Online joining is on' : 'Online joining paused',
              )
            }
          />
        </label>
      </div>
      <form
        className="card-pad"
        style={{ display: 'grid', gap: 14 }}
        onSubmit={(e) => {
          e.preventDefault()
          void save(() => api('/admin/office', { method: 'PATCH', body: { name, address: address || null } }), 'Saved')
        }}
      >
        <label className="field">
          <span>Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} minLength={3} maxLength={80} required />
        </label>
        <label className="field">
          <span>Address</span>
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={160} placeholder="Shown under the name on the join page" />
        </label>
        <div>
          <button className="btn btn-primary" disabled={!dirty}>
            Save
          </button>
        </div>
      </form>
    </section>
  )
}

function ServicesCard({ services, save }: { services: Service[]; save: Save }) {
  const [name, setName] = useState('')
  const [prefix, setPrefix] = useState('')
  async function add(e: FormEvent) {
    e.preventDefault()
    await save(() => api('/admin/services', { body: { name, prefix } }), `Added ${name}`)
    setName('')
    setPrefix('')
  }
  return (
    <section className="card">
      <div className="card-head">
        <h2>Services</h2>
        <span className="small muted">Each has its own numbers, e.g. C-001</span>
      </div>
      <table className="list">
        <thead>
          <tr>
            <th>Prefix</th>
            <th>Name</th>
            <th>On</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {services.map((s) => (
            <tr key={s.id} className={s.isActive ? '' : 'dim'}>
              <td className="code-cell">{s.prefix}</td>
              <td>
                <InlineText
                  value={s.name}
                  label={`Rename ${s.name}`}
                  onSave={(v) => save(() => api(`/admin/services/${s.id}`, { method: 'PATCH', body: { name: v } }))}
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  className="switch"
                  aria-label={`${s.name} available`}
                  checked={s.isActive}
                  onChange={(e) => save(() => api(`/admin/services/${s.id}`, { method: 'PATCH', body: { isActive: e.target.checked } }))}
                />
              </td>
              <td className="actions">
                <button
                  type="button"
                  className="btn btn-sm btn-ghost btn-danger"
                  onClick={() => confirm(`Delete ${s.name}?`) && save(() => api(`/admin/services/${s.id}`, { method: 'DELETE' }), 'Deleted')}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="row-form" onSubmit={add}>
        <input
          className="input prefix"
          placeholder="C"
          aria-label="Prefix (1–2 letters)"
          value={prefix}
          maxLength={2}
          pattern="[A-Za-z]{1,2}"
          required
          onChange={(e) => setPrefix(e.target.value.toUpperCase())}
        />
        <input className="input" placeholder="New service, e.g. Consultation" aria-label="Service name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
        <button className="btn btn-primary">Add</button>
      </form>
    </section>
  )
}

function CountersCard({ counters, save }: { counters: Counter[]; save: Save }) {
  const [name, setName] = useState('')
  return (
    <section className="card">
      <div className="card-head">
        <h2>Counters</h2>
        <span className="small muted">Windows or desks where people are served</span>
      </div>
      <table className="list">
        <tbody>
          {counters.map((c) => (
            <tr key={c.id} className={c.isActive ? '' : 'dim'}>
              <td>
                <InlineText value={c.name} label={`Rename ${c.name}`} onSave={(v) => save(() => api(`/admin/counters/${c.id}`, { method: 'PATCH', body: { name: v } }))} />
              </td>
              <td style={{ width: 60 }}>
                <input
                  type="checkbox"
                  className="switch"
                  aria-label={`${c.name} open`}
                  checked={c.isActive}
                  onChange={(e) => save(() => api(`/admin/counters/${c.id}`, { method: 'PATCH', body: { isActive: e.target.checked } }))}
                />
              </td>
              <td className="actions">
                <button
                  type="button"
                  className="btn btn-sm btn-ghost btn-danger"
                  onClick={() => confirm(`Delete ${c.name}?`) && save(() => api(`/admin/counters/${c.id}`, { method: 'DELETE' }), 'Deleted')}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        className="row-form"
        onSubmit={async (e) => {
          e.preventDefault()
          await save(() => api('/admin/counters', { body: { name } }), `Added ${name}`)
          setName('')
        }}
      >
        <input className="input" placeholder={`Window ${counters.length + 1}`} aria-label="Counter name" value={name} onChange={(e) => setName(e.target.value)} required />
        <button className="btn btn-primary">Add counter</button>
      </form>
    </section>
  )
}

function TeamCard({ team, meId, isDemo, save }: { team: StaffMember[]; meId: number; isDemo: boolean; save: Save }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'staff' as 'staff' | 'admin' })
  return (
    <section className="card">
      <div className="card-head">
        <h2>Team</h2>
        <span className="small muted">Admins can also change setup</span>
      </div>
      <table className="list">
        <tbody>
          {team.map((m) => (
            <tr key={m.id}>
              <td>
                <b>{m.name}</b>
                {m.id === meId && <span className="muted small"> (you)</span>}
                <div className="small muted">{m.email}</div>
              </td>
              <td>
                <span className={`badge ${m.role === 'admin' ? 'badge-ok' : ''}`}>{m.role === 'admin' ? 'Admin' : 'Staff'}</span>
              </td>
              <td className="actions">
                {m.id !== meId && !isDemo && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost btn-danger"
                    onClick={() => confirm(`Remove ${m.name}? They will no longer be able to sign in.`) && save(() => api(`/admin/users/${m.id}`, { method: 'DELETE' }), 'Removed')}
                  >
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {isDemo ? (
        <p className="row-form small muted">Adding accounts is turned off in the demo. Create your own office to try it.</p>
      ) : (
        <form
          className="row-form"
          onSubmit={async (e) => {
            e.preventDefault()
            await save(() => api('/admin/users', { body: form }), `Added ${form.name}. Share their password with them in person.`)
            setForm({ name: '', email: '', password: '', role: 'staff' })
          }}
        >
          <input className="input" placeholder="Name" aria-label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input" type="email" placeholder="Email" aria-label="Email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input
            className="input"
            type="password"
            placeholder="Temporary password"
            aria-label="Temporary password"
            minLength={8}
            required
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <select className="input" aria-label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'staff' | 'admin' })} style={{ flex: '0 0 110px' }}>
            <option value="staff">Staff</option>
            <option value="admin">Admin</option>
          </select>
          <button className="btn btn-primary">Add</button>
        </form>
      )}
    </section>
  )
}

/** Click-to-edit text that saves on Enter or blur. */
function InlineText({ value, label, onSave }: { value: string; label: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const commit = () => {
    const trimmed = v.trim()
    if (trimmed && trimmed !== value) onSave(trimmed)
    else setV(value)
  }
  return (
    <input
      className="inline-edit"
      aria-label={label}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setV(value)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}
