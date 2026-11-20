import { and, asc, eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  bases,
  fieldSequences,
  fields,
  formDraftFields,
  formMetricBuckets,
  formSubmissions,
  forms,
  records,
  tables,
} from "../../../drizzle/schema"
import { getDb, resetDbForTests } from "@/db/client"
import { ensureSeededBase } from "@/db/seed"
import {
  ELIGIBLE_FORM_FIELD_TYPES,
  draftQuestionsFromFields,
} from "@/lib/form-draft-generator"
import type { FieldDefinition } from "@/lib/domain"
import {
  GET as listFormsGET,
  POST as createFormPOST,
} from "@/app/api/forms/route"
import {
  GET as formDetailGET,
  PATCH as formDetailPATCH,
} from "@/app/api/forms/[formId]/route"
import { PATCH as draftPATCH } from "@/app/api/forms/[formId]/draft/route"
import { POST as generateDraftPOST } from "@/app/api/forms/[formId]/draft/from-fields/route"
import { POST as publishPOST } from "@/app/api/forms/[formId]/publish/route"
import { GET as submissionsGET } from "@/app/api/forms/[formId]/submissions/route"
import { GET as analyticsGET } from "@/app/api/forms/[formId]/analytics/route"
import { GET as publicFormGET } from "@/app/api/public/forms/[slug]/route"
import { POST as publicSubmitPOST } from "@/app/api/public/forms/[slug]/submit/route"
import { POST as publicMetricPOST } from "@/app/api/public/forms/[slug]/metric/route"

const ORG_ID = "local-org"
const USER_ID = "local-user"

function jsonRequest(
  path: string,
  method: string,
  body?: unknown,
): Request {
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function formContext(formId: string) {
  return { params: Promise.resolve({ formId }) }
}

function slugContext(slug: string) {
  return { params: Promise.resolve({ slug }) }
}

async function bodyOf<T = Record<string, unknown>>(
  response: Response,
): Promise<T> {
  return (await response.json()) as T
}

function toFieldDefinitions(
  rows: Array<typeof fields.$inferSelect>,
): FieldDefinition[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type as FieldDefinition["type"],
    config: row.config as FieldDefinition["config"],
    rank: row.rank,
    width: row.width,
    isPrimary: row.isPrimary,
  }))
}

async function seedWorkspace() {
  const db = await getDb()
  const { baseId, tableId } = await ensureSeededBase(db, ORG_ID, USER_ID)
  const fieldRows = await db
    .select()
    .from(fields)
    .where(eq(fields.tableId, tableId))
    .orderBy(asc(fields.rank))
  return { db, baseId, tableId, fieldRows }
}

function fieldByName(
  rows: Array<typeof fields.$inferSelect>,
  name: string,
): typeof fields.$inferSelect {
  const field = rows.find((row) => row.name === name)
  if (!field) throw new Error(`Missing seeded field: ${name}`)
  return field
}

async function createFormViaApi(input: Record<string, unknown>) {
  const response = await createFormPOST(
    jsonRequest("/api/forms", "POST", input),
  )
  expect(response.status).toBe(201)
  return bodyOf<{
    form: { id: string; slug: string; status: string; publishedVersionId: string | null }
    draftFields: Array<{
      id: string
      targetFieldId: string
      label: string
      required: boolean
      mode: string
    }>
    tableFields: Array<{ id: string; eligible: boolean }>
  }>(response)
}

