import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import { config } from './config.js'
import { openDb } from './db/index.js'
import { closeStaleTickets } from './queue.js'
import { ensureDemo } from './seed.js'

const here = path.dirname(fileURLToPath(import.meta.url))

async function main() {
  const db = await openDb({ url: config.databaseUrl, dataDir: config.dataDir })
  const { server, ctx, realtime } = createApp({
    db,
    jwtSecret: config.jwtSecret,
    secureCookies: config.isProd,
    // dist/server/index.js -> dist/client
    clientDir: path.resolve(here, '../client'),
  })

  const housekeeping = async () => {
    try {
      const closed = await closeStaleTickets(db)
      for (const officeId of new Set(closed.map((r) => (r as { officeId: number }).officeId))) realtime.notify(officeId)
      if (config.seedDemo) await ensureDemo(ctx)
    } catch (err) {
      console.error('housekeeping failed', err)
    }
  }
  await housekeeping()
  setInterval(housekeeping, 60 * 60_000).unref()

  server.listen(config.port, () => {
    console.log(`Pila API listening on http://localhost:${config.port} (database: ${db.driver})`)
  })

  const shutdown = async () => {
    server.close()
    await realtime.close()
    await db.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
