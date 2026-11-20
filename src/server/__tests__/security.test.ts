import { and, eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  attachmentChunks as attachmentChunksTable,
  fields as fieldsTable,
  formMetricBuckets,
  forms as formsTable,
  formVersionFields as formVersionFieldsTable,
  formVersions as formVersionsTable,
  uploadSessions,
} from "../../../drizzle/schema"
import { GET as fileGET } from "@/app/api/files/[attachmentId]/route"
import { POST as publicMetricPOST } from "@/app/api/public/forms/[slug]/metric/route"
import { POST as publicSubmitPOST } from "@/app/api/public/forms/[slug]/submit/route"
import { getDb, resetDbForTests } from "@/db/client"
import { ensureSeededBase } from "@/db/seed"
import { createRecordsCsv } from "@/lib/csv-export"
import type { FieldDefinition, GridRecord } from "@/lib/domain"
import {
  assertTrustedAuthorizeUrl,
  getServerSession,
  isAuthMisconfigured,
  isLocalWorkspaceAllowed,
  requireSession,
} from "@/server/auth"
import {
  enforceRateLimit,
  HttpStatusError,
  isSameOriginRequest,
  jsonError,
  redactSecrets,
  requireSameOrigin,
  resetRateLimitsForTests,
  verifyTurnstileToken,
} from "@/server/http"
import {
  createPublicUploadSession,
  createUploadSession,
  finalizeAttachment,
  finalizePublicAttachment,
  isInlineSafeMimeType,
  MAX_FILE_BYTES,
  resolveAttachmentDownload,
  resolveUploadMimeType,
  sniffMimeType,
  storePublicUpload,
  storeUpload,
} from "@/server/services/attachments"
import { securityHeaders } from "../../../next.config"

const ORG_ID = "local-org"
const USER_ID = "local-user"

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

function png(): Uint8Array {
  return new Uint8Array(Buffer.from(PNG_BASE64, "base64"))
}

function pdf(): Uint8Array {
  return new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n")
}

function noised(size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  for (let index = 0; index < size; index += 1) {
    bytes[index] = (index * 31 + 7) % 256
  }
  return bytes
}

function uploadRequest(
  bytes: Uint8Array,
  mimeType: string,
  name: string,
): Request {
  return new Request("http://localhost/api/attachments/upload", {
    method: "PUT",
    headers: { "content-type": mimeType, "x-file-name": name },
    body: bytes as unknown as BodyInit,
  })
}

function jsonRequest(path: string, method: string, body?: unknown): Request {
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function slugContext(slug: string) {
  return { params: Promise.resolve({ slug }) }
}

function fileContext(attachmentId: string) {
  return { params: Promise.resolve({ attachmentId }) }
}

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

async function publishForm(options: {
  baseId: string
  tableId: string
  fieldId?: string
  fieldType?: string
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
  if (options.fieldId) {
    await db.insert(formVersionFieldsTable).values({
      id: `fvf_${options.slug}`,
      orgId: ORG_ID,
      formVersionId: versionId,
      targetFieldId: options.fieldId,
      targetFieldType: options.fieldType ?? "attachment",
      label: options.slug,
      rank: "a0",
      fieldConfig: {},
    })
  }
  return { formId, versionId }
}

beforeEach(async () => {
  process.env.DATABASE_URL = "pglite:memory"
  delete process.env.ATTACHMENT_STORAGE
  vi.stubEnv("FACTORY_VISITOR_AUTH_URL", "")
  vi.stubEnv("FACTORY_VISITOR_AUTH_TOKEN", "")
  vi.stubEnv("ALLOW_LOCAL_WORKSPACE", "")
  vi.stubEnv("VERCEL_ENV", "")
  vi.stubEnv("TURNSTILE_SECRET_KEY", "")
  resetRateLimitsForTests()
  await resetDbForTests()
})

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  resetRateLimitsForTests()
  await resetDbForTests()
})

