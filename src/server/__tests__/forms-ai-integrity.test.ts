import { and, asc, eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  fields,
  fieldSequences,
  formMetricBuckets,
  formSubmissions,
  formVersionFields,
  formVersions,
  forms,
  records,
  tables,
} from "../../../drizzle/schema"
import type { AppDb } from "@/db/client"
import { getDb, resetDbForTests } from "@/db/client"
import { ensureSeededBase } from "@/db/seed"
import type { AuthenticatedSession } from "@/server/auth"
import { POST as writeToolPOST } from "@/app/api/ai/tools/write/route"
import {
  buildWriteProposal,
  executeApprovedWrite,
  issueWriteProposalToken,
  type AiToolContext,
} from "@/server/ai/tools"
import {
  createForm,
  deleteForm,
  getFormDraft,
  getPublicForm,
  listForms,
  publishForm,
  recordPublicFormMetric,
  replaceFormDraft,
  submitPublicForm,
  updateForm,
} from "@/server/services/forms"

const ORG_ID = "local-org"
const USER_ID = "local-user"

const session: AuthenticatedSession = {
  authenticated: true,
  authMode: "local",
  email: "local@factory.local",
  name: "Local Workspace",
  orgId: ORG_ID,
  userId: USER_ID,
}

function jsonRequest(path: string, body?: unknown): Request {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function workspace() {
  const db = await getDb()
  const seeded = await ensureSeededBase(db, ORG_ID, USER_ID)
  const fieldRows = await db
    .select()
    .from(fields)
    .where(eq(fields.tableId, seeded.tableId))
    .orderBy(asc(fields.rank))
  const byName = (name: string) => {
    const row = fieldRows.find((field) => field.name === name)
    if (!row) throw new Error(`Missing seeded field: ${name}`)
    return row
  }
  return { db, ...seeded, fieldRows, byName }
}

async function draftForm(
  db: AppDb,
  input: {
    baseId: string
    fieldIds: string[]
    name: string
    tableId: string
    allowMultipleSubmissions?: boolean
  },
) {
  const created = await createForm(db, ORG_ID, USER_ID, {
    baseId: input.baseId,
    description: "",
    name: input.name,
    selectedFieldIds: input.fieldIds,
    tableId: input.tableId,
  })
  if (input.allowMultipleSubmissions === false) {
    await updateForm(db, ORG_ID, created.form.id, {
      settings: { allowMultipleSubmissions: false },
    })
  }
  return created.form
}

function answersFor(
  values: Record<string, string | number | boolean>,
): { answers: Record<string, unknown> } {
  return { answers: values }
}

describe("Forms and AI write integrity", () => {
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

  it("publishes once per attempt when three publishes race", async () => {
    const { db, baseId, tableId, byName } = await workspace()
    const form = await draftForm(db, {
      baseId,
      tableId,
      name: "Race Publish",
      fieldIds: [byName("Project Name").id],
    })
    const draft = await getFormDraft(db, ORG_ID, form.id)
    expect(draft.fields.length).toBeGreaterThan(0)
    const attempts = await Promise.allSettled([
      publishForm(db, ORG_ID, USER_ID, form.id),
      publishForm(db, ORG_ID, USER_ID, form.id),
      publishForm(db, ORG_ID, USER_ID, form.id),
    ])
    const failed = attempts.filter((result) => result.status === "rejected")
    expect(failed).toEqual([])

    const versions = await db
      .select()
      .from(formVersions)
      .where(eq(formVersions.formId, form.id))
    expect(versions).toHaveLength(3)
    expect(versions.map((version) => version.versionNumber).sort()).toEqual([1, 2, 3])

    // Every version carries its own frozen question snapshot: no half-built row.
    const versionFields = await db
      .select({ formVersionId: formVersionFields.formVersionId })
      .from(formVersionFields)
      .innerJoin(
        formVersions,
        eq(formVersionFields.formVersionId, formVersions.id),
      )
      .where(eq(formVersions.formId, form.id))
    const byVersion = new Map<string, number>()
    for (const row of versionFields) {
      byVersion.set(row.formVersionId, (byVersion.get(row.formVersionId) ?? 0) + 1)
    }
    expect([...byVersion.values()]).toEqual(
      Array.from({ length: 3 }, () => draft.fields.length),
    )

    const [current] = await db.select().from(forms).where(eq(forms.id, form.id))
    const latest = versions.find((version) => version.versionNumber === 3)
    expect(current.publishedVersionId).toBe(latest?.id)
    expect(current.status).toBe("published")
  })

  it("leaves no version row behind when publishing fails validation", async () => {
    const { db, baseId, tableId, byName } = await workspace()
    const budget = byName("Budget")
    const form = await draftForm(db, {
      baseId,
      tableId,
      name: "Broken Draft",
      fieldIds: [budget.id],
    })

    await db
      .update(fields)
      .set({ status: "archived" })
      .where(eq(fields.id, budget.id))

    await expect(publishForm(db, ORG_ID, USER_ID, form.id)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    })

    expect(
      await db.select().from(formVersions).where(eq(formVersions.formId, form.id)),
    ).toHaveLength(0)
    const leftoverFields = await db
      .select({ id: formVersionFields.id })
      .from(formVersionFields)
      .innerJoin(
        formVersions,
        eq(formVersionFields.formVersionId, formVersions.id),
      )
      .where(eq(formVersions.formId, form.id))
    expect(leftoverFields).toHaveLength(0)
    const [current] = await db.select().from(forms).where(eq(forms.id, form.id))
    expect(current.publishedVersionId).toBeNull()
    expect(current.status).toBe("draft")
  })

  it("keeps the previous questions when a draft replacement is rejected", async () => {
    const { db, baseId, tableId, byName } = await workspace()
    const title = byName("Project Name")
    const budget = byName("Budget")
    const form = await draftForm(db, {
      baseId,
      tableId,
      name: "Draft Guard",
      fieldIds: [title.id, budget.id],
    })
    const before = await getFormDraft(db, ORG_ID, form.id)

    await expect(
      replaceFormDraft(db, ORG_ID, form.id, {
        fields: [
          { label: "Title", required: true, targetFieldId: title.id },
          // Second entry is invalid: the whole replace must be rejected.
          { targetFieldId: "fld_does_not_exist" },
        ],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" })

    const after = await getFormDraft(db, ORG_ID, form.id)
    expect(after.fields.map((row) => row.targetFieldId)).toEqual(
      before.fields.map((row) => row.targetFieldId),
    )
    expect(after.fields.map((row) => row.label)).toEqual(
      before.fields.map((row) => row.label),
    )
  })

  it("rejects a second response from the same person and never burns a number", async () => {
    const { db, baseId, tableId, byName } = await workspace()
    const title = byName("Project Name")
    const auto = byName("ID")
    const form = await draftForm(db, {
      baseId,
      tableId,
      name: "One Per Person",
      fieldIds: [title.id],
      allowMultipleSubmissions: false,
    })
    await publishForm(db, ORG_ID, USER_ID, form.id)

    const respondent = { ip: "203.0.113.7", userAgent: "vitest-integrity" }
    const first = await submitPublicForm(
      db,
      form.slug,
      answersFor({ [title.id]: "First response" }),
      respondent,
    )

    const [sequenceBefore] = await db
      .select()
      .from(fieldSequences)
      .where(eq(fieldSequences.fieldId, auto.id))

    await expect(
      submitPublicForm(db, form.slug, answersFor({ [title.id]: "Second response" }), respondent),
    ).rejects.toMatchObject({ code: "DUPLICATE_SUBMISSION", status: 409 })

    const [sequenceAfter] = await db
      .select()
      .from(fieldSequences)
      .where(eq(fieldSequences.fieldId, auto.id))
    expect(sequenceAfter.nextValue).toBe(sequenceBefore.nextValue)

    const stored = await db
      .select()
      .from(records)
      .where(eq(records.tableId, tableId))
    expect(stored.some((row) => row.id === first.recordId)).toBe(true)
    expect(stored.filter((row) => row.createdBy === "public-form")).toHaveLength(1)
  })

  it("returns the same submission for a retried idempotency key", async () => {
    const { db, baseId, tableId, byName } = await workspace()
    const title = byName("Project Name")
    const form = await draftForm(db, {
      baseId,
      tableId,
      name: "Retry Safe",
      fieldIds: [title.id],
    })
    await publishForm(db, ORG_ID, USER_ID, form.id)

    const first = await submitPublicForm(
      db,
      form.slug,
      { ...answersFor({ [title.id]: "Retry me" }), submissionKey: "retry-key-1" },
      { ip: "198.51.100.4", userAgent: "vitest" },
    )
    const second = await submitPublicForm(
      db,
      form.slug,
      { ...answersFor({ [title.id]: "Retry me" }), submissionKey: "retry-key-1" },
      { ip: "198.51.100.4", userAgent: "vitest" },
    )

    expect(second.submissionId).toBe(first.submissionId)
    expect(second.recordId).toBe(first.recordId)

    const submissions = await db
      .select()
      .from(formSubmissions)
      .where(eq(formSubmissions.formId, form.id))
    expect(submissions).toHaveLength(1)
    const fromForm = await db
      .select()
      .from(records)
      .where(and(eq(records.tableId, tableId), eq(records.createdBy, "public-form")))
    expect(fromForm).toHaveLength(1)
  })

  it("refuses answers for columns archived after publishing", async () => {
    const { db, baseId, tableId, byName } = await workspace()
    const title = byName("Project Name")
    const budget = byName("Budget")
    const form = await draftForm(db, {
      baseId,
      tableId,
      name: "Archived Column",
      fieldIds: [title.id, budget.id],
    })
    await publishForm(db, ORG_ID, USER_ID, form.id)

    await db
      .update(fields)
      .set({ status: "archived" })
      .where(eq(fields.id, budget.id))

    // No answer for the archived column: still a valid response.
    const accepted = await submitPublicForm(
      db,
      form.slug,
      answersFor({ [title.id]: "Only the title" }),
      { ip: "192.0.2.10", userAgent: "vitest" },
    )
    expect(accepted.recordId).toMatch(/^rec_/)

    const rejected = await submitPublicForm(
      db,
      form.slug,
      answersFor({ [title.id]: "Title", [budget.id]: 500 }),
      { ip: "192.0.2.11", userAgent: "vitest" },
    ).catch((error: unknown) => error)

    expect(rejected).toMatchObject({
      code: "FORM_UPDATED",
      details: { questions: [{ label: "Budget" }] },
    })

    const publicForm = await getPublicForm(db, form.slug)
    expect(publicForm.questions.length).toBeGreaterThan(0)
  })

  it("counts concurrent metric events exactly once each", async () => {
    const { db, baseId, tableId, byName } = await workspace()
    const title = byName("Project Name")
    const form = await draftForm(db, { baseId, tableId, name: "Metric Race", fieldIds: [title.id] })
    await publishForm(db, ORG_ID, USER_ID, form.id)

    await Promise.all(
      Array.from({ length: 5 }, () =>
        recordPublicFormMetric(db, form.slug, { metric: "view" }),
      ),
    )

    const metricRows = await db
      .select()
      .from(formMetricBuckets)
      .where(
        and(
          eq(formMetricBuckets.formId, form.id),
          eq(formMetricBuckets.metric, "view"),
        ),
      )
    expect(metricRows).toHaveLength(1)
    expect(metricRows[0].count).toBe(5)
  })

  it("creates no table when a sample row fails validation", async () => {
    const { db, baseId } = await workspace()
    const ctx: AiToolContext = { db, session }
    const name = "Broken Sample Table"

    await expect(
      executeApprovedWrite(ctx, "create_table", {
        baseId,
        name,
        fields: [{ name: "Contact", type: "email" }],
        sampleRows: [{ Contact: "not-an-email" }],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" })

    const tablesAfter = await db
      .select()
      .from(tables)
      .where(and(eq(tables.orgId, ORG_ID), eq(tables.name, name)))
    expect(tablesAfter).toHaveLength(0)
    const fieldsAfter = await db
      .select()
      .from(fields)
      .where(and(eq(fields.orgId, ORG_ID), eq(fields.name, "Contact")))
    expect(fieldsAfter).toHaveLength(0)
  })

  it("rejects writes without an approval token, across users, and on replay", async () => {
    const { db, baseId, tableId, byName } = await workspace()
    const title = byName("Project Name")
    const ctx: AiToolContext = { db, session }

    const input = {
      baseId,
      tableId,
      values: [{ fieldId: title.id, fieldName: title.name, value: "Approved write" }],
    }
    const proposal = await buildWriteProposal(ctx, "create_record", input)

    const unapproved = await writeToolPOST(
      jsonRequest("/api/ai/tools/write", {
        input: proposal.input,
        operation: proposal.operation,
      }),
    )
    expect(unapproved.status).toBe(400)

    const token = await issueWriteProposalToken(ctx, proposal)
    const otherUserToken = token
    const approved = await writeToolPOST(
      jsonRequest("/api/ai/tools/write", {
        input: proposal.input,
        operation: proposal.operation,
        token,
      }),
    )
    expect(approved.status).toBe(200)

    const replayed = await writeToolPOST(
      jsonRequest("/api/ai/tools/write", {
        input: proposal.input,
        operation: proposal.operation,
        token: otherUserToken,
      }),
    )
    expect(replayed.status).toBe(409)
    expect((await replayed.json()) as { code: string }).toMatchObject({
      code: "PROPOSAL_ALREADY_USED",
    })

    const tampered = await issueWriteProposalToken(ctx, proposal)
    const swapped = await writeToolPOST(
      jsonRequest("/api/ai/tools/write", {
        input: {
          ...proposal.input,
          values: [{ fieldId: title.id, fieldName: title.name, value: "Tampered" }],
        },
        operation: proposal.operation,
        token: tampered,
      }),
    )
    expect(swapped.status).toBe(403)
  })

  it("archives a deleted form while keeping versions and submissions", async () => {
    const { db, baseId, tableId, byName } = await workspace()
    const title = byName("Project Name")
    const form = await draftForm(db, { baseId, tableId, name: "Deletable", fieldIds: [title.id] })
    await publishForm(db, ORG_ID, USER_ID, form.id)
    const submitted = await submitPublicForm(
      db,
      form.slug,
      answersFor({ [title.id]: "Keep me" }),
      { ip: "192.0.2.44", userAgent: "vitest" },
    )

    await deleteForm(db, ORG_ID, form.id)

    await expect(getPublicForm(db, form.slug)).rejects.toMatchObject({ code: "NOT_FOUND" })
    await expect(
      submitPublicForm(db, form.slug, answersFor({ [title.id]: "Late" })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })

    const remaining = await listForms(db, ORG_ID, { baseId })
    expect(remaining.some((row) => row.id === form.id)).toBe(false)

    expect(
      await db.select().from(formSubmissions).where(eq(formSubmissions.formId, form.id)),
    ).toHaveLength(1)
    expect(
      await db.select().from(formVersions).where(eq(formVersions.formId, form.id)),
    ).toHaveLength(1)
    expect(
      await db.select().from(records).where(eq(records.id, submitted.recordId)),
    ).toHaveLength(1)
  })
})
