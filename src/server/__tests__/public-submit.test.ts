import { desc, eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { fields, formSubmissions, records } from "../../../drizzle/schema"
import { getDb, resetDbForTests } from "@/db/client"
import { ensureSeededBase } from "@/db/seed"
import { POST as submitPOST } from "@/app/api/public/forms/[slug]/submit/route"
import { createForm, publishForm, updateForm } from "@/server/services/forms"
import { resetRateLimitsForTests } from "@/server/http"

const ORG_ID = "local-org"
const USER_ID = "local-user"

/** A public submission as the transport receives it from one visitor. */
function submissionRequest(
  slug: string,
  answers: Record<string, unknown>,
  client: { ip: string; userAgent: string; idempotencyKey?: string },
): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": client.ip,
    "user-agent": client.userAgent,
  }
  if (client.idempotencyKey) headers["idempotency-key"] = client.idempotencyKey
  return new Request(`http://localhost:3000/api/public/forms/${slug}/submit`, {
    method: "POST",
    headers,
    body: JSON.stringify({ answers }),
  })
}

/** Binds the route handler to the dynamic params a real request would carry. */
function submit(slug: string, request: Request) {
  return submitPOST(request, { params: Promise.resolve({ slug }) })
}

async function seedWorkspace() {
  const db = await getDb()
  const seeded = await ensureSeededBase(db, ORG_ID, USER_ID)
  const fieldRows = await db
    .select()
    .from(fields)
    .where(eq(fields.tableId, seeded.tableId))
  const byName = (name: string) => {
    const row = fieldRows.find((field) => field.name === name)
    if (!row) throw new Error(`Missing seeded field: ${name}`)
    return row
  }
  return { db, ...seeded, byName }
}

async function publishedSingleResponseForm(titleFieldId: string) {
  const { db, baseId, tableId } = await seedWorkspace()
  const created = await createForm(db, ORG_ID, USER_ID, {
    baseId,
    description: "",
    name: "One Per Person",
    selectedFieldIds: [titleFieldId],
    tableId,
  })
  await updateForm(db, ORG_ID, created.form.id, {
    settings: { allowMultipleSubmissions: false },
  })
  await publishForm(db, ORG_ID, USER_ID, created.form.id)
  return created.form
}

describe("Public form submit route", () => {
  beforeEach(async () => {
    process.env.DATABASE_URL = "pglite:memory"
    delete process.env.FACTORY_VISITOR_AUTH_URL
    delete process.env.FACTORY_VISITOR_AUTH_TOKEN
    delete process.env.FACTORY_PREVIEW_HOST
    delete process.env.TURNSTILE_SECRET_KEY
    resetRateLimitsForTests()
    await resetDbForTests()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await resetDbForTests()
  })

  it("accepts one response per visitor and rejects that visitor's second", async () => {
    const { db, byName } = await seedWorkspace()
    const title = byName("Project Name")
    const form = await publishedSingleResponseForm(title.id)

    const alice = { ip: "203.0.113.10", userAgent: "alice-browser" }
    const bob = { ip: "198.51.100.20", userAgent: "bob-browser" }

    const first = await submit(
      form.slug,
      submissionRequest(form.slug, { [title.id]: "Alice's project" }, alice),
    )
    expect(first.status).toBe(201)

    const second = await submit(
      form.slug,
      submissionRequest(form.slug, { [title.id]: "Bob's project" }, bob),
    )
    expect(second.status).toBe(201)

    const duplicate = await submit(
      form.slug,
      submissionRequest(form.slug, { [title.id]: "Alice again" }, alice),
    )
    expect(duplicate.status).toBe(409)
    await expect(duplicate.json()).resolves.toMatchObject({
      code: "DUPLICATE_SUBMISSION",
    })

    const stored = await db
      .select()
      .from(formSubmissions)
      .where(eq(formSubmissions.formId, form.id))
      .orderBy(desc(formSubmissions.submittedAt))
    expect(stored).toHaveLength(2)

    const created = await db
      .select()
      .from(records)
      .where(eq(records.tableId, form.tableId))
    const fromPublic = created.filter((row) => row.createdBy === "public-form")
    expect(fromPublic.map((row) => row.values[title.id]).sort()).toEqual([
      "Alice's project",
      "Bob's project",
    ])
  })

  it("treats a retried Idempotency-Key as the same submission", async () => {
    const { db, byName } = await seedWorkspace()
    const title = byName("Project Name")
    const form = await publishedSingleResponseForm(title.id)
    const client = {
      ip: "203.0.113.30",
      userAgent: "retry-browser",
      idempotencyKey: "route-retry-1",
    }

    const first = await submit(
      form.slug,
      submissionRequest(form.slug, { [title.id]: "Retried" }, client),
    )
    expect(first.status).toBe(201)
    const firstBody = (await first.json()) as { submissionId: string }

    const retry = await submit(
      form.slug,
      submissionRequest(form.slug, { [title.id]: "Retried" }, client),
    )
    expect(retry.status).toBe(201)
    await expect(retry.json()).resolves.toMatchObject({
      submissionId: firstBody.submissionId,
    })

    const stored = await db
      .select()
      .from(formSubmissions)
      .where(eq(formSubmissions.formId, form.id))
    expect(stored).toHaveLength(1)
  })
})