describe("authentication fails closed", () => {
  it("refuses a local session on a deployment without credentials", async () => {
    vi.stubEnv("NODE_ENV", "production")
    expect(isAuthMisconfigured()).toBe(true)
    expect(isLocalWorkspaceAllowed()).toBe(false)

    await expect(
      requireSession(new Request("http://localhost:3000/api/attachments")),
    ).rejects.toMatchObject({ code: "AUTH_NOT_CONFIGURED", status: 503 })

    const session = await getServerSession(
      new Request("http://localhost:3000/api/attachments"),
    )
    expect(session.authenticated).toBe(false)
  })

  it("maps AUTH_NOT_CONFIGURED to 503 through the error envelope", async () => {
    vi.stubEnv("NODE_ENV", "production")
    const error = await requireSession(
      new Request("http://localhost:3000/api/attachments"),
    ).catch((cause: unknown) => cause)

    const response = jsonError(error)
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      code: "AUTH_NOT_CONFIGURED",
      message: "Authentication is not configured for this deployment.",
    })
  })

  it("keeps the local workspace when it is explicitly allowed", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("ALLOW_LOCAL_WORKSPACE", "1")

    expect(isAuthMisconfigured()).toBe(false)
    const session = await requireSession(
      new Request("http://localhost:3000/api/attachments"),
    )
    expect(session).toMatchObject({ authMode: "local", orgId: ORG_ID })
  })

  it("keeps the local workspace outside production", async () => {
    vi.stubEnv("NODE_ENV", "test")
    expect(isLocalWorkspaceAllowed()).toBe(true)
    const session = await getServerSession()
    expect(session).toMatchObject({ authenticated: true, authMode: "local" })
  })
})

describe("error envelope", () => {
  it("never returns internal error text to the client", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const response = jsonError(
      new Error("connect ECONNREFUSED postgres://user:hunter2@db/app"),
    )

    expect(response.status).toBe(500)
    const body = (await response.json()) as {
      code: string
      message: string
      errorId: string
    }
    expect(body).toMatchObject({
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    })
    expect(body.errorId).toEqual(expect.any(String))
    expect(JSON.stringify(body)).not.toContain("hunter2")
    expect(JSON.stringify(body)).not.toContain("ECONNREFUSED")

    expect(logged).toHaveBeenCalled()
    const line = logged.mock.calls.map((call) => String(call[0])).join("\n")
    expect(line).toContain(body.errorId)
    expect(line).not.toContain("hunter2")
  })

  it("keeps handled validation errors readable", async () => {
    const response = jsonError(new HttpStatusError("RATE_LIMITED", "Slow down.", 429))
    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({ code: "RATE_LIMITED" })
  })

  it("redacts credentials before logging", () => {
    expect(redactSecrets("postgres://user:hunter2@db:5432/app")).toBe(
      "postgres://***:***@db:5432/app",
    )
    expect(redactSecrets("Authorization: Bearer abcdefghijklmnop")).not.toContain(
      "abcdefghijklmnop",
    )
  })
})

describe("CSRF origin guard", () => {
  it("rejects a foreign Origin and accepts the app origin", () => {
    const crossSite = new Request("http://localhost:3000/api/attachments/x", {
      method: "DELETE",
      headers: { origin: "https://evil.test" },
    })
    expect(isSameOriginRequest(crossSite)).toBe(false)
    expect(() => requireSameOrigin(crossSite)).toThrowError()

    const sameOrigin = new Request("http://localhost:3000/api/attachments/x", {
      method: "DELETE",
      headers: { origin: "http://localhost:3000" },
    })
    expect(isSameOriginRequest(sameOrigin)).toBe(true)
    expect(() => requireSameOrigin(sameOrigin)).not.toThrow()
  })

  it("rejects cross-site fetch metadata even without an Origin header", () => {
    const request = new Request("http://localhost:3000/api/attachments/x", {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site" },
    })
    expect(isSameOriginRequest(request)).toBe(false)
  })

  it("accepts non-browser clients that send neither header", () => {
    const request = new Request("http://localhost:3000/api/attachments/x", {
      method: "POST",
    })
    expect(isSameOriginRequest(request)).toBe(true)
  })
})

describe("authorize redirect host", () => {
  const authUrl = "https://auth.factory.test"

  it("accepts the configured auth host", () => {
    expect(
      assertTrustedAuthorizeUrl("https://auth.factory.test/authorize?state=1", authUrl),
    ).toBe("https://auth.factory.test/authorize?state=1")
  })

  it("rejects a different host, a non-https scheme, and script URLs", () => {
    expect(() =>
      assertTrustedAuthorizeUrl("https://evil.test/authorize", authUrl),
    ).toThrowError(/untrusted/)
    expect(() =>
      assertTrustedAuthorizeUrl("http://auth.factory.test/authorize", authUrl),
    ).toThrowError(/untrusted/)
    expect(() =>
      assertTrustedAuthorizeUrl("javascript:alert(1)", authUrl),
    ).toThrowError(/untrusted/)
  })
})

