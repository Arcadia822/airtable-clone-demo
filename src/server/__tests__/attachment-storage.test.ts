import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { and, asc, eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  attachmentBlobs as attachmentBlobsTable,
  attachmentChunks as attachmentChunksTable,
  attachments as attachmentsTable,
  fields as fieldsTable,
  forms as formsTable,
  formVersionFields as formVersionFieldsTable,
  formVersions as formVersionsTable,
} from "../../../drizzle/schema"
import { getDb, resetDbForTests } from "@/db/client"
import { ensureSeededBase } from "@/db/seed"
import {
  createPublicUploadSession,
  createUploadSession,
  deleteAttachment,
  finalizeAttachment,
  finalizePublicAttachment,
  MAX_FILE_BYTES,
  resolveAttachmentDownload,
  storePublicUpload,
  storeUpload,
} from "@/server/services/attachments"
import { createAttachmentStorage } from "@/server/storage"
import { ATTACHMENT_CHUNK_SIZE } from "@/server/storage/types"

const ORG_ID = "local-org"
const USER_ID = "local-user"

let uploadDir: string

beforeEach(async () => {
  process.env.DATABASE_URL = "pglite:memory"
  delete process.env.ATTACHMENT_STORAGE
  uploadDir = mkdtempSync(path.join(os.tmpdir(), "factory-attachment-storage-"))
  process.env.UPLOAD_DIR = uploadDir
  await resetDbForTests()
})

afterEach(async () => {
  await resetDbForTests()
  delete process.env.ATTACHMENT_STORAGE
  delete process.env.UPLOAD_DIR
  rmSync(uploadDir, { recursive: true, force: true })
})

async function seededField(name: string) {
  const db = await getDb()
  const seed = await ensureSeededBase(db, ORG_ID, USER_ID)
  const [field] = await db
    .select()
    .from(fieldsTable)
    .where(and(eq(fieldsTable.tableId, seed.tableId), eq(fieldsTable.name, name)))
    .limit(1)
  if (!field) throw new Error(`Missing seeded field: ${name}`)
  return { db, tableId: seed.tableId, baseId: seed.baseId, field }
}

function payload(size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  for (let index = 0; index < size; index += 1) {
    bytes[index] = (index * 31 + 7) % 256
  }
  return bytes
}

