import type { AppDb } from "@/db/client"

import { PostgresAttachmentStorage } from "./postgres"
import type { AttachmentStorage } from "./types"

export { ATTACHMENT_CHUNK_SIZE, type AttachmentStorage, type StoredAttachmentBytes } from "./types"

/**
 * Postgres is the only durable backend: attachment bytes must survive a
 * published Worker, which has a read-only filesystem.
 *
 * `ATTACHMENT_STORAGE=fs` opts into the local adapter for debugging only. It is
 * loaded dynamically because `node:fs` does not exist in the Worker runtime, so
 * a static import would break the default Postgres path at build time.
 */
export async function createAttachmentStorage(db: AppDb): Promise<AttachmentStorage> {
  const mode = (process.env.ATTACHMENT_STORAGE ?? "postgres").trim().toLowerCase()
  if (mode === "fs") {
    const { LocalFsAttachmentStorage } = await import("./local")
    return new LocalFsAttachmentStorage()
  }
  return new PostgresAttachmentStorage(db)
}
