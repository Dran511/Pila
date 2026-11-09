import { existsSync, readFileSync } from 'node:fs'

// Minimal .env loader so local overrides work without another dependency.
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m && process.env[m[1]] === undefined && m[2] !== '') process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const isProd = process.env.NODE_ENV === 'production'

if (isProd && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production.')
}

export const config = {
  isProd,
  // `--port` (used by `npm run dev`) wins over PORT, which hosts like Render set in production.
  port: Number(argValue('--port') ?? process.env.PORT ?? 3001),
  databaseUrl: process.env.DATABASE_URL || undefined,
  dataDir: process.env.PGLITE_DIR ?? '.data/pila',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me',
  seedDemo: process.env.SEED_DEMO !== 'false',
}
