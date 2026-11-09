// Versioned schema migrations. Each runs once, in order, inside a transaction,
// and is recorded in schema_migrations. Never edit a migration that has shipped: add a new one.

import type { Db } from './index.js'

const migrations: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
      CREATE TABLE offices (
        id          SERIAL PRIMARY KEY,
        slug        TEXT NOT NULL UNIQUE,
        name        TEXT NOT NULL,
        address     TEXT,
        timezone    TEXT NOT NULL DEFAULT 'Asia/Manila',
        is_open     BOOLEAN NOT NULL DEFAULT TRUE,
        is_demo     BOOLEAN NOT NULL DEFAULT FALSE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE users (
        id             SERIAL PRIMARY KEY,
        office_id      INT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
        name           TEXT NOT NULL,
        email          TEXT NOT NULL UNIQUE,
        password_hash  TEXT NOT NULL,
        role           TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE services (
        id           SERIAL PRIMARY KEY,
        office_id    INT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        prefix       TEXT NOT NULL CHECK (prefix ~ '^[A-Z]{1,2}$'),
        description  TEXT,
        is_active    BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order   INT NOT NULL DEFAULT 0,
        UNIQUE (office_id, prefix)
      );

      CREATE TABLE counters (
        id          SERIAL PRIMARY KEY,
        office_id   INT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order  INT NOT NULL DEFAULT 0
      );

      -- One row per service per day; UPDATE ... RETURNING hands out numbers atomically.
      CREATE TABLE daily_sequences (
        service_id    INT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
        service_date  DATE NOT NULL,
        last_number   INT NOT NULL DEFAULT 0,
        PRIMARY KEY (service_id, service_date)
      );

      CREATE TABLE tickets (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        office_id      INT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
        service_id     INT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
        service_date   DATE NOT NULL,
        number         INT NOT NULL,
        code           TEXT NOT NULL,
        customer_name  TEXT,
        is_priority    BOOLEAN NOT NULL DEFAULT FALSE,
        source         TEXT NOT NULL DEFAULT 'online' CHECK (source IN ('online', 'walk_in')),
        status         TEXT NOT NULL DEFAULT 'waiting'
                       CHECK (status IN ('waiting', 'serving', 'done', 'no_show', 'cancelled')),
        counter_id     INT REFERENCES counters(id) ON DELETE SET NULL,
        served_by      INT REFERENCES users(id) ON DELETE SET NULL,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        called_at      TIMESTAMPTZ,
        completed_at   TIMESTAMPTZ,
        UNIQUE (service_id, service_date, number)
      );

      CREATE INDEX tickets_queue_idx ON tickets (office_id, service_date, status);
      CREATE INDEX tickets_history_idx ON tickets (office_id, created_at);
      -- A counter serves at most one person at a time; the database enforces it.
      CREATE UNIQUE INDEX tickets_one_per_counter ON tickets (counter_id) WHERE status = 'serving';
    `,
  },
]

export async function migrate(db: Db): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INT PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
  const done = new Set(
    (await db.query<{ version: number }>('SELECT version FROM schema_migrations')).map((r) => r.version),
  )
  for (const m of migrations) {
    if (done.has(m.version)) continue
    await db.tx(async (q) => {
      for (const statement of splitStatements(m.sql)) await q.query(statement)
      await q.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [m.version, m.name])
    })
  }
}

/** node-postgres can run several statements at once, but only without params; split to keep both drivers identical. */
function splitStatements(sql: string): string[] {
  return sql
    .replace(/--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
}
