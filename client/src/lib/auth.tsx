import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import type { SessionUser } from '../../../shared/types'
import { api } from './api'
import { reconnectSocket } from './socket'

interface AuthState {
  user: SessionUser | null
  loading: boolean
  setUser: (u: SessionUser | null) => void
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api<{ user: SessionUser | null }>('/auth/me')
      .then((r) => setUserState(r.user))
      .catch(() => setUserState(null))
      .finally(() => setLoading(false))
  }, [])

  const setUser = useCallback((u: SessionUser | null) => {
    setUserState(u)
    reconnectSocket() // join (or leave) the staff room with the new cookie
  }, [])

  const signOut = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' })
    setUser(null)
  }, [setUser])

  return <AuthContext.Provider value={{ user, loading, setUser, signOut }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}

/** Gate a page behind sign-in (and optionally the admin role). */
export function RequireAuth({ children, role }: { children: ReactNode; role?: 'admin' }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="page-loading" aria-busy="true" />
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />
  if (role === 'admin' && user.role !== 'admin') return <Navigate to="/staff" replace />
  return <>{children}</>
}
