import bcrypt from 'bcryptjs'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import jwt from 'jsonwebtoken'
import type { Role, SessionUser } from '../shared/types.js'
import type { Db } from './db/index.js'
import { HttpError } from './http.js'

export const SESSION_COOKIE = 'pila_session'
const SESSION_DAYS = 7

export const hashPassword = (password: string) => bcrypt.hash(password, 10)
export const checkPassword = (password: string, hash: string) => bcrypt.compare(password, hash)

interface TokenPayload {
  sub: number
}

export function signSession(userId: number, secret: string) {
  return jwt.sign({ sub: userId } satisfies TokenPayload, secret, { expiresIn: `${SESSION_DAYS}d` })
}

export function setSessionCookie(res: Response, token: string, secure: boolean) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, // not readable from JavaScript, so an XSS bug cannot steal it
    sameSite: 'lax',
    secure,
    maxAge: SESSION_DAYS * 86400_000,
    path: '/',
  })
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/' })
}

/** Look up the user behind a session token. Returns null for missing, expired or forged tokens. */
export async function userFromToken(db: Db, token: string | undefined, secret: string): Promise<SessionUser | null> {
  if (!token) return null
  let payload: TokenPayload
  try {
    payload = jwt.verify(token, secret) as unknown as TokenPayload
  } catch {
    return null
  }
  const [row] = await db.query<{
    id: number
    name: string
    email: string
    role: Role
    officeId: number
    slug: string
    officeName: string
    isDemo: boolean
  }>(
    `SELECT u.id, u.name, u.email, u.role, o.id AS "officeId", o.slug, o.name AS "officeName", o.is_demo AS "isDemo"
     FROM users u JOIN offices o ON o.id = u.office_id WHERE u.id = $1`,
    [Number(payload.sub)],
  )
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    office: { id: row.officeId, slug: row.slug, name: row.officeName, isDemo: row.isDemo },
  }
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: SessionUser
  }
}

/** Attach req.user when a valid session cookie is present. */
export function loadUser(db: Db, secret: string): RequestHandler {
  return async (req, _res, next) => {
    try {
      req.user = (await userFromToken(db, req.cookies?.[SESSION_COOKIE], secret)) ?? undefined
      next()
    } catch (err) {
      next(err)
    }
  }
}

/** Require a signed-in user, optionally with a specific role. Admins can do everything staff can. */
export function requireRole(role: Role = 'staff') {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, 'Please sign in.'))
    if (role === 'admin' && req.user.role !== 'admin') return next(new HttpError(403, 'Only office admins can do that.'))
    next()
  }
}

/** The signed-in user (call only after requireRole). */
export const me = (req: Request) => req.user as SessionUser
