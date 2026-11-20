import { and, desc, eq, inArray, lt, sql } from "drizzle-orm"
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
import { HttpStatusError } from "@/server/http"

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

/** Raster images that are safe to render inline in a browser. */
const RASTER_IMAGE_MIME_TYPES: Record<string, true> = {
  "image/png": true,
  "image/jpeg": true,
  "image/gif": true,
  "image/webp": true,
  "image/avif": true,
}

/**
 * Types an attachment row may store. SVG is deliberately absent: it is
 * scriptable XML, so it can never be served inline and has no product use here.
 */
const ALLOWED_MIME_TYPES: Record<string, true> = {
  ...RASTER_IMAGE_MIME_TYPES,
  "application/pdf": true,
  "text/plain": true,
  "text/csv": true,
  "application/json": true,
  "application/zip": true,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": true,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": true,
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "application/pdf": ".pdf",
  "text/csv": ".csv",
  "text/plain": ".txt",
  "application/json": ".json",
  "application/zip": ".zip",
}

const SAFE_IMAGE_MESSAGE =
  "This column only accepts PNG, JPEG, GIF, WebP, or AVIF images."

export function isRasterImageMimeType(mimeType: string): boolean {
  return RASTER_IMAGE_MIME_TYPES[mimeType.trim().toLowerCase()] === true
}

/** True when the type may be rendered in the browser instead of downloaded. */
export function isInlineSafeMimeType(mimeType: string): boolean {
  return isRasterImageMimeType(mimeType)
}

function normalizeMimeType(raw: string | null | undefined): string | undefined {
  const value = raw?.split(";")[0]?.trim().toLowerCase()
  return value || undefined
}

function bytesAscii(bytes: Uint8Array, start: number, length: number): string {
  const end = Math.min(bytes.byteLength, start + length)
  let text = ""
  for (let index = start; index < end; index += 1) {
    text += String.fromCharCode(bytes[index])
  }
  return text
}

function startsWithBytes(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.byteLength < signature.length) return false
  return signature.every((byte, index) => bytes[index] === byte)
}

/**
 * Identifies content from its leading bytes. A recognized signature is
 * authoritative; the client-declared type is only ever a hint.
 */
export function sniffMimeType(bytes: Uint8Array): string | undefined {
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png"
  }
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg"
  if (startsWithBytes(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif"
  if (bytesAscii(bytes, 0, 4) === "RIFF" && bytesAscii(bytes, 8, 4) === "WEBP") {
    return "image/webp"
  }
  if (bytesAscii(bytes, 4, 4) === "ftyp") {
    const brand = bytesAscii(bytes, 8, 4)
    if (brand === "avif" || brand === "avis") return "image/avif"
  }
  if (bytesAscii(bytes, 0, 5) === "%PDF-") return "application/pdf"
  if (startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04])) return "application/zip"

  const head = bytesAscii(bytes, 0, 256)
    .replace(/^\uFEFF/, "")
    .trimStart()
    .toLowerCase()
  if (
    head.startsWith("<svg") ||
    head.startsWith("<?xml") ||
    head.startsWith("<!doctype html") ||
    head.startsWith("<html") ||
    head.startsWith("<script") ||
    head.startsWith("<iframe")
  ) {
    // Active content: XML/SVG/HTML can run script when a browser renders it.
    return "text/html"
  }
  return undefined
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

/**
 * Server-authoritative MIME type for an upload.
 *
 * 1. Active content (SVG/HTML/XML) is rejected outright.
 * 2. A recognized raster/PDF/ZIP signature wins over the declared type.
 * 3. Otherwise the declared type or file extension is used, but only when it
 *    is on the allowlist. Anything else is stored and served as
 *    `application/octet-stream`, always as a download with `nosniff`.
 */
