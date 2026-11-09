// A tiny database layer with two interchangeable drivers:
//   - Postgres (node-postgres) when DATABASE_URL is set: production.
//   - PGlite, real Postgres compiled to WebAssembly, otherwise: zero-setup local dev and fast tests.
// Both speak the same SQL, so the app code never knows which one it is talking to.

import type { PGlite } from '@electric-sql/pglite'
import { mkdirSync } from 'node:fs'
import pg from 'pg'
import { migrate } from './migrations.js'

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
}

export interface Db extends Queryable {
  /** Run `fn` inside a transaction. It is rolled back if `fn` throws. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
  close(): Promise<void>
  driver: 'postgres' | 'pglite'
}

// Return DATE columns as 'YYYY-MM-DD' strings and COUNT/SUM (int8) as numbers.
pg.types.setTypeParser(1082, (v) => v)
pg.types.setTypeParser(20, (v) => Number(v))

function postgresDb(url: string): Db {
  const pool = new pg.Pool({
    connectionString: url,
    max: 10,
    ssl: /sslmode=require|neon\.tech|supabase/.test(url) ? { rejectUnauthorized: false } : undefined,
  })
  return {
    driver: 'postgres',
    async query(sql, params) {
      return (await pool.query(sql, params as unknown[])).rows
    },
    async tx(fn) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await fn({
          query: async (sql, params) => (await client.query(sql, params as unknown[])).rows,
        })
        await client.query('COMMIT')
        return result
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
    },
    close: () => pool.end(),
  }
}

async function pgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite')
  if (dataDir) mkdirSync(dataDir, { recursive: true })
  const parsers = {
    1082: (v: string) => v, // date -> 'YYYY-MM-DD'
    20: (v: string) => Number(v), // int8 -> number
  }
  const db: PGlite = dataDir ? new PGlite(dataDir, { parsers }) : new PGlite({ parsers })
  await db.waitReady
  return {
    driver: 'pglite',
    async query(sql, params) {
      return (await db.query(sql, params)).rows as never
    },
    tx(fn) {
      return db.transaction((t) =>
        fn({ query: async (sql, params) => (await t.query(sql, params)).rows as never }),
      )
    },
    close: () => db.close(),
  }
}

/**
 * Open the database and bring the schema up to date.
 * `url` = Postgres connection string, 'memory' = throwaway PGlite (tests),
 * anything else / undefined = PGlite stored in `dataDir`.
 */
export async function openDb(opts: { url?: string; dataDir?: string } = {}): Promise<Db> {
  let db: Db
  if (opts.url && opts.url !== 'memory') db = postgresDb(opts.url)
  else if (opts.url === 'memory') db = await pgliteDb()
  else db = await pgliteDb(opts.dataDir)
  await migrate(db)
  return db
}
