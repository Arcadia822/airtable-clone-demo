import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { nanoid } from "nanoid"
import { z } from "zod"

import {
  attachmentBlobs as attachmentBlobsTable,
  attachmentChunks as attachmentChunksTable,
  attachments as attachmentsTable,
  fields as fieldsTable,
  forms as formsTable,
  formVersionFields,
  formVersions,
  records as recordsTable,
  uploadSessions,
} from "../../../drizzle/schema"
import type { AppDb } from "@/db/client"
import { AppError, type AttachmentValue, type FieldConfig } from "@/lib/domain"

import { requireTable } from "@/server/services/tables"
import { createAttachmentStorage, ATTACHMENT_CHUNK_SIZE } from "@/server/storage"

export const MAX_FILE_BYTES = 25 * 1024 * 1024
export const DEFAULT_SESSION_TTL_SECONDS = 60 * 60

export type AttachmentRow = typeof attachmentsTable.$inferSelect

export interface ResolvedAttachment extends AttachmentValue {
  attachmentId: string
}

/** Splits buffered upload bytes into zero-copy chunk views for the adapter. */
function byteParts(bytes: Uint8Array): Uint8Array[] {
  const parts: Uint8Array[] = []
  for (let offset = 0; offset < bytes.byteLength; offset += ATTACHMENT_CHUNK_SIZE) {
    parts.push(bytes.subarray(offset, offset + ATTACHMENT_CHUNK_SIZE))
  }
  return parts
}


export function attachmentValueFromRow(row: AttachmentRow): ResolvedAttachment {
  return {
    id: row.id,
    attachmentId: row.id,
    name: row.name,
    mimeType: row.mimeType,
    size: row.size,
    url: `/api/files/${row.id}`,
  }
}

function mimeFromExtension(name: string): string | undefined {
  const extension = /\.([A-Za-z0-9]{1,10})$/.exec(name)?.[1]?.toLowerCase()
  if (!extension) return undefined
  const table: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    svg: "image/svg+xml",
    pdf: "application/pdf",
    csv: "text/csv",
    txt: "text/plain",
    json: "application/json",
    zip: "application/zip",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }
  return table[extension]
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "image/svg+xml": ".svg",
  "application/pdf": ".pdf",
  "text/csv": ".csv",
  "text/plain": ".txt",
  "application/json": ".json",
  "application/zip": ".zip",
}

function sanitizeFileName(raw: string): string {
  const base =
    raw.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, "").trim() ?? ""
  const cleaned = base.replace(/[\\/:*?"<>|]/g, "_").slice(0, 255)
  return cleaned || "upload"
}

function extensionFor(name: string, mimeType: string): string {
  const fromName = /(\.[A-Za-z0-9]{1,10})$/.exec(name)?.[1]?.toLowerCase()
  if (fromName) return fromName
  return EXTENSION_BY_MIME[mimeType.toLowerCase()] ?? ""
}

export type AttachmentKind = "image" | "file" | "any"

async function attachmentKindForField(
  db: AppDb,
  orgId: string,
  tableId: string,
  fieldId: string | null | undefined,
): Promise<AttachmentKind | undefined> {
  if (!fieldId) return undefined
  const [field] = await db
    .select()
    .from(fieldsTable)
    .where(
      and(
        eq(fieldsTable.id, fieldId),
        eq(fieldsTable.orgId, orgId),
        eq(fieldsTable.tableId, tableId),
      ),
    )
    .limit(1)
  if (!field) throw new AppError("NOT_FOUND", "Field not found.")
  if (field.type === "image") return "image"
  return ((field.config ?? {}) as FieldConfig).attachmentKind ?? "any"
}

/* -------------------------------------------------------------------------- */
/* Upload session                                                             */
/* -------------------------------------------------------------------------- */

export const createUploadSessionInputSchema = z.object({
  tableId: z.string().min(1),
  fieldId: z.string().min(1).optional(),
  recordId: z.string().min(1).optional(),
  attachmentKind: z.enum(["image", "file", "any"]).optional(),
  ttlSeconds: z.number().int().min(60).max(86_400).optional(),
})

export interface UploadSessionJson {
  uploadSessionId: string
  uploadUrl: string
  expiresAt: string
  attachmentKind: AttachmentKind
}

export async function createUploadSession(
  db: AppDb,
  orgId: string,
  userId: string,
  rawInput: unknown,
): Promise<UploadSessionJson> {
  const input = createUploadSessionInputSchema.parse(rawInput)
  await requireTable(db, orgId, input.tableId)
  if (input.recordId) {
    const [record] = await db
      .select({ id: recordsTable.id })
      .from(recordsTable)
      .where(
        and(
          eq(recordsTable.id, input.recordId),
          eq(recordsTable.orgId, orgId),
          eq(recordsTable.tableId, input.tableId),
          eq(recordsTable.status, "active"),
        ),
      )
      .limit(1)
    if (!record) throw new AppError("NOT_FOUND", "Record not found.")
  }

  const fieldKind = await attachmentKindForField(
    db,
    orgId,
    input.tableId,
    input.fieldId,
  )
  const kind: AttachmentKind =
    fieldKind === "image" ? "image" : (input.attachmentKind ?? fieldKind ?? "any")

  const sessionId = `ups_${nanoid(12)}`
  const ttlSeconds = input.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)

  await db.insert(uploadSessions).values({
    id: sessionId,
    orgId,
    tableId: input.tableId,
    recordId: input.recordId ?? null,
    fieldId: input.fieldId ?? null,
    expiresAt,
    createdBy: userId,
  })

  return {
    uploadSessionId: sessionId,
    uploadUrl: `/api/attachments/upload/${sessionId}?attachmentKind=${kind}`,
    expiresAt: expiresAt.toISOString(),
    attachmentKind: kind,
  }
}