export function resolveUploadMimeType(
  bytes: Uint8Array,
  declaredMimeType: string | null | undefined,
  fileName: string,
): string {
  const sniffed = sniffMimeType(bytes)
  if (sniffed === "text/html") {
    throw new AppError(
      "VALIDATION_ERROR",
      "SVG, HTML, and XML files are not supported. Upload an image, PDF, or document instead.",
    )
  }
  if (sniffed && isRasterImageMimeType(sniffed)) return sniffed
  if (sniffed === "application/pdf") return "application/pdf"
  if (sniffed === "application/zip") {
    const byName = mimeFromExtension(fileName)
    if (byName && ALLOWED_MIME_TYPES[byName] === true) return byName
    return "application/zip"
  }

  const declared = normalizeMimeType(declaredMimeType)
  if (declared && ALLOWED_MIME_TYPES[declared] === true) return declared
  const byExtension = mimeFromExtension(fileName)
  if (byExtension && ALLOWED_MIME_TYPES[byExtension] === true) return byExtension
  return "application/octet-stream"
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
  // Opportunistic cleanup so abandoned sessions do not keep their bytes.
  await purgeExpiredUploadSessions(db, orgId).catch(() => undefined)
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
  await purgeExpiredUploadSessions(db, form.orgId).catch(() => undefined)
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
    throw new HttpStatusError(
      "UPLOAD_SESSION_CONSUMED",
      "This upload session was already used. Start a new upload.",
      409,
    )
  }
  if (session.expiresAt.getTime() < Date.now()) {
    await discardSessionBytes(db, [session.id]).catch(() => undefined)
    throw new HttpStatusError(
      "UPLOAD_SESSION_EXPIRED",
      "This upload session expired. Start a new upload.",
      409,
    )
  }
  return session
}

/**
 * Storage keys a session wrote before finalize. Chunks are keyed by
 * `<sessionId>/<random><ext>` until finalize promotes them. The range
 * predicates let the `(attachment_id, seq)` primary key answer the lookup; the
 * exact `left(...)` comparison is what actually authorizes the match, because
 * `LIKE` would treat the `_` in `ups_…` as a wildcard.
 */
async function sessionStorageIds(db: AppDb, sessionId: string): Promise<string[]> {
  const prefix = `${sessionId}/`
  // `/` sorts before `0` in both C and ICU collations, so this upper bound
  // covers every key in the session without reaching the next session id.
  const upperBound = `${sessionId}0`
  const rows = await db
    .selectDistinct({ id: attachmentChunksTable.attachmentId })
    .from(attachmentChunksTable)
    .where(
      and(
        sql`${attachmentChunksTable.attachmentId} >= ${prefix}`,
        sql`${attachmentChunksTable.attachmentId} < ${upperBound}`,
        sql`left(${attachmentChunksTable.attachmentId}, ${prefix.length}) = ${prefix}`,
      ),
    )
  return rows.map((row) => row.id)
}

/** Drops the bytes a session wrote. Used on failure, expiry, and finalize errors. */
async function discardSessionBytes(
  db: AppDb,
  sessionIds: readonly string[],
): Promise<void> {
  if (!sessionIds.length) return
  const storage = await createAttachmentStorage(db)
  for (const sessionId of sessionIds) {
    for (const storageId of await sessionStorageIds(db, sessionId)) {
      await storage.remove(storageId).catch(() => undefined)
    }
  }
}

/**
 * Deletes expired upload sessions and the bytes they left behind. Called
 * opportunistically when a session is created so abandoned uploads cannot
 * accumulate in storage without a scheduled job.
 */
export async function purgeExpiredUploadSessions(
  db: AppDb,
  orgId?: string,
): Promise<number> {
  const expired = await db
    .select({ id: uploadSessions.id })
    .from(uploadSessions)
    .where(
      and(
        orgId ? eq(uploadSessions.orgId, orgId) : undefined,
        lt(uploadSessions.expiresAt, new Date()),
      ),
    )
  if (!expired.length) return 0
  const ids = expired.map((row) => row.id)
  await discardSessionBytes(db, ids)
  await db.delete(uploadSessions).where(inArray(uploadSessions.id, ids))
  return ids.length
}

