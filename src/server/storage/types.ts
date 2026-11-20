/**
 * Attachment byte storage contract.
 *
 * Bytes are keyed by attachment id: during an upload session the "attachment
 * id" is the session-scoped storage key, and finalize promotes the rows to the
 * final `attachments.id`. Implementations must stay free of Node-only APIs so
 * the default (Postgres) adapter runs in a Cloudflare Worker.
 */

/** Bytes per stored chunk; 25 MB uploads produce at most 25 rows. */
export const ATTACHMENT_CHUNK_SIZE = 1024 * 1024

export interface StoredAttachmentBytes {
  stream: ReadableStream<Uint8Array>
  size: number
  chunkCount: number
}

export interface AttachmentStorage {
  /**
   * Writes `parts` under `attachmentId`. Chunk boundaries are implementation
   * detail; `byteSize` is the exact total and is validated against the parts.
   */
  putChunks(
    attachmentId: string,
    orgId: string,
    parts: AsyncIterable<Uint8Array> | readonly Uint8Array[],
    byteSize: number,
  ): Promise<void>

  read(attachmentId: string): Promise<StoredAttachmentBytes>

  remove(attachmentId: string): Promise<void>
}