export const PUBLIC_SESSION_TTL_SECONDS = 15 * 60
export const PUBLIC_UPLOAD_CREATED_BY = "public-form"

export interface PublishedFormContext {
  formId: string
  orgId: string
  tableId: string
  slug: string
  versionId: string
  fieldsById: Map<string, { type: string; config: FieldConfig }>
}

/**
 * Resolves a public form that respondents may upload to: it must be published
 * and point at an existing published version.
 */
export async function resolvePublishedForm(
  db: AppDb,
  rawSlug: string,
): Promise<PublishedFormContext> {
  const slug = rawSlug.trim()
  if (!slug) throw new AppError("NOT_FOUND", "Published form not found.")

  const [form] = await db
    .select()
    .from(formsTable)
    .where(and(eq(formsTable.slug, slug), eq(formsTable.status, "published")))
    .limit(1)
  if (!form || !form.publishedVersionId) {
    throw new AppError("NOT_FOUND", "Published form not found.")
  }

  const [version] = await db
    .select()
    .from(formVersions)
    .where(
      and(
        eq(formVersions.id, form.publishedVersionId),
        eq(formVersions.formId, form.id),
        eq(formVersions.orgId, form.orgId),
      ),
    )
    .limit(1)
  if (!version) throw new AppError("NOT_FOUND", "Published form not found.")

  await requireTable(db, form.orgId, form.tableId)

  const versionFields = await db
    .select()
    .from(formVersionFields)
    .where(
      and(
        eq(formVersionFields.formVersionId, version.id),
        eq(formVersionFields.orgId, form.orgId),
      ),
    )

  return {
    formId: form.id,
    orgId: form.orgId,
    tableId: form.tableId,
    slug,
    versionId: version.id,
    fieldsById: new Map(
      versionFields.map((field) => [
        field.targetFieldId,
        { type: field.targetFieldType, config: (field.fieldConfig ?? {}) as FieldConfig },
      ]),
    ),
  }
}

export const createPublicUploadSessionInputSchema = z.object({
  tableId: z.string().min(1).optional(),
  fieldId: z.string().min(1).optional(),
  attachmentKind: z.enum(["image", "file", "any"]).optional(),
  ttlSeconds: z.number().int().min(60).max(PUBLIC_SESSION_TTL_SECONDS).optional(),
})

/**
 * Creates a short-lived upload session for an anonymous public form
 * respondent. The session is bound to the form's organization and table.
 */