describe("rate limiting", () => {
  it("allows the budget and then answers 429 with Retry-After", () => {
    enforceRateLimit({ key: "submit:1.2.3.4:demo", limit: 2, windowMs: 60_000 })
    enforceRateLimit({ key: "submit:1.2.3.4:demo", limit: 2, windowMs: 60_000 })

    const error = (() => {
      try {
        enforceRateLimit({ key: "submit:1.2.3.4:demo", limit: 2, windowMs: 60_000 })
      } catch (cause) {
        return cause
      }
      return undefined
    })()

    expect(error).toBeInstanceOf(HttpStatusError)
    expect(error).toMatchObject({ code: "RATE_LIMITED", status: 429 })
    const response = jsonError(error)
    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBeTruthy()
  })

  it("limits public submissions per IP and form before touching the database", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await publicSubmitPOST(
        jsonRequest("/api/public/forms/missing/limit", "POST", { answers: {} }),
        slugContext("missing-limit"),
      )
      expect(response.status).toBe(404)
    }

    const limited = await publicSubmitPOST(
      jsonRequest("/api/public/forms/missing/limit", "POST", { answers: {} }),
      slugContext("missing-limit"),
    )
    expect(limited.status).toBe(429)
    expect(await limited.json()).toMatchObject({ code: "RATE_LIMITED" })
  })
})

describe("Turnstile", () => {
  it("is a no-op without a secret and rejects a missing token with one", async () => {
    const request = new Request("http://localhost:3000/api/public/forms/x/submit")
    await expect(verifyTurnstileToken(request, undefined)).resolves.toBeUndefined()

    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret")
    await expect(verifyTurnstileToken(request, undefined)).rejects.toMatchObject({
      code: "TURNSTILE_INVALID",
      status: 403,
    })
  })

  it("verifies server-side and reports provider failures honestly", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret")
    const request = new Request("http://localhost:3000/api/public/forms/x/submit")

    const accepted = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      )
    await expect(verifyTurnstileToken(request, "token")).resolves.toBeUndefined()
    const acceptedBody = accepted.mock.calls[0]?.[1]?.body as URLSearchParams
    expect(acceptedBody.get("secret")).toBe("secret")
    expect(acceptedBody.get("response")).toBe("token")
    accepted.mockRestore()

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: false }), { status: 200 }),
    )
    await expect(verifyTurnstileToken(request, "token")).rejects.toMatchObject({
      code: "TURNSTILE_INVALID",
    })

    vi.restoreAllMocks()
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"))
    await expect(verifyTurnstileToken(request, "token")).rejects.toMatchObject({
      code: "TURNSTILE_UNAVAILABLE",
      status: 503,
    })
  })

  it("accepts the token from the request header", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret")
    const response = new Response(JSON.stringify({ success: true }), { status: 200 })
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response)
    const request = new Request("http://localhost:3000/api/public/forms/x/submit", {
      method: "POST",
      headers: { "cf-turnstile-response": "from-header" },
    })
    await expect(verifyTurnstileToken(request, "from-header")).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

describe("upload content types", () => {
  it("trusts magic bytes over the declared type", () => {
    expect(sniffMimeType(png())).toBe("image/png")
    expect(sniffMimeType(pdf())).toBe("application/pdf")
    expect(resolveUploadMimeType(png(), "text/plain", "photo.txt")).toBe("image/png")
    expect(resolveUploadMimeType(pdf(), "application/octet-stream", "doc")).toBe(
      "application/pdf",
    )
  })

  it("rejects SVG and HTML content outright", () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    )
    expect(sniffMimeType(svg)).toBe("text/html")
    expect(() => resolveUploadMimeType(svg, "image/svg+xml", "logo.svg")).toThrowError(
      /SVG, HTML, and XML files are not supported/,
    )
    expect(() =>
      resolveUploadMimeType(new TextEncoder().encode("<!doctype html><p>x"), "text/html", "x.html"),
    ).toThrowError()
  })

  it("downgrades unknown types to opaque downloads", () => {
    const bytes = noised(64)
    expect(resolveUploadMimeType(bytes, "image/svg+xml", "drawing.svg")).toBe(
      "application/octet-stream",
    )
    expect(resolveUploadMimeType(bytes, "text/html", "page.html")).toBe(
      "application/octet-stream",
    )
    expect(resolveUploadMimeType(bytes, "application/x-msdownload", "tool.exe")).toBe(
      "application/octet-stream",
    )
  })

  it("only treats raster images as inline-safe", () => {
    expect(isInlineSafeMimeType("image/png")).toBe(true)
    expect(isInlineSafeMimeType("image/jpeg")).toBe(true)
    expect(isInlineSafeMimeType("image/svg+xml")).toBe(false)
    expect(isInlineSafeMimeType("application/pdf")).toBe(false)
    expect(isInlineSafeMimeType("text/html")).toBe(false)
  })
})

