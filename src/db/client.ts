import path from "node:path"
import fs from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { neon } from "@neondatabase/serverless"
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http"
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres"
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite"
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator"
import { Pool } from "pg"

import * as schema from "../../drizzle/schema"

export type AppDb = PgliteDatabase<typeof schema>

interface DbState {
  db: AppDb
  pglite?: PGlite
  pool?: Pool
  migrated: boolean
  migratePromise?: Promise<void>
}

const globalForDb = globalThis as unknown as {
  __factoryAirtableDbState?: DbState
}

function resolveMigrationsFolder(): string {
  return path.resolve(process.cwd(), "drizzle")
}

function createDbState(): DbState {
  const url = process.env.DATABASE_URL?.trim()

  if (!url || url.startsWith("pglite:")) {
    const target = !url
      ? path.resolve(process.cwd(), ".data/pglite")
      : url === "pglite:memory"
        ? undefined
        : url.slice("pglite:".length)

    if (target) {
      fs.mkdirSync(target, { recursive: true })
    }

    const pglite = target ? new PGlite(target) : new PGlite()
    const db = drizzlePglite(pglite, { schema })
    return {
      db,
      pglite,
      migrated: false,
    }
  }

  if (url.includes(".neon.tech") || url.includes("neon.tech")) {
    const sql = neon(url)
    const db = drizzleNeon(sql, { schema }) as unknown as AppDb
    return {
      db,
      migrated: true,
    }
  }

  const pool = new Pool({ connectionString: url })
  const db = drizzleNodePg(pool, { schema }) as unknown as AppDb
  return {
    db,
    pool,
    migrated: true,
  }
}

function getDbState(): DbState {
  if (!globalForDb.__factoryAirtableDbState) {
    globalForDb.__factoryAirtableDbState = createDbState()
  }
  return globalForDb.__factoryAirtableDbState
}

export async function ensureMigrated(): Promise<void> {
  const state = getDbState()
  if (state.migrated || !state.pglite) return
  if (!state.migratePromise) {
    state.migratePromise = migratePglite(state.db, {
      migrationsFolder: resolveMigrationsFolder(),
    }).then(() => {
      state.migrated = true
    })
  }
  await state.migratePromise
}

export async function getDb(): Promise<AppDb> {
  const state = getDbState()
  if (!state.migrated) {
    await ensureMigrated()
  }
  return state.db
}

export async function resetDbForTests(): Promise<void> {
  const state = globalForDb.__factoryAirtableDbState
  if (state?.pglite) {
    await state.pglite.close()
  }
  if (state?.pool) {
    await state.pool.end()
  }
  globalForDb.__factoryAirtableDbState = undefined
}
