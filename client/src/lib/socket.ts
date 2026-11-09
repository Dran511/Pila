import { useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import type { CalledEvent, PublicSnapshot, StaffSnapshot } from '../../../shared/types'

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
    const watch = () =>
      s.emit('watch', slug, (res: { ok: boolean; error?: string }) => {
        if (!res.ok) setError(res.error ?? 'Office not found')
      })
    const onSnap = (snap: PublicSnapshot) => {
      if (snap.office.slug === slug) {
        setSnapshot(snap)
        setError(null)
      }
    }
    const onCall = (e: CalledEvent) => calledRef.current?.(e)
    s.on('connect', watch)
    s.on('queue:public', onSnap)
    s.on('queue:called', onCall)
    if (s.connected) watch()
    return () => {
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