export async function createPublicUploadSession(
  db: AppDb,
  rawSlug: string,
  rawInput: unknown,
): Promise<UploadSessionJson> {
  const form = await resolvePublishedForm(db, rawSlug)
  const input = createPublicUploadSessionInputSchema.parse(rawInput)
  if (input.tableId && input.tableId !== form.tableId) {
    throw new AppError("NOT_FOUND", "Published form not found.")
  }

  let fieldId: string | null = null
  let formField: { type: string; config: FieldConfig } | undefined
  if (input.fieldId) {
    formField = form.fieldsById.get(input.fieldId)
    if (!formField) {
      throw new AppError("NOT_FOUND", "Field is not part of this published form.")
    }
    const [activeField] = await db
      .select({ id: fieldsTable.id })
      .from(fieldsTable)
      .where(
        and(
          eq(fieldsTable.id, input.fieldId),
          eq(fieldsTable.orgId, form.orgId),
          eq(fieldsTable.tableId, form.tableId),
          eq(fieldsTable.status, "active"),
        ),
      )
      .limit(1)
    if (!activeField) throw new AppError("NOT_FOUND", "Field not found.")
    fieldId = input.fieldId
  }

  const kind: AttachmentKind =
    formField?.type === "image"
      ? "image"
      : (input.attachmentKind ?? formField?.config.attachmentKind ?? "any")

  const sessionId = `ups_${nanoid(12)}`
  const ttlSeconds = Math.min(
    input.ttlSeconds ?? PUBLIC_SESSION_TTL_SECONDS,
    PUBLIC_SESSION_TTL_SECONDS,
  )
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)

  await db.insert(uploadSessions).values({
    id: sessionId,
    orgId: form.orgId,
    tableId: form.tableId,
    recordId: null,
    fieldId,
    expiresAt,
    createdBy: PUBLIC_UPLOAD_CREATED_BY,
  })

  return {
    uploadSessionId: sessionId,
    uploadUrl: `/api/attachments/upload/${sessionId}?attachmentKind=${kind}&publicFormSlug=${encodeURIComponent(form.slug)}`,
    expiresAt: expiresAt.toISOString(),
    attachmentKind: kind,
  }
}

async function loadSession(db: AppDb, orgId: string, sessionId: string) {
  const [session] = await db
    .select()
    .from(uploadSessions)
    .where(and(eq(uploadSessions.id, sessionId), eq(uploadSessions.orgId, orgId)))
    .limit(1)
  if (!session) throw new AppError("NOT_FOUND", "Upload session not found.")
  if (session.consumedAt) {
    throw new AppError("VALIDATION_ERROR", "Upload session was already finalized.")
  }
  if (session.expiresAt.getTime() < Date.now()) {
    throw new AppError("VALIDATION_ERROR", "Upload session expired.")
  }
  return session
}

async function readUploadBody(request: Request): Promise<{
  bytes: Uint8Array
  mimeType: string
  name: string
}> {
  const contentType = request.headers.get("content-type") ?? ""
  const url = new URL(request.url)

  if (contentType.toLowerCase().includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null)
    if (!form) throw new AppError("VALIDATION_ERROR", "Malformed multipart upload.")
    let file: File | null = null
    for (const value of form.values()) {
      if (typeof value === "object" && value !== null && "arrayBuffer" in value) {
        file = value as File
        break
      }
    }
    if (!file) throw new AppError("VALIDATION_ERROR", "No file was uploaded.")
    return {
      bytes: new Uint8Array(await file.arrayBuffer()),
      mimeType: file.type || "application/octet-stream",
      name: file.name || url.searchParams.get("name") || "upload",
    }
  }

  const bytes = new Uint8Array(await request.arrayBuffer())
  return {
    bytes,
    mimeType: contentType.split(";")[0]?.trim() || "application/octet-stream",
    name:
      url.searchParams.get("name") ??
      request.headers.get("x-file-name") ??
      "upload",
  }
}

export interface StoredUpload {
  storageId: string
  size: number
  mimeType: string
  name: string
}

