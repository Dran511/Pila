// Real-time updates over Socket.IO.
//
// Rooms:
//   office:<id>  anyone watching an office (join page, ticket page, display board). Gets the public snapshot.
//   staff:<id>   signed-in staff of that office (decided by the session cookie). Gets the staff snapshot.
//
// After any change the server pushes a fresh snapshot instead of a diff: simpler, and a client that
// missed a message can never drift out of sync. Bursts of changes are coalesced into one push.

import type { Server as HttpServer } from 'node:http'
import { Server } from 'socket.io'
import type { CalledEvent } from '../shared/types.js'
import { SESSION_COOKIE, userFromToken } from './auth.js'
import { getOfficeBySlug, publicSnapshot, staffSnapshot, type Ctx } from './queue.js'

export interface Realtime {
  /** Tell everyone watching `officeId` that its queue changed. */
  notify(officeId: number, called?: CalledEvent | null): void
  close(): Promise<void>
}

const COALESCE_MS = 120

function parseCookie(header: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i > 0) {
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
      } catch {
        /* ignore malformed cookie */
      }
    }
  }
  return out
}

export function createRealtime(httpServer: HttpServer, ctx: Ctx, jwtSecret: string): Realtime {
  const io = new Server(httpServer, { serveClient: false })

  io.on('connection', async (socket) => {
    // Staff get their office's private room automatically.
    try {
      const cookies = parseCookie(socket.handshake.headers.cookie ?? '')
      const user = await userFromToken(ctx.db, cookies[SESSION_COOKIE], jwtSecret)
      if (user) {
        socket.data.officeId = user.office.id
        await socket.join(`staff:${user.office.id}`)
        socket.emit('queue:staff', await staffSnapshot(ctx, user.office.id))
      }
    } catch (err) {
      console.error('socket auth failed', err)
    }

    socket.on('watch', async (slug: unknown, ack?: (res: unknown) => void) => {
      try {
        if (typeof slug !== 'string') throw new Error('bad slug')
        const office = await getOfficeBySlug(ctx.db, slug)
        for (const room of socket.rooms) if (room.startsWith('office:')) await socket.leave(room)
        await socket.join(`office:${office.id}`)
        socket.emit('queue:public', await publicSnapshot(ctx, office.id))
        ack?.({ ok: true })
      } catch {
        ack?.({ ok: false, error: 'Office not found' })
      }
    })
  })

  const pending = new Map<number, NodeJS.Timeout>()

  async function push(officeId: number) {
    pending.delete(officeId)
    try {
      io.to(`office:${officeId}`).emit('queue:public', await publicSnapshot(ctx, officeId))
      if ((io.sockets.adapter.rooms.get(`staff:${officeId}`)?.size ?? 0) > 0) {
        io.to(`staff:${officeId}`).emit('queue:staff', await staffSnapshot(ctx, officeId))
      }
    } catch (err) {
      console.error('realtime push failed', err)
    }
  }

  return {
    notify(officeId, called) {
      // Announcements go out immediately so the display board can chime right away.
      if (called) io.to(`office:${officeId}`).emit('queue:called', called)
      if (!pending.has(officeId)) pending.set(officeId, setTimeout(() => void push(officeId), COALESCE_MS))
    },
    async close() {
      for (const t of pending.values()) clearTimeout(t)
      await io.close()
    },
  }
}