describe("Forms backend", () => {
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

  it("generates ordered draft questions from chosen columns and skips read-only types", async () => {
    const { fieldRows } = await seedWorkspace()
    const title = fieldByName(fieldRows, "Project Name")
    const status = fieldByName(fieldRows, "Status")
    const auto = fieldByName(fieldRows, "ID")
    const covered = fieldByName(fieldRows, "Cover Image")
    const attachment = fieldByName(fieldRows, "Brief & Specs")

    expect(ELIGIBLE_FORM_FIELD_TYPES).not.toContain("autoNumber")
    expect(ELIGIBLE_FORM_FIELD_TYPES).not.toContain("createdTime")
    expect(ELIGIBLE_FORM_FIELD_TYPES).not.toContain("createdBy")
    expect(ELIGIBLE_FORM_FIELD_TYPES).toContain("singleLineText")
    expect(ELIGIBLE_FORM_FIELD_TYPES).toContain("attachment")

    const questions = draftQuestionsFromFields(toFieldDefinitions(fieldRows), [
      status.id,
      title.id,
      auto.id,
    ])

    expect(questions.map((question) => question.targetFieldId)).toEqual([
      title.id,
      status.id,
    ])
    expect(questions[0]).toMatchObject({
      label: "Project Name",
      required: true,
      mode: "input",
      helpText: "",
      placeholder: "",
      visibilityRule: null,
    })
    expect(questions[1].required).toBe(false)
    expect(questions[0].rank < questions[1].rank).toBe(true)

    const all = draftQuestionsFromFields(toFieldDefinitions(fieldRows))
    const targets = all.map((question) => question.targetFieldId)
    expect(targets).not.toContain(auto.id)
    expect(targets).toContain(covered.id)
    expect(targets).toContain(attachment.id)
    expect(all).toHaveLength(
      fieldRows.filter((row) => row.type !== "autoNumber").length,
    )
    expect(new Set(all.map((question) => question.rank)).size).toBe(all.length)
  })

  it("creates a form, auto-populates every eligible column, and lists it", async () => {
    const { baseId, tableId, fieldRows } = await seedWorkspace()
    const auto = fieldByName(fieldRows, "ID")

    const created = await createFormViaApi({
      baseId,
      tableId,
      name: "Customer Intake",
      description: "Tell us about your project.",
    })

    expect(created.form.status).toBe("draft")
    expect(created.form.publishedVersionId).toBeNull()
    expect(created.form.slug).toMatch(/^customer-intake-[a-z0-9]{6}$/)
    expect(created.draftFields.map((row) => row.targetFieldId)).not.toContain(
      auto.id,
    )
    expect(created.draftFields).toHaveLength(
      fieldRows.filter((row) => !["autoNumber", "createdTime", "createdBy"].includes(row.type))
        .length,
    )
    expect(created.draftFields.every((row) => row.mode === "input")).toBe(true)
    expect(
      created.draftFields.find((row) => row.label === "Project Name")?.required,
    ).toBe(true)

    const list = await listFormsGET(
      new Request(`http://localhost:3000/api/forms?baseId=${baseId}`),
    )
    const payload = await bodyOf<{
      forms: Array<{
        id: string
        submissionCount: number
        baseName: string | null
        tableName: string | null
      }>
    }>(list)
    const listed = payload.forms.find((form) => form.id === created.form.id)
    expect(listed).toBeDefined()
    expect(listed?.submissionCount).toBe(0)
    expect(listed?.baseName).toBe("Product Workspace")
    expect(listed?.tableName).toBe("Project Tracker")
    // The seeded example form is listed too.
    expect(payload.forms.length).toBe(2)
    const catalogResponse = await listFormsGET(
      new Request(
        `http://localhost:3000/api/forms?baseId=${baseId}&include=tables`,
      ),
    )
    const catalog = await bodyOf<{
      base: { id: string; name: string }
      tables: Array<{
        id: string
        name: string
        fields: Array<{ id: string; type: string; eligible: boolean }>
      }>
    }>(catalogResponse)
    expect(catalog.base.name).toBe("Product Workspace")
    expect(catalog.tables).toHaveLength(1)
    expect(catalog.tables[0].name).toBe("Project Tracker")
    const autoOption = catalog.tables[0].fields.find(
      (field) => field.id === auto.id,
    )
    expect(autoOption?.eligible).toBe(false)
    expect(
      catalog.tables[0].fields.filter((field) => field.eligible).length,
    ).toBe(created.draftFields.length)
  })

  it("regenerates and appends draft questions from selected columns", async () => {
    const { baseId, tableId, fieldRows } = await seedWorkspace()
    const title = fieldByName(fieldRows, "Project Name")
    const status = fieldByName(fieldRows, "Status")
    const budget = fieldByName(fieldRows, "Budget")

    const created = await createFormViaApi({
      baseId,
      tableId,
      name: "Field Picker",
      selectedFieldIds: [title.id],
    })
    expect(created.draftFields).toHaveLength(1)

    const appended = await generateDraftPOST(
      jsonRequest(`/api/forms/${created.form.id}/draft/from-fields`, "POST", {
        fieldIds: [status.id, budget.id],
        mode: "append",
      }),
      formContext(created.form.id),
    )
    expect(appended.status).toBe(200)
    const appendedBody = await bodyOf<{
      fields: Array<{ targetFieldId: string }>
      mode: string
    }>(appended)
    expect(appendedBody.mode).toBe("append")
    expect(appendedBody.fields.map((row) => row.targetFieldId)).toEqual([
      title.id,
      status.id,
      budget.id,
    ])

    const replaced = await generateDraftPOST(
      jsonRequest(`/api/forms/${created.form.id}/draft/from-fields`, "POST", {
        mode: "replace",
      }),
      formContext(created.form.id),
    )
    const replacedBody = await bodyOf<{
      fields: Array<{ targetFieldId: string }>
    }>(replaced)
    expect(replacedBody.fields).toHaveLength(
      fieldRows.filter((row) => row.type !== "autoNumber").length,
    )
    expect(replacedBody.fields.map((row) => row.targetFieldId)).not.toContain(
      fieldByName(fieldRows, "ID").id,
    )
    const auto = fieldByName(fieldRows, "ID")
    const rejected = await draftPATCH(
      jsonRequest(`/api/forms/${created.form.id}/draft`, "PATCH", {
        fields: [{ targetFieldId: auto.id, label: "Autonumber" }],
      }),
      formContext(created.form.id),
    )
    expect(rejected.status).toBe(400)
    const rejectedBody = await bodyOf<{ code: string }>(rejected)
    expect(rejectedBody.code).toBe("VALIDATION_ERROR")
  })

  it("publishes, serves, and stores a real record from a public submission", async () => {
    const { db, baseId, tableId, fieldRows } = await seedWorkspace()
    const title = fieldByName(fieldRows, "Project Name")
    const auto = fieldByName(fieldRows, "ID")
    const budget = fieldByName(fieldRows, "Budget")
    const status = fieldByName(fieldRows, "Status")

    const created = await createFormViaApi({
      baseId,
      tableId,
      name: "Public Intake",
      selectedFieldIds: [title.id, budget.id, status.id],
    })
    const formId = created.form.id

    const publishResponse = await publishPOST(
      new Request(`http://localhost:3000/api/forms/${formId}/publish`, {
        method: "POST",
      }),
      formContext(formId),
    )
    expect(publishResponse.status).toBe(200)
    const published = await bodyOf<{
      form: { status: string; publishedVersionId: string }
      version: { id: string; versionNumber: number }
      publicUrl: string
    }>(publishResponse)
    expect(published.form.status).toBe("published")
    expect(published.version.versionNumber).toBe(1)
    expect(published.form.publishedVersionId).toBe(published.version.id)
    expect(published.publicUrl).toBe(`/f/${created.form.slug}`)

    const publicResponse = await publicFormGET(
      new Request(
        `http://localhost:3000/api/public/forms/${created.form.slug}`,
      ),
      slugContext(created.form.slug),
    )
    expect(publicResponse.status).toBe(200)
    const publicPayload = await bodyOf<{
      form: {
        title: string
        status: string
        version: number
        questions: Array<{
          id: string
          fieldId: string
          label: string
          required: boolean
        }>
      }
      fields: Array<{ id: string; type: string; config: Record<string, unknown> }>
    }>(publicResponse)
    expect(publicPayload.form.status).toBe("published")
    expect(publicPayload.form.version).toBe(1)
    expect(publicPayload.form.questions).toHaveLength(3)
    expect(publicPayload.fields.map((field) => field.type).sort()).toEqual([
      "currency",
      "singleLineText",
      "singleSelect",
    ])
    // Question IDs are immutable version question IDs, not table column IDs.
    expect(publicPayload.form.questions.map((question) => question.id)).not.toContain(
      title.id,
    )

    const titleQuestion = publicPayload.form.questions.find(
      (question) => question.label === "Project Name",
    )!
    const budgetQuestion = publicPayload.form.questions.find(
      (question) => question.label === "Budget",
    )!
    expect(titleQuestion.required).toBe(true)

    const recordsBefore = await db
      .select()
      .from(records)
      .where(eq(records.tableId, tableId))
    const lastRankBefore = recordsBefore
      .map((row) => row.rank)
      .sort()
      .at(-1)!

    const submitResponse = await publicSubmitPOST(
      jsonRequest(
        `/api/public/forms/${created.form.slug}/submit`,
        "POST",
        {
          answers: {
            [titleQuestion.id]: "公开表单项目",
            [budgetQuestion.id]: 1250,
          },
        },
      ),
      slugContext(created.form.slug),
    )
    expect(submitResponse.status).toBe(201)
    const submission = await bodyOf<{
      submissionId: string
      recordId: string
      thankYou: { title: string; message: string }
    }>(submitResponse)
    expect(submission.recordId).toMatch(/^rec_/)
    expect(submission.submissionId).toMatch(/^sub_/)
    expect(submission.thankYou.title).toBe("Thank you for your submission")

    const inserted = await db
      .select()
      .from(records)
      .where(eq(records.id, submission.recordId))
    expect(inserted).toHaveLength(1)
    const record = inserted[0]
    expect(record.orgId).toBe(ORG_ID)
    expect(record.tableId).toBe(tableId)
    expect(record.values[title.id]).toBe("公开表单项目")
    expect(record.values[budget.id]).toBe(1250)
    // Auto-number continues from the seeded sequence (nextValue was 7).
    expect(record.values[auto.id]).toBe(7)
    expect(record.searchText).toContain("公开表单项目")
    expect(record.searchText).toContain("1,250")
    expect(record.rank > lastRankBefore).toBe(true)
    expect(record.createdBy).toBe("public-form")

    const sequence = await db
      .select()
      .from(fieldSequences)
      .where(eq(fieldSequences.fieldId, auto.id))
    expect(sequence[0]?.nextValue).toBe(8)

    const submissions = await db
      .select()
      .from(formSubmissions)
      .where(eq(formSubmissions.formId, formId))
    expect(submissions).toHaveLength(1)
    expect(submissions[0].recordId).toBe(submission.recordId)
    expect(submissions[0].formVersionId).toBe(published.version.id)
    expect(submissions[0].answers[title.id]).toBe("公开表单项目")

    const buckets = await db
      .select()
      .from(formMetricBuckets)
      .where(
        and(
          eq(formMetricBuckets.formId, formId),
          eq(formMetricBuckets.metric, "submission"),
        ),
      )
    expect(buckets.reduce((total, bucket) => total + bucket.count, 0)).toBe(1)

    const submissionsResponse = await submissionsGET(
      new Request(`http://localhost:3000/api/forms/${formId}/submissions`),
      formContext(formId),
    )
    expect(submissionsResponse.status).toBe(200)
    const submissionsBody = await bodyOf<{
      total: number
      columns: Array<{ fieldId: string; label: string }>
      submissions: Array<{
        recordId: string
        displayValues: Record<string, string>
      }>
    }>(submissionsResponse)
    expect(submissionsBody.total).toBe(1)
    expect(submissionsBody.columns.map((column) => column.label)).toEqual([
      "Project Name",
      "Status",
      "Budget",
    ])
    expect(submissionsBody.submissions[0].recordId).toBe(submission.recordId)
    expect(
      submissionsBody.submissions[0].displayValues[title.id],
    ).toBe("公开表单项目")

    const csvResponse = await submissionsGET(
      new Request(
        `http://localhost:3000/api/forms/${formId}/submissions?format=csv`,
      ),
      formContext(formId),
    )
    expect(csvResponse.status).toBe(200)
    expect(csvResponse.headers.get("content-type")).toContain("text/csv")
    const csv = await csvResponse.text()
    expect(csv).toContain("Project Name")
    expect(csv).toContain("公开表单项目")

    const metricResponse = await publicMetricPOST(
      jsonRequest(`/api/public/forms/${created.form.slug}/metric`, "POST", {
        metric: "start",
      }),
      slugContext(created.form.slug),
    )
    expect(metricResponse.status).toBe(200)

    const analyticsResponse = await analyticsGET(
      new Request(`http://localhost:3000/api/forms/${formId}/analytics?days=7`),
      formContext(formId),
    )
    const analytics = await bodyOf<{
      totals: { starts: number; submissions: number; views: number }
      series: Array<{ submissions: number }>
      completionRate: number
    }>(analyticsResponse)
    expect(analytics.totals.submissions).toBe(1)
    expect(analytics.totals.starts).toBe(1)
    expect(analytics.series).toHaveLength(7)
    expect(analytics.series.reduce((sum, point) => sum + point.submissions, 0)).toBe(1)
    expect(analytics.completionRate).toBe(0)

    const closeResponse = await formDetailPATCH(
      jsonRequest(`/api/forms/${formId}`, "PATCH", { status: "closed" }),
      formContext(formId),
    )
    expect(closeResponse.status).toBe(200)
    const closed = await bodyOf<{ form: { status: string } }>(closeResponse)
    expect(closed.form.status).toBe("closed")

    const closedSubmit = await publicSubmitPOST(
      jsonRequest(
        `/api/public/forms/${created.form.slug}/submit`,
        "POST",
        { answers: { [titleQuestion.id]: "Should not be stored" } },
      ),
      slugContext(created.form.slug),
    )
    expect(closedSubmit.status).toBe(410)
    const closedBody = await bodyOf<{ code: string }>(closedSubmit)
    expect(closedBody.code).toBe("FORM_CLOSED")

    const recordsAfter = await db
      .select()
      .from(records)
      .where(eq(records.tableId, tableId))
    expect(recordsAfter).toHaveLength(recordsBefore.length + 1)

    const closedGet = await publicFormGET(
      new Request(
        `http://localhost:3000/api/public/forms/${created.form.slug}`,
      ),
      slugContext(created.form.slug),
    )
    expect(closedGet.status).toBe(410)

    const detail = await formDetailGET(
      new Request(`http://localhost:3000/api/forms/${formId}`),
      formContext(formId),
    )
    const detailBody = await bodyOf<{
      submissionCount: number
      form: { status: string }
    }>(detail)
    expect(detailBody.form.status).toBe("closed")
    expect(detailBody.submissionCount).toBe(1)
  })

  it("respects conditional visibility when validating required answers", async () => {
    const { baseId, tableId, fieldRows } = await seedWorkspace()
    const title = fieldByName(fieldRows, "Project Name")
    const budget = fieldByName(fieldRows, "Budget")

    const created = await createFormViaApi({
      baseId,
      tableId,
      name: "Conditional Intake",
      selectedFieldIds: [title.id, budget.id],
    })
    const titleDraft = created.draftFields.find(
      (row) => row.targetFieldId === title.id,
    )!
    const budgetDraft = created.draftFields.find(
      (row) => row.targetFieldId === budget.id,
    )!

    const replaceResponse = await draftPATCH(
      jsonRequest(`/api/forms/${created.form.id}/draft`, "PATCH", {
        fields: [
          {
            id: titleDraft.id,
            targetFieldId: title.id,
            label: "Project Name",
            required: true,
          },
          {
            id: budgetDraft.id,
            targetFieldId: budget.id,
            label: "Estimated Budget",
            required: true,
            visibilityRule: {
              conjunction: "and",
              conditions: [
                {
                  id: "condition-1",
                  sourceQuestionId: titleDraft.id,
                  operator: "is_empty",
                },
              ],
            },
          },
        ],
      }),
      formContext(created.form.id),
    )
    expect(replaceResponse.status).toBe(200)

    const publishResponse = await publishPOST(
      new Request(
        `http://localhost:3000/api/forms/${created.form.id}/publish`,
        { method: "POST" },
      ),
      formContext(created.form.id),
    )
    expect(publishResponse.status).toBe(200)

    const publicResponse = await publicFormGET(
      new Request(
        `http://localhost:3000/api/public/forms/${created.form.slug}`,
      ),
      slugContext(created.form.slug),
    )
    const payload = await bodyOf<{
      form: {
        questions: Array<{
          id: string
          label: string
          required: boolean
          visibility?: { conditions: Array<{ sourceQuestionId: string }> }
        }>
      }
    }>(publicResponse)
    const publicTitle = payload.form.questions.find(
      (question) => question.label === "Project Name",
    )!
    const publicBudget = payload.form.questions.find(
      (question) => question.label === "Estimated Budget",
    )!
    expect(publicBudget.visibility?.conditions[0].sourceQuestionId).toBe(
      publicTitle.id,
    )

    // The budget question is required but hidden because the title is filled.
    const submitResponse = await publicSubmitPOST(
      jsonRequest(
        `/api/public/forms/${created.form.slug}/submit`,
        "POST",
        { answers: { [publicTitle.id]: "Visible title only" } },
      ),
      slugContext(created.form.slug),
    )
    expect(submitResponse.status).toBe(201)
    const submission = await bodyOf<{ recordId: string }>(submitResponse)

    const db = await getDb()
    const inserted = await db
      .select()
      .from(records)
      .where(eq(records.id, submission.recordId))
    expect(inserted[0].values[title.id]).toBe("Visible title only")
    expect(inserted[0].values[budget.id]).toBeUndefined()

    const draftRows = await db
      .select()
      .from(formDraftFields)
      .where(eq(formDraftFields.formId, created.form.id))
    expect(draftRows).toHaveLength(2)

    const baseRows = await db.select().from(bases).where(eq(bases.id, baseId))
    expect(baseRows).toHaveLength(1)
    const tableRows = await db.select().from(tables).where(eq(tables.id, tableId))
    expect(tableRows).toHaveLength(1)
    const formRows = await db.select().from(forms).where(eq(forms.id, created.form.id))
    expect(formRows).toHaveLength(1)
  })
})
