import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import QRCode from 'qrcode'
import { useConnected } from '../lib/socket'

export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="logo" aria-label="Pila home">
      <span className="logo-mark" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
          <circle cx="5" cy="12" r="2.2" fill="currentColor" stroke="none" />
          <path d="M11 12h2.5M18 12h1.5" />
        </svg>
      </span>
      pila
    </Link>
  )
}

export function LiveDot({ labels = { live: 'Live', off: 'Reconnecting…' } }: { labels?: { live: string; off: string } }) {
  const connected = useConnected()
  return (
    <span className={`live-dot ${connected ? '' : 'off'}`} role="status">
      {connected ? labels.live : labels.off}
    </span>
  )
}

// ── Toasts ──

type ToastFn = (message: string, kind?: 'info' | 'error') => void
const ToastContext = createContext<ToastFn>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; kind: 'info' | 'error'; id: number } | null>(null)
  const timer = useRef<number>(undefined)
  const show = useCallback<ToastFn>((message, kind = 'info') => {
    window.clearTimeout(timer.current)
    setToast({ message, kind, id: Date.now() })
    timer.current = window.setTimeout(() => setToast(null), kind === 'error' ? 5000 : 3000)
  }, [])
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite">
        {toast && (
          <div key={toast.id} className={`toast ${toast.kind === 'error' ? 'error' : ''}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
            {toast.message}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)

// ── Modal ──

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('input, select, button')?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      prev?.focus()
    }
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

// ── QR code ──

export function Qr({ value, label }: { value: string; label: string }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    QRCode.toString(value, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#14201b', light: '#ffffff' } })
      .then(setSvg)
      .catch(() => setSvg(''))
  }, [value])
  return <div className="qr" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

export const absoluteUrl = (path: string) => `${window.location.origin}${path}`

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title
  }, [title])
}