describe("upload abuse controls", () => {
  it("rejects an oversized body before reading and while streaming", async () => {
    const { db, tableId, field } = await seededField("Brief & Specs")
    const session = await createUploadSession(db, ORG_ID, USER_ID, {
      tableId,
      fieldId: field.id,
    })

    const declaredTooLarge = new Request(
      `http://localhost/api/attachments/upload/${session.uploadSessionId}`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/pdf",
          "content-length": String(MAX_FILE_BYTES + 1),
        },
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(8))
            controller.close()
          },
        }),
        duplex: "half",
      } as RequestInit,
    )
    await expect(
      storeUpload(db, ORG_ID, session.uploadSessionId, declaredTooLarge),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" })

    const chunkedTooLarge = new Request(
      `http://localhost/api/attachments/upload/${session.uploadSessionId}`,
      {
        method: "PUT",
        headers: { "content-type": "application/pdf", "x-file-name": "huge.pdf" },
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(MAX_FILE_BYTES))
            controller.enqueue(new Uint8Array(1024))
            controller.close()
          },
        }),
        duplex: "half",
      } as RequestInit,
    )
    await expect(
      storeUpload(db, ORG_ID, session.uploadSessionId, chunkedTooLarge),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" })

    expect(await db.select().from(attachmentChunksTable)).toHaveLength(0)
  }, 60_000)

  it("is single-use, retries after a failed write, and cleans up on expiry", async () => {
    const { db, tableId, field } = await seededField("Cover Image")
    const session = await createUploadSession(db, ORG_ID, USER_ID, {
      tableId,
      fieldId: field.id,
    })

    // A rejected write leaves nothing behind, so the session stays usable.
    await expect(
      storeUpload(
        db,
        ORG_ID,
        session.uploadSessionId,
        uploadRequest(noised(128), "text/plain", "notes.txt"),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" })
    expect(await db.select().from(attachmentChunksTable)).toHaveLength(0)

    const stored = await storeUpload(
      db,
      ORG_ID,
      session.uploadSessionId,
      uploadRequest(png(), "image/png", "hero.png"),
    )
    expect(stored.mimeType).toBe("image/png")

    await expect(
      storeUpload(
        db,
        ORG_ID,
        session.uploadSessionId,
        uploadRequest(png(), "image/png", "second.png"),
      ),
    ).rejects.toMatchObject({ code: "UPLOAD_SESSION_CONSUMED", status: 409 })

    const finalized = await finalizeAttachment(db, ORG_ID, USER_ID, {
      uploadSessionId: session.uploadSessionId,
      storageId: stored.storageId,
      name: "hero.png",
      mimeType: "image/png",
    })
    expect(finalized.attachment.mimeType).toBe("image/png")

    await expect(
      finalizeAttachment(db, ORG_ID, USER_ID, {
        uploadSessionId: session.uploadSessionId,
        storageId: stored.storageId,
        name: "hero.png",
        mimeType: "image/png",
      }),
    ).rejects.toMatchObject({ code: "UPLOAD_SESSION_CONSUMED", status: 409 })

    const expiring = await createUploadSession(db, ORG_ID, USER_ID, {
      tableId,
      fieldId: field.id,
    })
    await storeUpload(
      db,
      ORG_ID,
      expiring.uploadSessionId,
      uploadRequest(png(), "image/png", "stale.png"),
    )
    await db
      .update(uploadSessions)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(uploadSessions.id, expiring.uploadSessionId))

    await expect(
      storeUpload(
        db,
        ORG_ID,
        expiring.uploadSessionId,
        uploadRequest(png(), "image/png", "stale.png"),
      ),
    ).rejects.toMatchObject({ code: "UPLOAD_SESSION_EXPIRED", status: 409 })

    const leftover = await db
      .select({ id: attachmentChunksTable.attachmentId })
      .from(attachmentChunksTable)
    expect(
      leftover.every((row) => !row.id.startsWith(expiring.uploadSessionId)),
    ).toBe(true)
  }, 30_000)
})

