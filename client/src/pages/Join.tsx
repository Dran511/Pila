import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { TicketView } from '../../../shared/types'
import { LiveDot, Logo, useDocumentTitle } from '../components/ui'
import { api, errorMessage } from '../lib/api'
import { waitText } from '../lib/format'
import { useLang } from '../lib/i18n'
import { useOfficeQueue } from '../lib/socket'
import { LangToggle } from './Ticket'

export const savedTicketKey = (slug: string) => `pila.ticket.${slug}`

export function Join() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const { lang, setLang, t } = useLang()
  const live = useOfficeQueue(slug)
  const [existing, setExisting] = useState<TicketView | null>(null)
  const [serviceId, setServiceId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [priority, setPriority] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const snap = live.snapshot
  useDocumentTitle(snap ? `${snap.office.name} · Pila` : 'Pila')

  useEffect(() => {
    // Already holding a ticket here? Offer to go back to it instead of taking a second number.
    let saved: string | null = null
    try {
      saved = localStorage.getItem(savedTicketKey(slug))
    } catch {
      /* storage unavailable */
    }
    if (saved) {
      api<TicketView>(`/public/tickets/${saved}`)
        .then((tk) => (tk.status === 'waiting' || tk.status === 'serving') && setExisting(tk))
        .catch(() => {})
    }
  }, [slug])

  useEffect(() => {
    if (snap && serviceId == null && snap.services.length === 1) setServiceId(snap.services[0].id)
  }, [snap, serviceId])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (serviceId == null) return
    setSubmitting(true)
    setError(null)
    try {
      const ticket = await api<{ id: string; code: string }>(`/public/offices/${encodeURIComponent(slug)}/tickets`, {
        body: { serviceId, customerName: name.trim() || null, isPriority: priority },
      })
      try {
        localStorage.setItem(savedTicketKey(slug), ticket.id)
      } catch {
        /* the link still works without storage */
      }
      navigate(`/t/${ticket.id}`)
    } catch (err) {
      setError(errorMessage(err))
      setSubmitting(false)
    }
  }

  return (
    <div className="public">
      <header className="public-top">
        <Logo />
        <LangToggle lang={lang} setLang={setLang} />
      </header>
      <main className="public-main">
        {live.error ? (
          <div className="card card-pad">
            <h1 style={{ fontSize: 20, marginBottom: 8 }}>🤔</h1>
            <p>{t.officeNotFound}</p>
          </div>
        ) : !snap ? (
          <div className="page-loading" aria-busy="true" />
        ) : (
          <>
            <div className="office-head">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <span className="small muted" style={{ fontWeight: 700 }}>
                  {t.getTicket}
                </span>
                <LiveDot labels={{ live: t.live, off: t.reconnecting }} />
              </div>
              <h1>{snap.office.name}</h1>
              {snap.office.address && <p className="muted small">{snap.office.address}</p>}
            </div>

            {existing && (
              <Link to={`/t/${existing.id}`} className="notice" style={{ textDecoration: 'none', display: 'block' }}>
                <b>{t.activeTicket(existing.code)}</b> · {t.viewTicket} →
              </Link>
            )}

            {!snap.office.isOpen ? (
              <div className="notice">{t.closed}</div>
            ) : (
              <form onSubmit={submit} style={{ display: 'grid', gap: 16 }}>
                <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend style={{ fontWeight: 700, marginBottom: 10 }}>{t.chooseService}</legend>
                  <div className="service-options" role="radiogroup">
                    {snap.services.map((s) => (
                      <button
                        type="button"
                        key={s.id}
                        role="radio"
                        aria-checked={serviceId === s.id}
                        aria-label={`${s.name}: ${s.waiting === 0 ? t.noLine : `${t.waiting(s.waiting)}, ${waitText(s.estWaitSec, lang)}`}`}
                        className="service-option"
                        onClick={() => setServiceId(s.id)}
                      >
                        <span className="service-prefix" aria-hidden="true">
                          {s.prefix}
                        </span>
                        <span>
                          <strong>{s.name}</strong>
                          {s.description && <span className="small muted">{s.description}</span>}
                        </span>
                        <span className="service-meta">
                          <b>{s.waiting === 0 ? t.noLine : t.waiting(s.waiting)}</b>
                          {s.waiting > 0 && <>{waitText(s.estWaitSec, lang)}</>}
                        </span>
                      </button>
                    ))}
                  </div>
                </fieldset>

                <label className="field">
                  <span>{t.yourName}</span>
                  <input
                    className="input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={60}
                    autoComplete="given-name"
                  />
                  <span className="hint">{t.yourNameHint}</span>
                </label>

                <label className="check">
                  <input type="checkbox" checked={priority} onChange={(e) => setPriority(e.target.checked)} />
                  <span>
                    <b>{t.priority}</b>
                    <span className="small muted" style={{ display: 'block' }}>
                      {t.priorityHint}
                    </span>
                  </span>
                </label>

                {error && <div className="form-error" role="alert">{error}</div>}

                <button className="btn btn-primary btn-lg btn-block" disabled={serviceId == null || submitting}>
                  {submitting ? '…' : t.submit}
                </button>
              </form>
            )}
          </>
        )}
      </main>
      <footer className="public-foot">
        Powered by <Link to="/">Pila</Link> · No app or sign-up needed
      </footer>
    </div>
  )
}