async function storeUploadForSession(
  db: AppDb,
  session: typeof uploadSessions.$inferSelect,
  request: Request,
): Promise<StoredUpload> {
  const { bytes, mimeType, name } = await readUploadBody(request)

  if (bytes.byteLength === 0) {
    throw new AppError("VALIDATION_ERROR", "Uploaded file is empty.", {
      maxBytes: MAX_FILE_BYTES,
    })
  }
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Files must be ${(MAX_FILE_BYTES / (1024 * 1024)).toLocaleString()}MB or smaller.`,
      { maxBytes: MAX_FILE_BYTES, actualBytes: bytes.byteLength },
    )
  }

  const fieldKind = await attachmentKindForField(
    db,
    session.orgId,
    session.tableId,
    session.fieldId,
  )
  const requestedKind = new URL(request.url).searchParams.get("attachmentKind")
  const kind: AttachmentKind =
    fieldKind === "image" || requestedKind === "image" ? "image" : "any"

  if (kind === "image" && !mimeType.toLowerCase().startsWith("image/")) {
    throw new AppError("VALIDATION_ERROR", "This column only accepts image files.", {
      mimeType,
    })
  }

  const storageId = `${session.id}/${nanoid(16)}${extensionFor(name, mimeType)}`
  const storage = await createAttachmentStorage(db)
  await storage.putChunks(
    storageId,
    session.orgId,
    byteParts(bytes),
    bytes.byteLength,
  )

  return {
    storageId,
    size: bytes.byteLength,
    mimeType,
    name: sanitizeFileName(name),
  }
}

export async function storeUpload(
  db: AppDb,
  orgId: string,
  sessionId: string,
  request: Request,
): Promise<StoredUpload> {
  const session = await loadSession(db, orgId, sessionId)
  return storeUploadForSession(db, session, request)
}

export async function storePublicUpload(
  db: AppDb,
  slug: string,
  sessionId: string,
  request: Request,
): Promise<StoredUpload> {
  const form = await resolvePublishedForm(db, slug)
  const session = await loadSession(db, form.orgId, sessionId)
  if (session.tableId !== form.tableId) {
    throw new AppError("NOT_FOUND", "Upload session not found.")
  }
  return storeUploadForSession(db, session, request)
}

/* -------------------------------------------------------------------------- */
/* Finalize                                                                   */
/* -------------------------------------------------------------------------- */

export const finalizeUploadInputSchema = z.object({
  uploadSessionId: z.string().min(1),
  storageId: z.string().min(1),
  name: z.string().trim().min(1).max(255).optional(),
  mimeType: z.string().trim().min(1).max(200).optional(),
})

async function finalizeUploadSession(
  db: AppDb,
  session: typeof uploadSessions.$inferSelect,
  userId: string | null,
  input: { uploadSessionId: string; storageId: string; name?: string; mimeType?: string },
): Promise<{ ok: true; attachment: ResolvedAttachment }> {
  if (!input.storageId.startsWith(`${session.id}/`)) {
    throw new AppError("VALIDATION_ERROR", "Upload does not belong to this session.")
  }
  const [stats] = await db
    .select({
      chunkCount: sql<number>`count(*)::int`,
      byteSize: sql<number>`coalesce(sum(octet_length(${attachmentChunksTable.bytes})), 0)::int`,
    })
    .from(attachmentChunksTable)
    .where(eq(attachmentChunksTable.attachmentId, input.storageId))
  if (!stats || stats.chunkCount === 0 || stats.byteSize === 0) {
    throw new AppError("NOT_FOUND", "Uploaded file not found.")
  }

  const name = sanitizeFileName(
    input.name ?? input.storageId.slice(input.storageId.lastIndexOf("/") + 1),
  )
  const mimeType =
    input.mimeType ?? mimeFromExtension(name) ?? "application/octet-stream"
  const fieldKind = await attachmentKindForField(
    db,
    session.orgId,
    session.tableId,
    session.fieldId,
  )
  if (fieldKind === "image" && !mimeType.toLowerCase().startsWith("image/")) {
    throw new AppError("VALIDATION_ERROR", "This column only accepts image files.")
  }

  const attachmentId = `att_${nanoid(12)}`
  let row: AttachmentRow | undefined

  await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(attachmentsTable)
      .values({
        id: attachmentId,
        orgId: session.orgId,
        tableId: session.tableId,
        recordId: session.recordId,
        fieldId: session.fieldId,
        name,
        mimeType,
        size: stats.byteSize,
        storageKey: attachmentId,
        status: "active",
        createdBy: userId ?? PUBLIC_UPLOAD_CREATED_BY,
      })
      .returning()
    if (!inserted) throw new AppError("VALIDATION_ERROR", "Upload could not be finalized.")
    row = inserted

    const moved = await tx
      .update(attachmentChunksTable)
      .set({ attachmentId })
      .where(eq(attachmentChunksTable.attachmentId, input.storageId))
      .returning({ seq: attachmentChunksTable.seq })
    if (moved.length !== stats.chunkCount) {
      throw new AppError("VALIDATION_ERROR", "Upload is no longer available.")
    }

    await tx.insert(attachmentBlobsTable).values({
      attachmentId,
      orgId: session.orgId,
      byteSize: stats.byteSize,
      chunkCount: stats.chunkCount,
    })

    await tx
      .update(uploadSessions)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(uploadSessions.id, session.id),
          eq(uploadSessions.orgId, session.orgId),
        ),
      )
  })

  if (!row) throw new AppError("VALIDATION_ERROR", "Upload could not be finalized.")
  return { ok: true, attachment: attachmentValueFromRow(row) }
}

export async function finalizeAttachment(
  db: AppDb,
  orgId: string,
  userId: string,
  rawInput: unknown,
): Promise<{ ok: true; attachment: ResolvedAttachment }> {
  const input = finalizeUploadInputSchema.parse(rawInput)
  const session = await loadSession(db, orgId, input.uploadSessionId)
  return finalizeUploadSession(db, session, userId, input)
}

export async function finalizePublicAttachment(
  db: AppDb,
  slug: string,
  rawInput: unknown,
): Promise<{ ok: true; attachment: ResolvedAttachment }> {
  const input = finalizeUploadInputSchema.parse(rawInput)
  const form = await resolvePublishedForm(db, slug)
  const session = await loadSession(db, form.orgId, input.uploadSessionId)
  if (session.tableId !== form.tableId) {
    throw new AppError("NOT_FOUND", "Upload session not found.")
  }
  return finalizeUploadSession(db, session, null, input)
}

/* -------------------------------------------------------------------------- */
/* Read / delete / download                                                   */
/* -------------------------------------------------------------------------- */

export async function listAttachments(
  db: AppDb,
  orgId: string,
  rawIds: readonly string[],
): Promise<{ attachments: AttachmentValue[] }> {
  const ids = [...new Set(rawIds.filter(Boolean))].slice(0, 100)
  if (!ids.length) return { attachments: [] }
  const rows = await db
    .select()
    .from(attachmentsTable)
    .where(
      and(
        eq(attachmentsTable.orgId, orgId),
        eq(attachmentsTable.status, "active"),
        inArray(attachmentsTable.id, ids),
      ),
    )
    .orderBy(desc(attachmentsTable.createdAt))
  return {
    attachments: rows.map((row) => ({
      id: row.id,
      name: row.name,
      mimeType: row.mimeType,
      size: row.size,
      url: `/api/files/${row.id}`,
    })),
  }
}

export async function deleteAttachment(db: AppDb, orgId: string, attachmentId: string) {
  const [row] = await db
    .select({ id: attachmentsTable.id })
    .from(attachmentsTable)
    .where(
      and(
        eq(attachmentsTable.id, attachmentId),
        eq(attachmentsTable.orgId, orgId),
        eq(attachmentsTable.status, "active"),
      ),
    )
    .limit(1)
  if (!row) throw new AppError("NOT_FOUND", "Attachment not found.")
  const storage = await createAttachmentStorage(db)
  await storage.remove(attachmentId)
  await db
    .delete(attachmentsTable)
    .where(and(eq(attachmentsTable.id, attachmentId), eq(attachmentsTable.orgId, orgId)))
  return { ok: true as const, attachmentId }
}

export interface AttachmentDownload {
  row: AttachmentRow
}

/**
 * Streams are authorized by organization membership, or by a published form
 * that targets the attachment's table (public form submissions).
 */
export async function resolveAttachmentDownload(
  db: AppDb,
  attachmentId: string,
  viewerOrgId?: string,
): Promise<AttachmentDownload> {
  const [row] = await db
    .select()
    .from(attachmentsTable)
    .where(
      and(eq(attachmentsTable.id, attachmentId), eq(attachmentsTable.status, "active")),
    )
    .limit(1)
  if (!row) throw new AppError("NOT_FOUND", "Attachment not found.")

  if (viewerOrgId !== row.orgId) {
    const [publishedForm] = await db
      .select({ id: formsTable.id })
      .from(formsTable)
      .where(
        and(eq(formsTable.tableId, row.tableId), eq(formsTable.status, "published")),
      )
      .limit(1)
    if (!publishedForm) {
      throw new AppError("NOT_FOUND", "Attachment not found.")
    }
  }

  return { row }
}