function tooLargeError(actualBytes?: number): AppError {
  return new AppError(
    "VALIDATION_ERROR",
    `Files must be ${(MAX_FILE_BYTES / (1024 * 1024)).toLocaleString()}MB or smaller.`,
    { maxBytes: MAX_FILE_BYTES, ...(actualBytes ? { actualBytes } : {}) },
  )
}

/** Room for multipart boundaries and headers on top of the file itself. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024

function declaredContentLength(request: Request): number | undefined {
  const raw = request.headers.get("content-length")
  if (!raw) return undefined
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : undefined
}

/** Reads the body while counting bytes, cancelling the stream past `limit`. */
async function readBodyWithinLimit(
  request: Request,
  limit: number,
): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array(0)
  const reader = request.body.getReader()
  const parts: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > limit) {
        await reader.cancel().catch(() => undefined)
        throw tooLargeError(total)
      }
      parts.push(value)
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // The stream was already released by cancel().
    }
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.byteLength
  }
  return bytes
}

async function readUploadBody(request: Request): Promise<{
  bytes: Uint8Array
  mimeType: string
  name: string
}> {
  const contentType = request.headers.get("content-type") ?? ""
  const url = new URL(request.url)
  const length = declaredContentLength(request)
  const multipart = contentType.toLowerCase().includes("multipart/form-data")

  // Reject an oversized body before reading a single byte.
  if (
    length !== undefined &&
    length > MAX_FILE_BYTES + (multipart ? MULTIPART_OVERHEAD_BYTES : 0)
  ) {
    throw tooLargeError(length)
  }

  if (multipart) {
    // `formData()` buffers the whole body, so a chunked multipart upload is
    // refused rather than risking unbounded memory.
    if (length === undefined) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Multipart uploads must declare a Content-Length header.",
      )
    }
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
    if (file.size > MAX_FILE_BYTES) throw tooLargeError(file.size)
    return {
      bytes: new Uint8Array(await file.arrayBuffer()),
      mimeType: normalizeMimeType(file.type) ?? "application/octet-stream",
      name: file.name || url.searchParams.get("name") || "upload",
    }
  }

  const bytes = await readBodyWithinLimit(request, MAX_FILE_BYTES)
  return {
    bytes,
    mimeType: normalizeMimeType(contentType) ?? "application/octet-stream",
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
  // Single-use session: a successful write leaves chunks under the session id,
  // and the session row itself is only consumed at finalize. Refusing here
  // keeps a retry after a *failed* write possible without a schema change.
  if ((await sessionStorageIds(db, session.id)).length > 0) {
    throw new HttpStatusError(
      "UPLOAD_SESSION_CONSUMED",
      "This upload session already received a file. Start a new upload.",
      409,
    )
  }

  const { bytes, mimeType: declaredMime, name } = await readUploadBody(request)

  if (bytes.byteLength === 0) {
    throw new AppError("VALIDATION_ERROR", "Uploaded file is empty.", {
      maxBytes: MAX_FILE_BYTES,
    })
  }
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw tooLargeError(bytes.byteLength)
  }

  const mimeType = resolveUploadMimeType(bytes, declaredMime, name)
  const fieldKind = await attachmentKindForField(
    db,
    session.orgId,
    session.tableId,
    session.fieldId,
  )
  const requestedKind = new URL(request.url).searchParams.get("attachmentKind")
  const kind: AttachmentKind =
    fieldKind === "image" || requestedKind === "image" ? "image" : "any"

  if (kind === "image" && !isRasterImageMimeType(mimeType)) {
    throw new AppError("VALIDATION_ERROR", SAFE_IMAGE_MESSAGE, { mimeType })
  }

  const storageId = `${session.id}/${nanoid(16)}${extensionFor(name, mimeType)}`
  const storage = await createAttachmentStorage(db)
  try {
    await storage.putChunks(
      storageId,
      session.orgId,
      byteParts(bytes),
      bytes.byteLength,
    )
  } catch (error) {
    // A partial write must not linger under the session key.
    await storage.remove(storageId).catch(() => undefined)
    throw error
  }

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
  try {
    return await persistFinalizedUpload(db, session, userId, input)
  } catch (error) {
    // The session is unusable after a failed finalize, so drop its bytes.
    await discardSessionBytes(db, [session.id]).catch(() => undefined)
    throw error
  }
}

