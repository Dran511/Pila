import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { LiveDot, Logo } from '../components/ui'
import { useAuth } from '../lib/auth'

/** Top bar + page area for signed-in staff and admins. */
export function Shell() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  if (!user) return null
  const initials = user.name
    .replace(/^(Dra?\.|Mr\.|Ms\.|Mrs\.)\s*/i, '')
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <>
      {user.office.isDemo && (
        <div className="demo-banner">
          You’re in the <b>demo office</b>, signed in as {user.role === 'admin' ? 'an admin' : 'counter staff'}. Open the{' '}
          <a href={`/display/${user.office.slug}`} target="_blank" rel="noreferrer">
            display board
          </a>{' '}
          and{' '}
          <a href={`/q/${user.office.slug}`} target="_blank" rel="noreferrer">
            join page
          </a>{' '}
          in other tabs to watch them update live.
        </div>
      )}
      <header className="shell-top">
        <div className="shell-top-inner">
          <Logo to="/staff" />
          <div className="shell-office">
            <b>{user.office.name}</b>
            <LiveDot />
          </div>
          <nav className="shell-nav" aria-label="Main">
            <NavLink to="/staff">Counter</NavLink>
            {user.role === 'admin' && (
              <>
                <NavLink to="/admin" end>
                  Dashboard
                </NavLink>
                <NavLink to="/admin/setup">Setup</NavLink>
              </>
            )}
            <a href={`/display/${user.office.slug}`} target="_blank" rel="noreferrer">
              Display ↗
            </a>
          </nav>
          <div className="shell-user">
            <span className="avatar" aria-hidden="true">
              {initials}
            </span>
            <span className="name small">
              <b>{user.name}</b>
              <br />
              <span className="muted">{user.role === 'admin' ? 'Admin' : 'Staff'}</span>
            </span>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={async () => {
                await signOut()
                navigate('/')
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="shell-main">
        <Outlet />
      </main>
    </>
  )
}
