import { useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import type { CalledEvent, PublicSnapshot, StaffSnapshot } from '../../../shared/types'
import { api, ApiError } from './api'

// One shared connection for the whole app. Same origin, so the session cookie rides along.
let socket: Socket | null = null
export function getSocket(): Socket {
  if (!socket) socket = io({ withCredentials: true, transports: ['websocket', 'polling'] })
  return socket
}

/** Reconnect so the server re-reads the session cookie (after sign-in or sign-out). */
export function reconnectSocket() {
  if (!socket) return
  socket.disconnect()
  socket.connect()
}

export function useConnected() {
  const [connected, setConnected] = useState(() => getSocket().connected)
  useEffect(() => {
    const s = getSocket()
    const on = () => setConnected(true)
    const off = () => setConnected(false)
    s.on('connect', on)
    s.on('disconnect', off)
    s.on('connect_error', off)
    setConnected(s.connected)
    return () => {
      s.off('connect', on)
      s.off('disconnect', off)
      s.off('connect_error', off)
    }
  }, [])
  return connected
}

/** Live public view of an office's queue. `onCalled` fires for every "please proceed to…" announcement. */
export function useOfficeQueue(slug: string | undefined, onCalled?: (e: CalledEvent) => void) {
  const [snapshot, setSnapshot] = useState<PublicSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const calledRef = useRef(onCalled)
  calledRef.current = onCalled

  useEffect(() => {
    if (!slug) return
    const s = getSocket()
    let cancelled = false
    const watch = () =>
      s.emit('watch', slug, (res: { ok: boolean; error?: string }) => {
        if (!res.ok) setError(res.error ?? 'Office not found')
      })
    // Keep whichever snapshot is newest (HTTP and WebSocket can arrive in either order).
    const accept = (snap: PublicSnapshot) =>
      setSnapshot((prev) => (prev && prev.generatedAt > snap.generatedAt ? prev : snap))
    const onSnap = (snap: PublicSnapshot) => {
      if (snap.office.slug === slug) {
        accept(snap)
        setError(null)
      }
    }
    // Load once over plain HTTP too, so the page shows up even if WebSockets are slow or blocked.
    api<PublicSnapshot>(`/public/offices/${encodeURIComponent(slug)}`)
      .then((snap) => !cancelled && accept(snap))
      .catch((err) => !cancelled && err instanceof ApiError && err.status === 404 && setError('Office not found'))
    const onCall = (e: CalledEvent) => calledRef.current?.(e)
    s.on('connect', watch)
    s.on('queue:public', onSnap)
    s.on('queue:called', onCall)
    if (s.connected) watch()
    return () => {
      cancelled = true
      s.off('connect', watch)
      s.off('queue:public', onSnap)
      s.off('queue:called', onCall)
    }
  }, [slug])

  return { snapshot, error }
}

/** Live staff view of the signed-in user's office. */
export function useStaffQueue(initial: StaffSnapshot | null) {
  const [snapshot, setSnapshot] = useState(initial)
  useEffect(() => setSnapshot(initial), [initial])
  useEffect(() => {
    const s = getSocket()
    const onSnap = (snap: StaffSnapshot) => setSnapshot(snap)
    s.on('queue:staff', onSnap)
    return () => {
      s.off('queue:staff', onSnap)
    }
  }, [])
  return snapshot
}