function uploadRequest(bytes: Uint8Array, mimeType: string, name: string): Request {
  return new Request("http://localhost/api/attachments/upload", {
    method: "PUT",
    headers: { "content-type": mimeType, "x-file-name": name },
    // The DOM lib types only accept `ArrayBuffer`-backed views.
    body: bytes as unknown as BodyInit,
  })
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of stream) {
    chunks.push(chunk)
    total += chunk.byteLength
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

async function publishForm(options: {
  baseId: string
  tableId: string
  fieldId: string
  fieldType: string
  slug: string
  status: string
  withVersion: boolean
}) {
  const db = await getDb()
  const formId = `frm_${options.slug}`
  const versionId = `fver_${options.slug}`
  await db.insert(formsTable).values({
    id: formId,
    orgId: ORG_ID,
    baseId: options.baseId,
    tableId: options.tableId,
    name: options.slug,
    slug: options.slug,
    status: options.status,
    publishedVersionId: options.withVersion ? versionId : null,
    createdBy: USER_ID,
  })
  if (!options.withVersion) return { formId, versionId }
  await db.insert(formVersionsTable).values({
    id: versionId,
    orgId: ORG_ID,
    formId,
    versionNumber: 1,
    title: options.slug,
    publishedBy: USER_ID,
  })
  await db.insert(formVersionFieldsTable).values({
    id: `fvf_${options.slug}`,
    orgId: ORG_ID,
    formVersionId: versionId,
    targetFieldId: options.fieldId,
    targetFieldType: options.fieldType,
    label: options.slug,
    rank: "a0",
    fieldConfig: { attachmentKind: options.fieldType === "image" ? "image" : "any" },
  })
  return { formId, versionId }
}

describe("Postgres attachment storage", () => {
  it("stores a 2.5 MB upload as multiple chunks and roundtrips byte-identically", async () => {
    const { db, tableId, field } = await seededField("Brief & Specs")
    const bytes = payload(2.5 * 1024 * 1024)

    const session = await createUploadSession(db, ORG_ID, USER_ID, {
      tableId,
      fieldId: field.id,
    })
    const stored = await storeUpload(
      db,
      ORG_ID,
      session.uploadSessionId,
      uploadRequest(bytes, "application/pdf", "spec.pdf"),
    )
    expect(stored.size).toBe(bytes.byteLength)
    expect(stored.storageId.startsWith(`${session.uploadSessionId}/`)).toBe(true)

    const finalized = await finalizeAttachment(db, ORG_ID, USER_ID, {
      uploadSessionId: session.uploadSessionId,
      storageId: stored.storageId,
      name: "spec.pdf",
      mimeType: "application/pdf",
    })
    const attachmentId = finalized.attachment.id

    const [blob] = await db
      .select()
      .from(attachmentBlobsTable)
      .where(eq(attachmentBlobsTable.attachmentId, attachmentId))
    expect(blob).toMatchObject({
      orgId: ORG_ID,
      byteSize: bytes.byteLength,
      chunkCount: Math.ceil(bytes.byteLength / ATTACHMENT_CHUNK_SIZE),
    })
    expect(blob.chunkCount).toBeGreaterThanOrEqual(3)

    // Temp rows were promoted, not copied under a second key.
    const tempRows = await db
      .select()
      .from(attachmentChunksTable)
      .where(eq(attachmentChunksTable.attachmentId, stored.storageId))
    expect(tempRows).toHaveLength(0)

    const chunkRows = await db
      .select({ seq: attachmentChunksTable.seq, bytes: attachmentChunksTable.bytes })
      .from(attachmentChunksTable)
      .where(eq(attachmentChunksTable.attachmentId, attachmentId))
      .orderBy(asc(attachmentChunksTable.seq))
    expect(chunkRows).toHaveLength(blob.chunkCount)
    expect(chunkRows.every((row) => row.bytes instanceof Uint8Array)).toBe(true)

    const direct = new Uint8Array(bytes.byteLength)
    let offset = 0
    for (const row of chunkRows) {
      direct.set(row.bytes, offset)
      offset += row.bytes.byteLength
    }
    expect(offset).toBe(bytes.byteLength)
    expect(Buffer.from(direct).equals(Buffer.from(bytes))).toBe(true)

    await resolveAttachmentDownload(db, attachmentId, ORG_ID)
    const storage = await createAttachmentStorage(db)
    const read = await storage.read(attachmentId)
    expect(read.size).toBe(bytes.byteLength)
    expect(read.chunkCount).toBe(blob.chunkCount)
    const streamed = await collect(read.stream)
    expect(Buffer.from(streamed).equals(Buffer.from(bytes))).toBe(true)

    // Nothing was written to the filesystem.
    expect(readdirSync(uploadDir)).toEqual([])
  }, 30_000)

  it("rejects uploads above 25 MB", async () => {
    const { db, tableId, field } = await seededField("Brief & Specs")
    const session = await createUploadSession(db, ORG_ID, USER_ID, {
      tableId,
      fieldId: field.id,
    })
    const oversized = new Uint8Array(MAX_FILE_BYTES + 1)

    await expect(
      storeUpload(
        db,
        ORG_ID,
        session.uploadSessionId,
        uploadRequest(oversized, "application/pdf", "huge.pdf"),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" })

    expect(await db.select().from(attachmentChunksTable)).toHaveLength(0)
    expect(readdirSync(uploadDir)).toEqual([])
  }, 30_000)

  it("rejects non-image uploads for image columns", async () => {
    const { db, tableId, field } = await seededField("Cover Image")
    const session = await createUploadSession(db, ORG_ID, USER_ID, {
      tableId,
      fieldId: field.id,
    })
    expect(session.attachmentKind).toBe("image")

    await expect(
      storeUpload(
        db,
        ORG_ID,
        session.uploadSessionId,
        uploadRequest(payload(1024), "text/plain", "notes.txt"),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" })

    expect(await db.select().from(attachmentChunksTable)).toHaveLength(0)
  })

  it("deletes chunk, blob, and attachment rows", async () => {
    const { db, tableId, field } = await seededField("Brief & Specs")
    const bytes = payload(64 * 1024)
    const session = await createUploadSession(db, ORG_ID, USER_ID, { tableId, fieldId: field.id })
    const stored = await storeUpload(
      db,
      ORG_ID,
      session.uploadSessionId,
      uploadRequest(bytes, "application/pdf", "delete-me.pdf"),
    )
    const finalized = await finalizeAttachment(db, ORG_ID, USER_ID, {
      uploadSessionId: session.uploadSessionId,
      storageId: stored.storageId,
      name: "delete-me.pdf",
      mimeType: "application/pdf",
    })
    const attachmentId = finalized.attachment.id

    await deleteAttachment(db, ORG_ID, attachmentId)

    const chunks = await db
      .select()
      .from(attachmentChunksTable)
      .where(eq(attachmentChunksTable.attachmentId, attachmentId))
    const blobs = await db
      .select()
      .from(attachmentBlobsTable)
      .where(eq(attachmentBlobsTable.attachmentId, attachmentId))
    const rows = await db
      .select()
      .from(attachmentsTable)
      .where(eq(attachmentsTable.id, attachmentId))
    expect(chunks).toHaveLength(0)
    expect(blobs).toHaveLength(0)
    expect(rows).toHaveLength(0)

    await expect(
      resolveAttachmentDownload(db, attachmentId, ORG_ID),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("keeps anonymous published-form uploads and downloads working", async () => {
    const { db, baseId, tableId, field } = await seededField("Cover Image")
    await publishForm({
      baseId,
      tableId,
      fieldId: field.id,
      fieldType: "image",
      slug: "public-storage-test",
      status: "published",
      withVersion: true,
    })

    const session = await createPublicUploadSession(db, "public-storage-test", {
      tableId,
      fieldId: field.id,
    })
    expect(session.attachmentKind).toBe("image")

    const bytes = payload(3 * 1024 * 1024)
    const stored = await storePublicUpload(
      db,
      "public-storage-test",
      session.uploadSessionId,
      uploadRequest(bytes, "image/png", "cover.png"),
    )
    const finalized = await finalizePublicAttachment(db, "public-storage-test", {
      uploadSessionId: session.uploadSessionId,
      storageId: stored.storageId,
      name: "cover.png",
      mimeType: "image/png",
    })
    const attachmentId = finalized.attachment.id

    // Anonymous viewer: no org membership, access granted by the published form.
    const { row } = await resolveAttachmentDownload(db, attachmentId)
    expect(row.id).toBe(attachmentId)
    const storage = await createAttachmentStorage(db)
    const read = await storage.read(attachmentId)
    expect(read.chunkCount).toBe(Math.ceil(bytes.byteLength / ATTACHMENT_CHUNK_SIZE))
    const streamed = await collect(read.stream)
    expect(Buffer.from(streamed).equals(Buffer.from(bytes))).toBe(true)

    const [blob] = await db
      .select()
      .from(attachmentBlobsTable)
      .where(eq(attachmentBlobsTable.attachmentId, attachmentId))
    expect(blob.byteSize).toBe(bytes.byteLength)

    await db
      .update(formsTable)
      .set({ status: "closed" })
      .where(eq(formsTable.slug, "public-storage-test"))
    await expect(
      createPublicUploadSession(db, "public-storage-test", {}),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  }, 30_000)

  it("rejects closed and draft public form slugs", async () => {
    const { db, baseId, tableId, field } = await seededField("Brief & Specs")
    await publishForm({
      baseId,
      tableId,
      fieldId: field.id,
      fieldType: "attachment",
      slug: "closed-storage-test",
      status: "closed",
      withVersion: true,
    })
    await publishForm({
      baseId,
      tableId,
      fieldId: field.id,
      fieldType: "attachment",
      slug: "draft-storage-test",
      status: "draft",
      withVersion: false,
    })

    await expect(
      createPublicUploadSession(db, "closed-storage-test", {}),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    await expect(
      createPublicUploadSession(db, "draft-storage-test", {}),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    await expect(
      createPublicUploadSession(db, "missing-storage-test", {}),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })
})
