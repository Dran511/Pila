// Date helpers. "Today" always means today in the office's timezone (Asia/Manila by default),
// so the queue numbers reset at local midnight, not UTC midnight.

export type Clock = () => Date

export const systemClock: Clock = () => new Date()

/** 'YYYY-MM-DD' for the given instant in the given IANA timezone. */
export function localDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

/** Add whole days to a 'YYYY-MM-DD' string. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
