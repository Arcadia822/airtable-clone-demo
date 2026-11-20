import { and, asc, eq, gte, lt } from "drizzle-orm"

import {
  attachmentBlobs,
  attachmentChunks,
} from "../../../drizzle/schema"
import type { AppDb } from "@/db/client"
import { AppError } from "@/lib/domain"

import { chunkParts } from "./chunking"
import type { AttachmentStorage, StoredAttachmentBytes } from "./types"

/** Chunks fetched per stream pull; keeps memory bounded for 25 MB files. */
const READ_BATCH_CHUNKS = 4

/**
 * Default adapter: attachment bytes are rows in the user's Postgres. Uses only
 * `Uint8Array` at the boundary, so it is safe inside a Worker runtime.
 */
export class PostgresAttachmentStorage implements AttachmentStorage {
  constructor(private readonly db: AppDb) {}

  async putChunks(
    attachmentId: string,
    _orgId: string,
    parts: AsyncIterable<Uint8Array> | readonly Uint8Array[],
    byteSize: number,
  ): Promise<void> {
    const rows: Array<{ attachmentId: string; seq: number; bytes: Uint8Array }> = []
    let total = 0
    let seq = 0
    for await (const chunk of chunkParts(parts)) {
      total += chunk.byteLength
      rows.push({ attachmentId, seq, bytes: chunk })
      seq += 1
    }

    if (total !== byteSize) {
      throw new AppError("VALIDATION_ERROR", "Uploaded byte count did not match.")
    }
    if (rows.length === 0) {
      throw new AppError("VALIDATION_ERROR", "Uploaded file is empty.")
    }

    await this.db.transaction(async (tx) => {
      // A retried upload under the same storage key replaces prior bytes.
      await tx
        .delete(attachmentChunks)
        .where(eq(attachmentChunks.attachmentId, attachmentId))
      await tx.insert(attachmentChunks).values(rows)
    })
  }

  async read(attachmentId: string): Promise<StoredAttachmentBytes> {
    const [blob] = await this.db
      .select({
        byteSize: attachmentBlobs.byteSize,
        chunkCount: attachmentBlobs.chunkCount,
      })
      .from(attachmentBlobs)
      .where(eq(attachmentBlobs.attachmentId, attachmentId))
      .limit(1)

    if (!blob) throw new AppError("NOT_FOUND", "Attachment file is missing.")

    const db = this.db
    let nextSeq = 0
    let emitted = 0

    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (nextSeq >= blob.chunkCount) {
          controller.close()
          return
        }

        const rows = await db
          .select({ seq: attachmentChunks.seq, bytes: attachmentChunks.bytes })
          .from(attachmentChunks)
          .where(
            and(
              eq(attachmentChunks.attachmentId, attachmentId),
              gte(attachmentChunks.seq, nextSeq),
              lt(attachmentChunks.seq, nextSeq + READ_BATCH_CHUNKS),
            ),
          )
          .orderBy(asc(attachmentChunks.seq))

        if (rows.length === 0) {
          controller.error(new Error("Attachment bytes are incomplete."))
          return
        }

        for (const row of rows) {
          controller.enqueue(
            row.bytes instanceof Uint8Array
              ? row.bytes
              : new Uint8Array(row.bytes as ArrayBuffer),
          )
        }
        nextSeq = rows[rows.length - 1].seq + 1
        emitted += rows.length
        if (emitted >= blob.chunkCount) controller.close()
      },
      cancel() {
        nextSeq = blob.chunkCount
      },
    })

    return {
      stream,
      size: blob.byteSize,
      chunkCount: blob.chunkCount,
    }
  }

  async remove(attachmentId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(attachmentChunks)
        .where(eq(attachmentChunks.attachmentId, attachmentId))
      await tx
        .delete(attachmentBlobs)
        .where(eq(attachmentBlobs.attachmentId, attachmentId))
    })
  }
}