async function persistFinalizedUpload(
  db: AppDb,
  session: typeof uploadSessions.$inferSelect,
  userId: string | null,
  input: { uploadSessionId: string; storageId: string; name?: string; mimeType?: string },
): Promise<{ ok: true; attachment: ResolvedAttachment }> {
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
  // Re-sniff on finalize: the client-supplied name and type are hints only, so
  // a row can never be stored as SVG/HTML even if finalize is called directly.
  const leading = await readLeadingChunkBytes(db, input.storageId)
  const mimeType = resolveUploadMimeType(
    leading,
    normalizeMimeType(input.mimeType) ?? mimeFromExtension(name),
    name,
  )
  const fieldKind = await attachmentKindForField(
    db,
    session.orgId,
    session.tableId,
    session.fieldId,
  )
  if (fieldKind === "image" && !isRasterImageMimeType(mimeType)) {
    throw new AppError("VALIDATION_ERROR", SAFE_IMAGE_MESSAGE, { mimeType })
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

/** Leading bytes of an uploaded file, used to re-derive its type at finalize. */
async function readLeadingChunkBytes(
  db: AppDb,
  storageId: string,
): Promise<Uint8Array> {
  const [row] = await db
    .select({ bytes: attachmentChunksTable.bytes })
    .from(attachmentChunksTable)
    .where(
      and(
        eq(attachmentChunksTable.attachmentId, storageId),
        eq(attachmentChunksTable.seq, 0),
      ),
    )
    .limit(1)
  if (!row) return new Uint8Array(0)
  const bytes =
    row.bytes instanceof Uint8Array
      ? row.bytes
      : new Uint8Array(row.bytes as ArrayBuffer)
  return bytes.subarray(0, Math.min(bytes.byteLength, 512))
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
  if (viewerOrgId === row.orgId) return { row }

  // A signed-in identity never inherits the anonymous grant: only
  // organization members and truly anonymous respondents may read at all.
  if (viewerOrgId !== undefined) {
    throw new AppError("NOT_FOUND", "Attachment not found.")
  }

  // Anonymous reads are limited to files an anonymous respondent uploaded
  // through a currently published form that still asks for that exact column.
  if (row.createdBy !== PUBLIC_UPLOAD_CREATED_BY || !row.fieldId) {
    throw new AppError("NOT_FOUND", "Attachment not found.")
  }

  const publishedVersions = await db
    .select({ versionId: formVersions.id })
    .from(formsTable)
    .innerJoin(
      formVersions,
      and(
        eq(formVersions.id, formsTable.publishedVersionId),
        eq(formVersions.orgId, formsTable.orgId),
      ),
    )
    .where(
      and(
        eq(formsTable.orgId, row.orgId),
        eq(formsTable.tableId, row.tableId),
        eq(formsTable.status, "published"),
      ),
    )
  if (!publishedVersions.length) {
    throw new AppError("NOT_FOUND", "Attachment not found.")
  }

  const [publishedField] = await db
    .select({ id: formVersionFields.id })
    .from(formVersionFields)
    .where(
      and(
        eq(formVersionFields.orgId, row.orgId),
        inArray(
          formVersionFields.formVersionId,
          publishedVersions.map((version) => version.versionId),
        ),
        eq(formVersionFields.targetFieldId, row.fieldId),
      ),
    )
    .limit(1)
  if (!publishedField) {
    throw new AppError("NOT_FOUND", "Attachment not found.")
  }

  return { row }
}
