import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { TicketView } from '../../../shared/types'
import { LiveDot, Logo, useDocumentTitle, useToast } from '../components/ui'
import { api, ApiError, errorMessage } from '../lib/api'
import { clockTime, waitText } from '../lib/format'
import { useLang, type Lang } from '../lib/i18n'
import { useOfficeQueue } from '../lib/socket'
import { buzz, chime, unlockAudio } from '../lib/sound'

export function LangToggle({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div className="lang-toggle" role="group" aria-label="Language">
      <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
        EN
      </button>
      <button type="button" aria-pressed={lang === 'fil'} onClick={() => setLang('fil')}>
        FIL
      </button>
    </div>
  )
}

const GET_READY_AT = 2 // alert when this many people (or fewer) are ahead

export function TicketPage() {
  const { id = '' } = useParams()
  const { lang, setLang, t } = useLang()
  const toast = useToast()
  const [ticket, setTicket] = useState<TicketView | null>(null)
  const [missing, setMissing] = useState(false)
  const [alerts, setAlerts] = useState<'off' | 'on' | 'blocked'>(() =>
    'Notification' in window && Notification.permission === 'granted' ? 'on' : 'off',
  )
  const prev = useRef<TicketView | null>(null)

  const load = useCallback(async () => {
    try {
      setTicket(await api<TicketView>(`/public/tickets/${id}`))
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setMissing(true)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  // Any change in this office's queue may move us up the line: refresh our ticket.
  const { snapshot } = useOfficeQueue(ticket?.office.slug)
  useEffect(() => {
    if (snapshot) void load()
  }, [snapshot, load])

  // Fallback polling in case the WebSocket is blocked by the network.
  useEffect(() => {
    const iv = setInterval(() => document.visibilityState === 'visible' && void load(), 30_000)
    return () => clearInterval(iv)
  }, [load])

  // Alerts when it is almost our turn and when we are called.
  useEffect(() => {
    const before = prev.current
    prev.current = ticket
    if (!ticket || !before) return
    const notify = (title: string, body: string) => {
      if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        try {
          new Notification(title, { body, tag: `pila-${ticket.id}`, requireInteraction: true })
        } catch {
          /* some mobile browsers only allow notifications from a service worker */
        }
      }
    }
    if (ticket.status === 'serving' && before.status !== 'serving') {
      chime()
      buzz()
      notify(`${ticket.code}: ${t.itsYourTurn}`, `${t.proceedTo} ${ticket.counterName}`)
    } else if (
      ticket.status === 'waiting' &&
      ticket.ahead != null &&
      ticket.ahead <= GET_READY_AT &&
      (before.ahead ?? Infinity) > GET_READY_AT
    ) {
      chime()
      navigator.vibrate?.(200)
      notify(`${ticket.code}: ${t.aheadOfYou(ticket.ahead)}`, t.getReady)
    }
  }, [ticket, t])

  const title = !ticket
    ? 'Pila'
    : ticket.status === 'serving'
      ? `🔔 ${ticket.code} → ${ticket.counterName}`
      : ticket.status === 'waiting'
        ? `(${ticket.ahead}) ${ticket.code} · Pila`
        : `${ticket.code} · Pila`
  useDocumentTitle(title)

  async function enableAlerts() {
    unlockAudio()
    if (!('Notification' in window)) {
      setAlerts('on')
      return
    }
    const result = await Notification.requestPermission()
    setAlerts(result === 'granted' ? 'on' : 'blocked')
  }

  async function leave() {
    if (!ticket || !window.confirm(t.confirmLeave)) return
    try {
      setTicket(await api<TicketView>(`/public/tickets/${ticket.id}/cancel`, { method: 'POST' }))
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  if (missing) {
    return (
      <div className="public">
        <header className="public-top">
          <Logo />
        </header>
        <main className="public-main">
          <div className="card card-pad">Ticket not found. It may be from an old link.</div>
        </main>
      </div>
    )
  }
  if (!ticket) return <div className="page-loading" aria-busy="true" />

  const serving = ticket.status === 'serving'
  const waiting = ticket.status === 'waiting'
  const finished = !serving && !waiting

  return (
    <div className="public">
      <header className="public-top">
        <Logo />
        <LangToggle lang={lang} setLang={setLang} />
      </header>
      <main className="public-main">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <b>{ticket.office.name}</b>
            <div className="small muted">
              {t.issuedAt} {clockTime(ticket.createdAt)}
            </div>
          </div>
          {!finished && <LiveDot labels={{ live: t.live, off: t.reconnecting }} />}
        </div>

        <section className={`ticket ${serving ? 'called' : ''} ${finished ? 'finished' : ''}`} aria-live="assertive">
          <div className="ticket-label">{serving ? t.itsYourTurn : t.yourNumber}</div>
          <div className="ticket-code">{ticket.code}</div>
          <div className="ticket-service">
            {ticket.service.name}
            {ticket.isPriority && (
              <>
                {' '}
                · <span className="badge badge-priority">{t.priority}</span>
              </>
            )}
          </div>
          <div className="ticket-divider" />
          <div className="ticket-status">
            {serving && (
              <>
                <span>{t.proceedTo}</span>
                <span className="counter-callout">{ticket.counterName}</span>
              </>
            )}
            {waiting && (
              <>
                <span className="big">{t.aheadOfYou(ticket.ahead ?? 0)}</span>
                {ticket.ahead! > 0 && (
                  <span className="muted">
                    {t.estWait}: <b>{waitText(ticket.estWaitSec, lang)}</b>
                  </span>
                )}
                <div className="progress-dots" aria-hidden="true">
                  {Array.from({ length: Math.min(ticket.ahead ?? 0, 8) }, (_, i) => (
                    <span key={i} />
                  ))}
                  <span className="you" />
                </div>
              </>
            )}
            {ticket.status === 'done' && (
              <>
                <span className="big">{t.done}</span>
                <span className="muted">{t.doneHint}</span>
              </>
            )}
            {ticket.status === 'no_show' && (
              <>
                <span className="big">{t.noShow}</span>
                <span className="muted">{t.noShowHint}</span>
              </>
            )}
            {ticket.status === 'cancelled' && <span className="big">{t.cancelled}</span>}
          </div>
        </section>

        {waiting && ticket.ahead != null && ticket.ahead <= GET_READY_AT && (
          <div className="notice" role="status">
            {t.getReady}
          </div>
        )}
        {serving && <p className="muted small" style={{ textAlign: 'center' }}>{t.showStaff}</p>}

        {waiting && (
          <>
            <button
              type="button"
              className={`btn btn-lg btn-block ${alerts === 'on' ? '' : 'btn-primary'}`}
              onClick={enableAlerts}
              disabled={alerts === 'on'}
            >
              {alerts === 'on' ? `✓ ${t.notifyOn}` : `🔔 ${t.notifyMe}`}
            </button>
            {alerts === 'blocked' && <p className="small muted">{t.notifyBlocked}</p>}
            <p className="small muted" style={{ textAlign: 'center' }}>
              {t.keepOpen}
            </p>
          </>
        )}

        {snapshot && !finished && (
          <section aria-label={t.nowServing}>
            <h2 className="small muted" style={{ fontSize: 13, marginBottom: 8 }}>
              {t.nowServing}
            </h2>
            <div className="serving-strip">
              {snapshot.nowServing.map((n) => (
                <div className="serving-chip" key={n.counterId}>
                  <span>{n.counterName}</span>
                  <b>{n.code ?? t.idle}</b>
                </div>
              ))}
            </div>
          </section>
        )}

        {waiting && (
          <button type="button" className="btn btn-ghost btn-danger" onClick={leave}>
            {t.leaveLine}
          </button>
        )}
        {finished && (
          <Link to={`/q/${ticket.office.slug}`} className="btn btn-primary btn-lg btn-block">
            {t.getAnother}
          </Link>
        )}
      </main>
    </div>
  )
}
