import { useEffect, useState } from 'react'

/** "about 12 min", "less than a minute", "about 1 hr 20 min" */
export function waitText(sec: number | null | undefined, lang: 'en' | 'fil' = 'en'): string {
  if (sec == null) return '—'
  const min = Math.round(sec / 60)
  if (min < 1) return lang === 'fil' ? 'wala pang isang minuto' : 'less than a minute'
  const about = lang === 'fil' ? 'mga' : 'about'
  if (min < 60) return `${about} ${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${about} ${h} hr${m ? ` ${m} min` : ''}`
}

/** Short duration for stats: "4m 12s", "38s", "1h 5m". */
export function duration(sec: number | null | undefined): string {
  if (sec == null) return '—'
  const s = Math.max(0, Math.round(sec))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export const minutesShort = (sec: number | null | undefined) =>
  sec == null ? '—' : sec < 60 ? '<1 min' : `${Math.round(sec / 60)} min`

export const clockTime = (iso: string | Date) =>
  new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })

export const hourLabel = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`

export const secondsSince = (iso: string | null, now: number) => (iso ? (now - new Date(iso).getTime()) / 1000 : null)

/** Re-render every `ms` (for live timers). */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

export const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`)
