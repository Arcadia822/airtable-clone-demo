import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"

import { bases, fieldSequences, fields, forms, records, tables, views } from "../../../drizzle/schema"
import { getDb, resetDbForTests } from "@/db/client"
import { ensureSeededBase } from "@/db/seed"
import { validateCellValue, validateFieldConfiguration } from "@/lib/cell-validation"
import { AppError, type FieldDefinition } from "@/lib/domain"
import { buildRecordSearchText } from "@/server/search-text"
import { sanitizeReturnTo } from "@/server/auth"
import { GET as loginGET } from "@/app/api/auth/login/route"
import { GET as sessionGET } from "@/app/api/auth/session/route"

describe("Factory foundation", () => {
  beforeEach(async () => {
    process.env.DATABASE_URL = "pglite:memory"
    delete process.env.FACTORY_VISITOR_AUTH_URL
    delete process.env.FACTORY_VISITOR_AUTH_TOKEN
    delete process.env.FACTORY_PREVIEW_HOST
    await resetDbForTests()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await resetDbForTests()
  })

  it("migrates PGlite and runs ensureSeededBase idempotently", async () => {
    const db = await getDb()
    const first = await ensureSeededBase(db, "org_test", "user_test")
    expect(first.seeded).toBe(true)
    expect(first.baseId).toMatch(/^base_/)
    expect(first.tableId).toMatch(/^tbl_/)

    const second = await ensureSeededBase(db, "org_test", "user_test")
    expect(second.seeded).toBe(false)
    expect(second.baseId).toBe(first.baseId)

    const baseRows = await db.select().from(bases).where(eq(bases.orgId, "org_test"))
    const tableRows = await db.select().from(tables).where(eq(tables.orgId, "org_test"))
    const fieldRows = await db.select().from(fields).where(eq(fields.tableId, first.tableId))
    const recordRows = await db.select().from(records).where(eq(records.tableId, first.tableId))
    const viewRows = await db.select().from(views).where(eq(views.tableId, first.tableId))
    const seqRows = await db.select().from(fieldSequences).where(eq(fieldSequences.tableId, first.tableId))
    const formRows = await db.select().from(forms).where(eq(forms.baseId, first.baseId))

    expect(baseRows).toHaveLength(1)
    expect(tableRows).toHaveLength(1)
    expect(fieldRows.length).toBeGreaterThanOrEqual(9)
    expect(recordRows).toHaveLength(6)
    expect(viewRows).toHaveLength(5)
    expect(seqRows).toHaveLength(1)
    expect(seqRows[0].nextValue).toBe(7)
    expect(formRows).toHaveLength(1)
    expect(recordRows[0].searchText.length).toBeGreaterThan(0)
  })

  it("validates autoNumber as read-only and image as max 1 image attachment", () => {
    const autoField = {
      id: "fld_auto",
      name: "ID",
      type: "autoNumber" as const,
      config: {},
    }
    expect(() => validateCellValue(autoField, 10)).toThrow(AppError)
    expect(validateCellValue(autoField, 10, { allowReadOnly: true })).toBe(10)

    const imgConfig = validateFieldConfiguration("image", {})
    expect(imgConfig.attachmentKind).toBe("image")

    const imgField = {
      id: "fld_img",
      name: "Cover",
      type: "image" as const,
      config: imgConfig,
    }
    const validImg = {
      attachmentId: "att_1",
      name: "hero.png",
      mimeType: "image/png",
      size: 1024,
    }
    expect(validateCellValue(imgField, [validImg])).toEqual([validImg])

    // Rejects > 1 image
    expect(() =>
      validateCellValue(imgField, [validImg, { ...validImg, attachmentId: "att_2" }]),
    ).toThrow(AppError)

    // Rejects non-image mimeType
    expect(() =>
      validateCellValue(imgField, [
        { attachmentId: "att_pdf", name: "spec.pdf", mimeType: "application/pdf", size: 500 },
      ]),
    ).toThrow(AppError)
  })

  it("builds normalized searchText across Chinese text, currency, and select labels", () => {
    const testFields: Pick<FieldDefinition, "id" | "type" | "config">[] = [
      { id: "f1", type: "singleLineText", config: {} },
      {
        id: "f2",
        type: "singleSelect",
        config: { options: [{ id: "opt_1", label: "高优先级", color: "#ef4444" }] },
      },
      { id: "f3", type: "currency", config: { currency: "USD", precision: 0 } },
    ]
    const text = buildRecordSearchText(
      { f1: "季度发布计划", f2: "opt_1", f3: 48000 },
      testFields,
    )
    expect(text).toContain("季度发布计划")
    expect(text).toContain("高优先级")
    expect(text).toContain("48000")
    expect(text).toContain("$48,000")
  })

  it("sanitizes returnTo paths strictly", () => {
    expect(sanitizeReturnTo("/bases/123?view=kanban")).toBe("/bases/123?view=kanban")
    expect(sanitizeReturnTo("https://evil.com")).toBe("/")
    expect(sanitizeReturnTo("//evil.com/path")).toBe("/")
    expect(sanitizeReturnTo("/foo\\bar")).toBe("/")
    expect(sanitizeReturnTo("/foo\nbar")).toBe("/")
    expect(sanitizeReturnTo(null)).toBe("/")
  })

  it("proxies Factory visitor auth and detects origin-denied cleanly", async () => {
    process.env.FACTORY_VISITOR_AUTH_URL = "https://auth.factory.internal"
    process.env.FACTORY_VISITOR_AUTH_TOKEN = "secret-token"

    const fetchMock = vi.spyOn(globalThis, "fetch")

    // 1. origin-denied on login
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "origin-denied" }), { status: 403 }),
    )
    const loginRes = await loginGET(new Request("http://localhost:3000/api/auth/login?returnTo=/bases"))
    expect(loginRes.status).toBe(403)
    const loginJson = await loginRes.json()
    expect(loginJson.originDenied).toBe(true)

    // 2. authenticated session
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          visitor: {
            userId: "vis_42",
            email: "alice@example.com",
            name: "Alice",
            orgId: "org_42",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    const sessionRes = await sessionGET(
      new Request("http://localhost:3000/api/auth/session", {
        headers: { cookie: "visitor_session=abc" },
      }),
    )
    expect(sessionRes.status).toBe(200)
    const sessionJson = await sessionRes.json()
    expect(sessionJson.authMode).toBe("factory")
    expect(sessionJson.visitor.userId).toBe("vis_42")
  })
})
