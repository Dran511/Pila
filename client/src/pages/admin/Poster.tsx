import { Link } from 'react-router-dom'
import { absoluteUrl, Qr, useDocumentTitle } from '../../components/ui'
import { useAuth } from '../../lib/auth'

/** A printable A4 poster for the office entrance, in English and Filipino. */
export function Poster() {
  const { user } = useAuth()
  useDocumentTitle('QR poster · Pila')
  if (!user) return null
  const url = absoluteUrl(`/q/${user.office.slug}`)
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: 24 }}>
      <div className="no-print" style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 20 }}>
        <Link to="/admin/setup" className="btn">
          ← Back
        </Link>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          Print
        </button>
      </div>
      <article
        style={{
          width: 'min(210mm, 100%)',
          margin: '0 auto',
          padding: '18mm 16mm',
          background: '#fff',
          color: '#14201b',
          borderRadius: 8,
          boxShadow: 'var(--shadow)',
          textAlign: 'center',
          display: 'grid',
          gap: 18,
          justifyItems: 'center',
        }}
      >
        <div style={{ fontWeight: 800, color: '#0b6e4f', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{user.office.name}</div>
        <h1 style={{ fontSize: 46, lineHeight: 1.05, letterSpacing: '-0.03em' }}>
          Skip the line.
          <br />
          Get your number here.
        </h1>
        <p style={{ fontSize: 22, color: '#4a5a53', fontWeight: 600 }}>Kumuha ng numero gamit ang phone mo.</p>
        <div style={{ width: '62%', maxWidth: 300 }}>
          <Qr value={url} label="QR code to join the queue" />
        </div>
        <ol style={{ textAlign: 'left', fontSize: 17, lineHeight: 1.7, margin: 0, paddingLeft: 24 }}>
          <li>
            <b>Scan</b> the code with your phone camera. <span style={{ color: '#74837c' }}>I-scan ang code.</span>
          </li>
          <li>
            <b>Choose</b> what you need and get a number. <span style={{ color: '#74837c' }}>Pumili at kumuha ng numero.</span>
          </li>
          <li>
            <b>Wait anywhere.</b> Your phone shows your place and alerts you. <span style={{ color: '#74837c' }}>Maghintay kahit saan.</span>
          </li>
        </ol>
        <p style={{ fontSize: 15, color: '#4a5a53' }}>
          No phone? Ask the staff for a walk-in number. Seniors, PWDs and pregnant women: choose the <b>priority lane</b>.
        </p>
        <p style={{ fontSize: 14, fontWeight: 700, color: '#0b6e4f', wordBreak: 'break-all' }}>{url.replace(/^https?:\/\//, '')}</p>
      </article>
    </div>
  )
}