describe("public attachment read scope", () => {
  it("hides org attachments from anonymous and foreign viewers", async () => {
    const { db, tableId, field } = await seededField("Brief & Specs")
    const session = await createUploadSession(db, ORG_ID, USER_ID, {
      tableId,
      fieldId: field.id,
    })
    const stored = await storeUpload(
      db,
      ORG_ID,
      session.uploadSessionId,
      uploadRequest(pdf(), "application/pdf", "spec.pdf"),
    )
    const finalized = await finalizeAttachment(db, ORG_ID, USER_ID, {
      uploadSessionId: session.uploadSessionId,
      storageId: stored.storageId,
      name: "spec.pdf",
      mimeType: "application/pdf",
    })
    const attachmentId = finalized.attachment.id

    await expect(resolveAttachmentDownload(db, attachmentId, ORG_ID)).resolves.toBeTruthy()
    await expect(resolveAttachmentDownload(db, attachmentId, "other-org")).rejects.toMatchObject({
      code: "NOT_FOUND",
    })
    await expect(resolveAttachmentDownload(db, attachmentId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    })

    // Non-raster bytes are never rendered inline.
    const download = await fileGET(
      jsonRequest(`/api/files/${attachmentId}`, "GET"),
      fileContext(attachmentId),
    )
    expect(download.status).toBe(200)
    expect(download.headers.get("content-type")).toBe("application/octet-stream")
    expect(download.headers.get("content-disposition")).toMatch(/^attachment;/)
    expect(download.headers.get("x-content-type-options")).toBe("nosniff")
    expect(download.headers.get("content-security-policy")).toContain("sandbox")
  }, 30_000)

  it("grants anonymous reads only through a published form that asks for the column", async () => {
    const { db, baseId, tableId, field } = await seededField("Brief & Specs")

    // A published form exists, but the anonymous upload is not bound to a
    // column, so there is nothing that scopes the read.
    await publishForm({
      baseId,
      tableId,
      fieldId: field.id,
      slug: "scope-unbound",
      status: "published",
      withVersion: true,
    })
    const unboundSession = await createPublicUploadSession(db, "scope-unbound", {})
    const unboundStored = await storePublicUpload(
      db,
      "scope-unbound",
      unboundSession.uploadSessionId,
      uploadRequest(pdf(), "application/pdf", "unbound.pdf"),
    )
    const unbound = await finalizePublicAttachment(db, "scope-unbound", {
      uploadSessionId: unboundSession.uploadSessionId,
      storageId: unboundStored.storageId,
      name: "unbound.pdf",
      mimeType: "application/pdf",
    })
    await expect(resolveAttachmentDownload(db, unbound.attachment.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    })

    // Bound to a column that the published version actually contains.
    const boundSession = await createPublicUploadSession(db, "scope-unbound", {
      fieldId: field.id,
    })
    const boundStored = await storePublicUpload(
      db,
      "scope-unbound",
      boundSession.uploadSessionId,
      uploadRequest(pdf(), "application/pdf", "bound.pdf"),
    )
    const bound = await finalizePublicAttachment(db, "scope-unbound", {
      uploadSessionId: boundSession.uploadSessionId,
      storageId: boundStored.storageId,
      name: "bound.pdf",
      mimeType: "application/pdf",
    })
    await expect(resolveAttachmentDownload(db, bound.attachment.id)).resolves.toBeTruthy()
    // A signed-in viewer from another organization does not inherit the
    // anonymous grant.
    await expect(
      resolveAttachmentDownload(db, bound.attachment.id, "other-org"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    await expect(
      resolveAttachmentDownload(db, bound.attachment.id, ORG_ID),
    ).resolves.toBeTruthy()

    // Closing the form withdraws the anonymous grant.
    await db
      .update(formsTable)
      .set({ status: "closed" })
      .where(eq(formsTable.slug, "scope-unbound"))
    await expect(resolveAttachmentDownload(db, bound.attachment.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    })
  }, 30_000)
})

describe("public metric input", () => {
  it("clamps breakdown fields to the known vocabulary", async () => {
    const { db, baseId, tableId } = await seededField("Brief & Specs")
    const { formId } = await publishForm({
      baseId,
      tableId,
      slug: "metric-clamp",
      status: "published",
      withVersion: true,
    })

    const response = await publicMetricPOST(
      jsonRequest("/api/public/forms/metric-clamp/metric", "POST", {
        metric: "start",
        breakdownKind: 'total"; drop table forms; --',
        breakdownKey: "x".repeat(400),
      }),
      slugContext("metric-clamp"),
    )
    expect(response.status).toBe(200)

    const buckets = await db
      .select()
      .from(formMetricBuckets)
      .where(eq(formMetricBuckets.formId, formId))
    expect(buckets).toHaveLength(1)
    expect(buckets[0]).toMatchObject({
      metric: "start",
      breakdownKind: "total",
      breakdownKey: "all",
      count: 1,
    })
  }, 30_000)
})

describe("security headers", () => {
  it("blocks framing, sniffing, and plugins on every route", () => {
    const headers = new Map(
      securityHeaders().map((header) => [header.key.toLowerCase(), header.value]),
    )
    expect(headers.get("x-content-type-options")).toBe("nosniff")
    expect(headers.get("x-frame-options")).toBe("DENY")
    expect(headers.get("referrer-policy")).toBe("no-referrer")
    expect(headers.get("permissions-policy")).toContain("camera=()")

    const csp = headers.get("content-security-policy") ?? ""
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("script-src 'self' 'unsafe-inline'")
    expect(csp).toContain("https://challenges.cloudflare.com")
  })
})

describe("CSV export", () => {
  it("neutralizes formula cells and headers", () => {
    const fields: FieldDefinition[] = [
      {
        id: "field_cmd",
        name: "=HYPERLINK(\"http://evil.test\")",
        type: "singleLineText",
        config: {},
        rank: "a",
        width: 200,
        isPrimary: true,
      },
    ]
    const records: GridRecord[] = [
      {
        id: "record_1",
        rank: "a",
        revision: 1,
        createdAt: 0,
        createdBy: "Maya",
        updatedAt: 0,
        updatedBy: "Maya",
        values: {
          field_cmd: "=cmd|' /C calc'!A0",
        },
      },
      {
        id: "record_2",
        rank: "b",
        revision: 1,
        createdAt: 0,
        createdBy: "Maya",
        updatedAt: 0,
        updatedBy: "Maya",
        values: { field_cmd: "-5" },
      },
      {
        id: "record_3",
        rank: "c",
        revision: 1,
        createdAt: 0,
        createdBy: "Maya",
        updatedAt: 0,
        updatedBy: "Maya",
        values: { field_cmd: "@SUM(A1)" },
      },
      {
        id: "record_4",
        rank: "d",
        revision: 1,
        createdAt: 0,
        createdBy: "Maya",
        updatedAt: 0,
        updatedBy: "Maya",
        values: { field_cmd: "+1" },
      },
    ]

    const csv = createRecordsCsv(fields, records)
    const lines = csv.split("\r\n")
    expect(lines[0]).toBe(`"'=HYPERLINK(""http://evil.test"")"`)
    expect(lines[1]).toBe("'=cmd|' /C calc'!A0")
    expect(lines[2]).toBe("'-5")
    expect(lines[3]).toBe("'@SUM(A1)")
    expect(lines[4]).toBe("'+1")
  })

  it("leaves ordinary values untouched", () => {
    const fields: FieldDefinition[] = [
      {
        id: "field_name",
        name: "Project",
        type: "singleLineText",
        config: {},
        rank: "a",
        width: 200,
        isPrimary: true,
      },
    ]
    const records: GridRecord[] = [
      {
        id: "record_1",
        rank: "a",
        revision: 1,
        createdAt: 0,
        createdBy: "Maya",
        updatedAt: 0,
        updatedBy: "Maya",
        values: { field_name: "Launch planning" },
      },
    ]
    expect(createRecordsCsv(fields, records)).toBe(
      "Project\r\nLaunch planning",
    )
  })
})
