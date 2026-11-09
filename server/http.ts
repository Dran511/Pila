import type { ErrorRequestHandler, Request } from 'express'
import { z, ZodError } from 'zod'

/** An error with an HTTP status that is safe to show to the client. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message)
  }
}

export const notFound = (what = 'Not found') => new HttpError(404, what)
export const badRequest = (msg: string) => new HttpError(400, msg)
export const conflict = (msg: string) => new HttpError(409, msg)

/** Validate a request body/params/query against a zod schema; throws a 400 with field errors. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  return schema.parse(data)
}

export const idParam = (req: Request, name = 'id') => {
  const n = Number(req.params[name])
  if (!Number.isInteger(n) || n <= 0) throw notFound()
  return n
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const uuidParam = (req: Request, name = 'id') => {
  const v = String(req.params[name])
  if (!UUID.test(v)) throw notFound('Ticket not found')
  return v
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: err.issues[0]?.message ?? 'Invalid input',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
    return
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details })
    return
  }
  // Postgres unique violation, e.g. duplicate email or prefix.
  if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
    res.status(409).json({ error: 'That value is already in use.' })
    return
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Malformed JSON body' })
    return
  }
  console.error(err)
  res.status(500).json({ error: 'Something went wrong on our side.' })
}
