import { ATTACHMENT_CHUNK_SIZE } from "./types"

async function* iterate(
  parts: AsyncIterable<Uint8Array> | readonly Uint8Array[],
): AsyncGenerator<Uint8Array> {
  if (Symbol.asyncIterator in parts) {
    yield* parts as AsyncIterable<Uint8Array>
    return
  }
  for (const part of parts as readonly Uint8Array[]) yield part
}

/**
 * Normalizes arbitrary byte parts into fixed-size chunks. Full-size parts are
 * yielded as views (no copy); only chunks that span part boundaries are copied.
 */
export async function* chunkParts(
  parts: AsyncIterable<Uint8Array> | readonly Uint8Array[],
): AsyncGenerator<Uint8Array> {
  let buffer = new Uint8Array(ATTACHMENT_CHUNK_SIZE)
  let filled = 0

  for await (const part of iterate(parts)) {
    let offset = 0
    while (offset < part.byteLength) {
      if (filled === 0 && part.byteLength - offset >= ATTACHMENT_CHUNK_SIZE) {
        yield part.subarray(offset, offset + ATTACHMENT_CHUNK_SIZE)
        offset += ATTACHMENT_CHUNK_SIZE
        continue
      }

      const take = Math.min(
        ATTACHMENT_CHUNK_SIZE - filled,
        part.byteLength - offset,
      )
      buffer.set(part.subarray(offset, offset + take), filled)
      filled += take
      offset += take

      if (filled === ATTACHMENT_CHUNK_SIZE) {
        yield buffer
        buffer = new Uint8Array(ATTACHMENT_CHUNK_SIZE)
        filled = 0
      }
    }
  }

  if (filled > 0) yield buffer.slice(0, filled)
}
