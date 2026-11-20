import { createReadStream } from "node:fs"
import { mkdir, open, rm, stat } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"

import { AppError } from "@/lib/domain"

import { chunkParts } from "./chunking"
import {
  ATTACHMENT_CHUNK_SIZE,
  type AttachmentStorage,
  type StoredAttachmentBytes,
} from "./types"

const STORAGE_KEY_PATTERN = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)?$/

function storageRoot(): string {
  return path.resolve(process.env.UPLOAD_DIR?.trim() || ".data/uploads")
}

/** Dev-only filesystem adapter, enabled with `ATTACHMENT_STORAGE=fs`. */
export class LocalFsAttachmentStorage implements AttachmentStorage {
  private resolve(storageKey: string): string {
    if (!STORAGE_KEY_PATTERN.test(storageKey)) {
      throw new AppError("VALIDATION_ERROR", "Invalid storage key.")
    }
    const root = storageRoot()
    const resolved = path.resolve(root, storageKey)
    if (!resolved.startsWith(`${root}${path.sep}`)) {
      throw new AppError("VALIDATION_ERROR", "Invalid storage key.")
    }
    return resolved
  }

  async putChunks(
    attachmentId: string,
    _orgId: string,
    parts: AsyncIterable<Uint8Array> | readonly Uint8Array[],
    byteSize: number,
  ): Promise<void> {
    const target = this.resolve(attachmentId)
    await mkdir(path.dirname(target), { recursive: true })

    const handle = await open(target, "w")
    let total = 0
    try {
      for await (const chunk of chunkParts(parts)) {
        total += chunk.byteLength
        await handle.write(chunk)
      }
    } finally {
      await handle.close()
    }

    if (total !== byteSize) {
      await rm(target, { force: true })
      throw new AppError("VALIDATION_ERROR", "Uploaded byte count did not match.")
    }
  }

  async read(attachmentId: string): Promise<StoredAttachmentBytes> {
    const target = this.resolve(attachmentId)
    const stats = await stat(target).catch(() => null)
    if (!stats?.isFile()) {
      throw new AppError("NOT_FOUND", "Attachment file is missing.")
    }
    const stream = Readable.toWeb(
      createReadStream(target),
    ) as ReadableStream<Uint8Array>
    return {
      stream,
      size: stats.size,
      chunkCount: Math.max(1, Math.ceil(stats.size / ATTACHMENT_CHUNK_SIZE)),
    }
  }

  async remove(attachmentId: string): Promise<void> {
    await rm(this.resolve(attachmentId), { force: true })
  }
}
