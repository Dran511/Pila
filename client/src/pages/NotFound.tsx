import { Link } from 'react-router-dom'
import { Logo, useDocumentTitle } from '../components/ui'

export function NotFound() {
  useDocumentTitle('Not found · Pila')
  return (
    <div className="auth">
      <div className="card auth-card" style={{ textAlign: 'center' }}>
        <Logo />
        <h1>Page not found</h1>
        <p className="muted">The link may be old or mistyped.</p>
        <Link to="/" className="btn btn-primary" style={{ marginTop: 20 }}>
          Go to the home page
        </Link>
      </div>
    </div>
  )
}
