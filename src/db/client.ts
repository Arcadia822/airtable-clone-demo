import type { PgliteDatabase } from "drizzle-orm/pglite"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"

import * as schema from "../../drizzle/schema"

/**
 * Every supported driver (PGlite, node-postgres, Neon serverless) shares the
 * same PostgreSQL query builder surface, so services only ever depend on this
 * base type. Keeping it driver-agnostic lets the runtime pick a driver without
 * leaking into application code.
 */
export type AppDb = PgDatabase<PgQueryResultHKT, typeof schema>

interface DbState {
  db: AppDb
  /** Releases the underlying connection. PGlite and pools both need it. */
  close?: () => Promise<void>
  migrated: boolean
  migratePromise?: Promise<void>
}

const globalForDb = globalThis as unknown as {
  __factoryAirtableDbState?: Promise<DbState>
}

function isNeonUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host.endsWith(".neon.tech")
  } catch {
    return url.includes(".neon.tech")
  }
}

/**
 * True inside a Cloudflare Worker / edge isolate. Those runtimes cannot load
 * `node:fs`, `pg`, or the PGlite WASM bundle, so the only supported backend is
 * Neon over WebSockets.
 */
function isWorkerRuntime(): boolean {
  if ("EdgeRuntime" in globalThis) return true
  if (process.env.NEXT_RUNTIME === "edge") return true
  const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent
  return typeof userAgent === "string" && userAgent.includes("Cloudflare-Workers")
}

async function createPgliteState(url: string | undefined): Promise<DbState> {
  if (isWorkerRuntime()) {
    throw new Error(
      "DATABASE_URL points at PGlite, which cannot run in a Worker runtime. Set DATABASE_URL to a Neon connection string (*.neon.tech).",
    )
  }
  // Dynamic import is required: `node:fs`, `node:path`, and the PGlite WASM
  // bundle do not exist in Worker runtimes, so they must stay out of the
  // statically bundled module graph.
  const fs = await import("node:fs")
  const path = await import("node:path")
  const { PGlite } = await import("@electric-sql/pglite")
  const { drizzle } = await import("drizzle-orm/pglite")

  const target = !url
    ? path.resolve(process.cwd(), ".data/pglite")
    : url === "pglite:memory"
      ? undefined
      : url.slice("pglite:".length)

  if (target) {
    fs.mkdirSync(target, { recursive: true })
  }

  const pglite = target ? new PGlite(target) : new PGlite()
  const db = drizzle(pglite, { schema }) as unknown as AppDb
  return {
    db,
    close: () => pglite.close(),
    migrated: false,
  }
}

async function createNeonState(url: string): Promise<DbState> {
  // `neon-serverless` speaks the WebSocket protocol, so transactions work in
  // Node (global WebSocket on Node 22+) and in Workers. `neon-http` cannot run
  // transactions at all, which is why it is not used here.
  const { Pool } = await import("@neondatabase/serverless")
  const { drizzle } = await import("drizzle-orm/neon-serverless")

  const pool = new Pool({ connectionString: url })
  const db = drizzle(pool, { schema }) as unknown as AppDb
  return {
    db,
    close: () => pool.end(),
    migrated: true,
  }
}

async function createNodePostgresState(url: string): Promise<DbState> {
  if (isWorkerRuntime()) {
    throw new Error(
      `DATABASE_URL must point at Neon (*.neon.tech) in a Worker runtime; node-postgres is unavailable. Received host "${safeHost(url)}".`,
    )
  }
  // Dynamic import is required: `pg` and its native sockets cannot be bundled
  // into a Worker, where only the Neon WebSocket driver is supported.
  const { Pool } = await import("pg")
  const { drizzle } = await import("drizzle-orm/node-postgres")

  const pool = new Pool({ connectionString: url })
  const db = drizzle(pool, { schema }) as unknown as AppDb
  return {
    db,
    close: () => pool.end(),
    migrated: true,
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return "unknown"
  }
}

async function createDbState(): Promise<DbState> {
  const url = process.env.DATABASE_URL?.trim()

  if (!url || url.startsWith("pglite:")) {
    return createPgliteState(url)
  }

  if (isNeonUrl(url)) {
    return createNeonState(url)
  }

  return createNodePostgresState(url)
}

function getDbState(): Promise<DbState> {
  if (!globalForDb.__factoryAirtableDbState) {
    const pending = createDbState()
    globalForDb.__factoryAirtableDbState = pending
    // A failed connect must not poison the cache: the next caller retries.
    pending.catch(() => {
      if (globalForDb.__factoryAirtableDbState === pending) {
        globalForDb.__factoryAirtableDbState = undefined
      }
    })
  }
  return globalForDb.__factoryAirtableDbState
}

export async function ensureMigrated(): Promise<void> {
  const state = await getDbState()
  if (state.migrated) return
  if (!state.migratePromise) {
    state.migratePromise = (async () => {
      const path = await import("node:path")
      const { migrate } = await import("drizzle-orm/pglite/migrator")
      await migrate(state.db as PgliteDatabase<typeof schema>, {
        migrationsFolder: path.resolve(process.cwd(), "drizzle"),
      })
      state.migrated = true
    })()
    state.migratePromise.catch(() => {
      state.migratePromise = undefined
    })
  }
  await state.migratePromise
}

export async function getDb(): Promise<AppDb> {
  const state = await getDbState()
  if (!state.migrated) {
    await ensureMigrated()
  }
  return state.db
}

export async function resetDbForTests(): Promise<void> {
  const pending = globalForDb.__factoryAirtableDbState
  globalForDb.__factoryAirtableDbState = undefined
  if (!pending) return
  const state = await pending.catch(() => undefined)
  await state?.close?.()
}
