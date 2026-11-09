// Types shared by the server (API responses) and the client.

export type Role = 'admin' | 'staff'

export type TicketStatus = 'waiting' | 'serving' | 'done' | 'no_show' | 'cancelled'

export interface SessionUser {
  id: number
  name: string
  email: string
  role: Role
  office: { id: number; slug: string; name: string; isDemo: boolean }
}

export interface Service {
  id: number
  name: string
  prefix: string
  description: string | null
  isActive: boolean
  sortOrder: number
}

export interface Counter {
  id: number
  name: string
  isActive: boolean
}

export interface StaffMember {
  id: number
  name: string
  email: string
  role: Role
  createdAt: string
}

export interface OfficeSettings {
  id: number
  slug: string
  name: string
  address: string | null
  timezone: string
  isOpen: boolean
  isDemo: boolean
}

/** One line per service on the public join page and the display board. */
export interface ServiceQueueInfo {
  id: number
  name: string
  prefix: string
  description: string | null
  waiting: number
  /** Average minutes a counter spends on one person for this service (recent history). */
  avgServiceSec: number
  /** Estimated wait for someone who joins now. */
  estWaitSec: number
}

export interface NowServing {
  counterId: number
  counterName: string
  code: string | null
  serviceId: number | null
  calledAt: string | null
}

/** Everything a member of the public may see about an office's queue. Contains no names or ticket ids. */
export interface PublicSnapshot {
  office: { slug: string; name: string; address: string | null; isOpen: boolean }
  services: ServiceQueueInfo[]
  nowServing: NowServing[]
  upNext: { code: string; serviceId: number; isPriority: boolean }[]
  servedToday: number
  generatedAt: string
}

export interface StaffTicket {
  id: string
  code: string
  serviceId: number
  serviceName: string
  customerName: string | null
  isPriority: boolean
  status: TicketStatus
  source: 'online' | 'walk_in'
  counterId: number | null
  createdAt: string
  calledAt: string | null
}

/** What staff see: the full waiting list (with names) plus what every counter is doing. */
export interface StaffSnapshot {
  waiting: StaffTicket[]
  serving: StaffTicket[]
  counters: Counter[]
  services: Service[]
  stats: { servedToday: number; noShowToday: number; avgWaitSecToday: number | null }
  isOpen: boolean
}

/** The citizen's own ticket page. */
export interface TicketView {
  id: string
  code: string
  status: TicketStatus
  isPriority: boolean
  customerName: string | null
  service: { id: number; name: string }
  office: { slug: string; name: string }
  counterName: string | null
  /** People ahead of you in this service's line (only while waiting). */
  ahead: number | null
  estWaitSec: number | null
  createdAt: string
  calledAt: string | null
  completedAt: string | null
}

export interface CalledEvent {
  code: string
  counterName: string
  serviceName: string
  recall: boolean
}

export interface Analytics {
  days: number
  today: {
    issued: number
    served: number
    waiting: number
    noShows: number
    avgWaitSec: number | null
    avgServiceSec: number | null
  }
  /** Tickets issued per hour of day: today vs the daily average over the period. */
  hourly: { hour: number; today: number; average: number }[]
  daily: { date: string; served: number; noShows: number; avgWaitSec: number | null }[]
  byService: {
    serviceId: number
    name: string
    prefix: string
    served: number
    avgWaitSec: number | null
    avgServiceSec: number | null
  }[]
  busiestHour: number | null
  noShowRate: number | null
}

export interface ApiError {
  error: string
  details?: unknown
}
