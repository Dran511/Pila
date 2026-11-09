import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import type { SessionUser } from '../../../shared/types'
import { Logo, useDocumentTitle } from '../components/ui'
import { api, errorMessage } from '../lib/api'
import { useAuth } from '../lib/auth'

const homeFor = (u: SessionUser) => (u.role === 'admin' ? '/admin' : '/staff')

export function DemoButtons({ onDone }: { onDone?: (u: SessionUser) => void }) {
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const go = async (role: 'staff' | 'admin') => {
    setBusy(role)
    setError(null)
    try {
      const { user } = await api<{ user: SessionUser }>('/auth/demo', { body: { role } })
      setUser(user)
      if (onDone) onDone(user)
      else navigate(role === 'admin' ? '/admin' : '/staff')
    } catch (err) {
      setError(errorMessage(err))
      setBusy(null)
    }
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <button type="button" className="btn" onClick={() => go('staff')} disabled={!!busy}>
          {busy === 'staff' ? '…' : 'Demo: counter staff'}
        </button>
        <button type="button" className="btn" onClick={() => go('admin')} disabled={!!busy}>
          {busy === 'admin' ? '…' : 'Demo: office admin'}
        </button>
      </div>
      {error && <div className="form-error">{error}</div>}
    </div>
  )
}

export function Login() {
  useDocumentTitle('Sign in · Pila')
  const { user, loading, setUser } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!loading && user) return <Navigate to={params.get('next') ?? homeFor(user)} replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await api<{ user: SessionUser }>('/auth/login', { body: { email, password } })
      setUser(res.user)
      navigate(params.get('next') ?? homeFor(res.user))
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <div className="card auth-card">
        <Logo />
        <h1>Sign in to your office</h1>
        <p className="muted">For counter staff and office admins.</p>
        <form onSubmit={submit}>
          <label className="field">
            <span>Email</span>
            <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="btn btn-primary btn-lg" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div className="divider-text">or try it with no account</div>
        <DemoButtons />
        <p className="small muted" style={{ marginTop: 20, textAlign: 'center' }}>
          New to Pila? <Link to="/signup">Set up your office</Link>
        </p>
      </div>
    </div>
  )
}

export function Signup() {
  useDocumentTitle('Set up your office · Pila')
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ officeName: '', name: '', email: '', password: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await api<{ user: SessionUser }>('/auth/signup', { body: form })
      setUser(res.user)
      navigate('/admin/setup?welcome=1')
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <div className="card auth-card">
        <Logo />
        <h1>Set up your office</h1>
        <p className="muted">Free, and takes about a minute. You can add services, counters and staff next.</p>
        <form onSubmit={submit}>
          <label className="field">
            <span>Office name</span>
            <input className="input" required minLength={3} maxLength={80} placeholder="e.g. Brgy. San Jose Health Center" value={form.officeName} onChange={set('officeName')} />
          </label>
          <label className="field">
            <span>Your name</span>
            <input className="input" required autoComplete="name" value={form.name} onChange={set('name')} />
          </label>
          <label className="field">
            <span>Email</span>
            <input className="input" type="email" required autoComplete="email" value={form.email} onChange={set('email')} />
          </label>
          <label className="field">
            <span>Password</span>
            <input className="input" type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={set('password')} />
            <span className="hint">At least 8 characters.</span>
          </label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="btn btn-primary btn-lg" disabled={busy}>
            {busy ? 'Creating…' : 'Create office'}
          </button>
        </form>
        <p className="small muted" style={{ marginTop: 20, textAlign: 'center' }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
