import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { CalledEvent } from '../../../shared/types'
import { absoluteUrl, LiveDot, Qr, useDocumentTitle } from '../components/ui'
import { useNow } from '../lib/format'
import { useOfficeQueue } from '../lib/socket'
import { chime, speak, speakableCode, unlockAudio } from '../lib/sound'
import '../styles/display.css'

/** The TV in the waiting area: who is being served where, who is next, with a chime and voice. */
export function Display() {
  const { slug = '' } = useParams()
  const [soundOn, setSoundOn] = useState(false)
  const [flash, setFlash] = useState<CalledEvent | null>(null)
  const soundRef = useRef(soundOn)
  soundRef.current = soundOn
  const queueRef = useRef<CalledEvent[]>([])
  const busy = useRef(false)
  const now = useNow(15_000)

  // Announcements play one at a time so two counters calling together don't talk over each other.
  const playNext = useCallback(() => {
    const e = queueRef.current.shift()
    if (!e) {
      busy.current = false
      return
    }
    busy.current = true
    setFlash(e)
    if (soundRef.current) {
      chime()
      setTimeout(() => speak(`Number ${speakableCode(e.code)}, please proceed to ${e.counterName}.`), 1100)
    }
    setTimeout(() => {
      setFlash(null)
      playNext()
    }, 6000)
  }, [])

  const onCalled = useCallback(
    (e: CalledEvent) => {
      queueRef.current.push(e)
      if (!busy.current) playNext()
    },
    [playNext],
  )

  const { snapshot, error } = useOfficeQueue(slug, onCalled)
  useDocumentTitle(snapshot ? `Display · ${snapshot.office.name}` : 'Display · Pila')

  useEffect(() => {
    document.body.classList.add('display-body')
    return () => document.body.classList.remove('display-body')
  }, [])

  if (error) return <div className="display-msg">Office not found.</div>
  if (!snapshot) return <div className="display-msg">Connecting…</div>

  const services = new Map(snapshot.services.map((s) => [s.id, s]))
  const joinUrl = absoluteUrl(`/q/${slug}`)

  return (
    <div className="display">
      <header className="display-top">
        <div>
          <h1>{snapshot.office.name}</h1>
          <LiveDot />
        </div>
        <div className="display-clock num">
          {new Date(now).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}
          <span>{new Date(now).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
        </div>
      </header>

      <main className="display-main">
        <section className="display-counters" aria-label="Now serving">
          <h2>Now serving</h2>
          <div className="display-grid" style={{ ['--n' as string]: Math.min(snapshot.nowServing.length, 4) }}>
            {snapshot.nowServing.map((n) => (
              <div
                key={n.counterId}
                className={`display-tile ${n.code ? '' : 'idle'} ${flash?.counterName === n.counterName ? 'flash' : ''}`}
              >
                <span className="display-counter">{n.counterName}</span>
                <span className="display-code num">{n.code ?? '—'}</span>
                <span className="display-service">{n.serviceId ? services.get(n.serviceId)?.name : 'Available'}</span>
              </div>
            ))}
          </div>
        </section>

        <aside className="display-side">
          <section>
            <h2>Next in line</h2>
            {snapshot.upNext.length === 0 ? (
              <p className="display-empty">No one waiting</p>
            ) : (
              <ol className="display-next">
                {snapshot.upNext.slice(0, 8).map((u) => (
                  <li key={u.code}>
                    <b className="num">{u.code}</b>
                    <span>{services.get(u.serviceId)?.name}</span>
                    {u.isPriority && <em>Priority</em>}
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section className="display-join">
            <Qr value={joinUrl} label={`QR code to join the queue at ${joinUrl}`} />
            <div>
              <b>Scan to get a number</b>
              <span>Kumuha ng numero gamit ang phone mo. No app needed.</span>
              <span className="display-url">{joinUrl.replace(/^https?:\/\//, '')}</span>
            </div>
          </section>
        </aside>
      </main>

      {flash && (
        <div className="display-callout" role="alert">
          <span>{flash.recall ? 'Calling again' : 'Now calling'}</span>
          <b className="num">{flash.code}</b>
          <span>
            Please proceed to <strong>{flash.counterName}</strong>
          </span>
        </div>
      )}

      {!soundOn && (
        <button
          type="button"
          className="display-sound"
          onClick={() => {
            unlockAudio()
            setSoundOn(true)
            document.documentElement.requestFullscreen?.().catch(() => {})
          }}
        >
          🔊 Click to turn on sound and full screen
        </button>
      )}
    </div>
  )
}
