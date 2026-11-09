import type { Ctx } from '../queue.js'
import type { Realtime } from '../realtime.js'

export interface Deps {
  ctx: Ctx
  notify: Realtime['notify']
  jwtSecret: string
  secureCookies: boolean
  rateLimits: boolean
}
