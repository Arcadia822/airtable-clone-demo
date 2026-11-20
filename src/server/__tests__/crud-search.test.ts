import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { eq } from "drizzle-orm"

import {
  bases as basesTable,
  forms as formsTable,
  formVersionFields as formVersionFieldsTable,
  formVersions as formVersionsTable,
  tables as tablesTable,
} from "../../../drizzle/schema"
import { getDb, resetDbForTests } from "@/db/client"

import { GET as basesGET, POST as basesPOST } from "@/app/api/bases/route"
import {
  DELETE as baseDELETE,
  GET as baseGET,
  PATCH as basePATCH,
} from "@/app/api/bases/[baseId]/route"
import { GET as dashboardGET } from "@/app/api/bases/[baseId]/dashboard/route"
import { GET as tablesGET, POST as tablesPOST } from "@/app/api/tables/route"
import {
  DELETE as tableDELETE,
  GET as tableGET,
  PATCH as tablePATCH,
} from "@/app/api/tables/[tableId]/route"
import {
  GET as fieldsGET,
  POST as fieldsPOST,
} from "@/app/api/tables/[tableId]/fields/route"
import { DELETE as fieldDELETE, PATCH as fieldPATCH } from "@/app/api/fields/[fieldId]/route"
import { POST as fieldRestorePOST } from "@/app/api/fields/[fieldId]/restore/route"
import {
  DELETE as recordsDELETE,
  GET as recordsGET,
  POST as recordsPOST,
} from "@/app/api/tables/[tableId]/records/route"
import { POST as recordsQueryPOST } from "@/app/api/tables/[tableId]/records/query/route"
import { PATCH as recordsBatchPATCH } from "@/app/api/tables/[tableId]/records/batch/route"
import {
  DELETE as recordDELETE,
  GET as recordGET,
  PATCH as recordPATCH,
} from "@/app/api/records/[recordId]/route"
import { POST as recordRestorePOST } from "@/app/api/records/[recordId]/restore/route"
import { GET as viewsGET, POST as viewsPOST } from "@/app/api/views/route"
import {
  DELETE as viewDELETE,
  GET as viewGET,
  PATCH as viewPATCH,
} from "@/app/api/views/[viewId]/route"
import { PATCH as viewFieldConfigPATCH } from "@/app/api/views/[viewId]/fields/[fieldId]/route"
import { POST as uploadSessionPOST } from "@/app/api/attachments/session/route"
import { PUT as uploadPUT } from "@/app/api/attachments/upload/[sessionId]/route"
import { POST as finalizePOST } from "@/app/api/attachments/finalize/route"
import { GET as attachmentsGET } from "@/app/api/attachments/route"
import { DELETE as attachmentDELETE } from "@/app/api/attachments/[attachmentId]/route"
import { GET as fileGET } from "@/app/api/files/[attachmentId]/route"
import { GET as searchGET } from "@/app/api/search/route"
import { GET as searchRecordsGET } from "@/app/api/search/records/route"
import { GET as preferencesGET, PATCH as preferencesPATCH } from "@/app/api/preferences/route"

type Json = Record<string, unknown>

interface FieldDto {
  id: string
  name: string
  type: string
  config: Record<string, unknown>
  rank: string
  width: number
  isPrimary: boolean
  frozen?: boolean
}

interface RecordDto {
  id: string
  rank: string
  values: Record<string, unknown>
  revision: number
  createdAt: number
  updatedAt: number
}

const API = "http://localhost"

let uploadDir: string

beforeEach(async () => {
  process.env.DATABASE_URL = "pglite:memory"
  delete process.env.FACTORY_VISITOR_AUTH_URL
  delete process.env.FACTORY_VISITOR_AUTH_TOKEN
  uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-uploads-"))
  process.env.UPLOAD_DIR = uploadDir
  await resetDbForTests()
})

afterEach(async () => {
  await resetDbForTests()
  fs.rmSync(uploadDir, { recursive: true, force: true })
  delete process.env.UPLOAD_DIR
})

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(`${API}${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function routeContext<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) }
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

async function seededWorkspace() {
  const response = await basesGET(jsonRequest("/api/bases", "GET"))
  expect(response.status).toBe(200)
  const payload = await readJson<{
    bases: Array<{
      id: string
      name: string
      tableCount: number
      recordCount: number
      tables: Array<{ id: string; name: string }>
    }>
  }>(response)
  const base = payload.bases[0]
  const table = base.tables[0]

  const tableResponse = await tableGET(
    jsonRequest(`/api/tables/${table.id}`, "GET"),
    routeContext({ tableId: table.id }),
  )
  expect(tableResponse.status).toBe(200)
  const bundle = await readJson<{
    table: { id: string; baseId: string }
    fields: FieldDto[]
    views: Array<{ id: string; name: string; type: string }>
    viewFieldConfigs: unknown[]
  }>(tableResponse)

  const fieldByName = (name: string): FieldDto => {
    const field = bundle.fields.find((candidate) => candidate.name === name)
    if (!field) throw new Error(`Missing seeded field ${name}`)
    return field
  }

  return { base, table, bundle, fieldByName, fieldByNameMap: bundle.fields }
}

async function listRecords(tableId: string, q?: string): Promise<RecordDto[]> {
  const response = await recordsGET(
    jsonRequest(`/api/tables/${tableId}/records${q ? `?q=${q}` : ""}`, "GET"),
    routeContext({ tableId }),
  )
  expect(response.status).toBe(200)
  return (await readJson<{ records: RecordDto[] }>(response)).records
}

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

describe("bases, tables, and custom columns", () => {
  it("auto-seeds the workspace and exposes counts, then creates bases and tables", async () => {
    const { base, table, bundle } = await seededWorkspace()

    expect(base.name).toBe("Product Workspace")
    expect(base.tableCount).toBe(1)
    expect(base.recordCount).toBe(6)
    expect(table.name).toBe("Project Tracker")
    expect(bundle.fields.length).toBeGreaterThanOrEqual(9)
    expect(bundle.fields[0].isPrimary).toBe(true)
    expect(bundle.views.some((view) => view.type === "grid")).toBe(true)
    expect(bundle.viewFieldConfigs).toEqual([])

    const created = await basesPOST(
      jsonRequest("/api/bases", "POST", { name: "Growth", tableName: "Experiments" }),
    )
    expect(created.status).toBe(201)
    const createdBody = await readJson<{
      base: { id: string; name: string }
      table: { id: string }
      fields: FieldDto[]
      views: Array<{ type: string }>
    }>(created)
    expect(createdBody.base.name).toBe("Growth")
    expect(createdBody.fields).toHaveLength(1)
    expect(createdBody.fields[0].isPrimary).toBe(true)
    expect(createdBody.views[0].type).toBe("grid")

    const list = await readJson<{ bases: Array<{ id: string }> }>(
      await basesGET(jsonRequest("/api/bases", "GET")),
    )
    expect(list.bases).toHaveLength(2)

    const detail = await baseGET(
      jsonRequest(`/api/bases/${createdBody.base.id}`, "GET"),
      routeContext({ baseId: createdBody.base.id }),
    )
    expect(detail.status).toBe(200)
    expect((await readJson<{ tables: unknown[] }>(detail)).tables).toHaveLength(1)

    const patched = await basePATCH(
      jsonRequest(`/api/bases/${createdBody.base.id}`, "PATCH", {
        name: "Growth Ops",
        color: "#10b981",
      }),
      routeContext({ baseId: createdBody.base.id }),
    )
    expect(patched.status).toBe(200)
    expect((await readJson<{ base: { name: string } }>(patched)).base.name).toBe(
      "Growth Ops",
    )


    const baseDeleted = await baseDELETE(
      jsonRequest(`/api/bases/${createdBody.base.id}`, "DELETE"),
      routeContext({ baseId: createdBody.base.id }),
    )
    expect(baseDeleted.status).toBe(200)
    const deletedBase = await baseGET(
      jsonRequest(`/api/bases/${createdBody.base.id}`, "GET"),
      routeContext({ baseId: createdBody.base.id }),
    )
    expect(deletedBase.status).toBe(404)
    const dashboard = await dashboardGET(
      jsonRequest(`/api/bases/${base.id}/dashboard`, "GET"),
      routeContext({ baseId: base.id }),
    )
    expect(dashboard.status).toBe(200)
    const dashboardBody = await readJson<{
      counts: { tables: number; views: number; records: number; forms: number }
      tables: Array<{ recordCount: number }>
    }>(dashboard)
    expect(dashboardBody.counts.tables).toBe(1)
    expect(dashboardBody.counts.views).toBe(5)
    expect(dashboardBody.counts.records).toBe(6)
    expect(dashboardBody.counts.forms).toBe(1)
    expect(dashboardBody.tables[0].recordCount).toBe(6)

    const createdTable = await tablesPOST(
      jsonRequest("/api/tables", "POST", {
        baseId: base.id,
        name: "Launch Plan",
        fields: [
          { name: "Title", type: "singleLineText", isPrimary: true },
          { name: "Ticket", type: "autoNumber" },
          {
            name: "Budget",
            type: "currency",
            config: { currency: "USD", precision: 0 },
          },
        ],
      }),
    )
    expect(createdTable.status).toBe(201)
    const createdTableBody = await readJson<{
      table: { id: string }
      fields: FieldDto[]
    }>(createdTable)
    expect(createdTableBody.fields.map((field) => field.name)).toEqual([
      "Title",
      "Ticket",
      "Budget",
    ])

    const renamed = await tablePATCH(
      jsonRequest(`/api/tables/${createdTableBody.table.id}`, "PATCH", {
        name: "Launch Plan v2",
      }),
      routeContext({ tableId: createdTableBody.table.id }),
    )
    expect(renamed.status).toBe(200)
    expect((await readJson<{ table: { name: string } }>(renamed)).table.name).toBe(
      "Launch Plan v2",
    )

    const deleted = await tableDELETE(
      jsonRequest(`/api/tables/${createdTableBody.table.id}`, "DELETE"),
      routeContext({ tableId: createdTableBody.table.id }),
    )
    expect(deleted.status).toBe(200)
    const afterDelete = await tableGET(
      jsonRequest(`/api/tables/${createdTableBody.table.id}`, "GET"),
      routeContext({ tableId: createdTableBody.table.id }),
    )
    expect(afterDelete.status).toBe(404)

    const tables = await readJson<{ tables: Array<{ name: string }> }>(
      await tablesGET(jsonRequest(`/api/tables?baseId=${base.id}`, "GET")),
    )
    expect(tables.tables.map((entry) => entry.name)).toEqual(["Project Tracker"])
  })

  it("backfills auto-number columns in rank order and keeps allocation atomic", async () => {
    const { table, fieldByName } = await seededWorkspace()
    const title = fieldByName("Project Name")
    const existingAuto = fieldByName("ID")

    const created = await fieldsPOST(
      jsonRequest(`/api/tables/${table.id}/fields`, "POST", {
        name: "Ticket No",
        type: "autoNumber",
      }),
      routeContext({ tableId: table.id }),
    )
    expect(created.status).toBe(201)
    const ticketField = (await readJson<{ field: FieldDto }>(created)).field

    const records = await listRecords(table.id)
    const assigned = records.map((record) => record.values[ticketField.id])
    expect(assigned).toEqual([1, 2, 3, 4, 5, 6])

    const nextRecord = await recordsPOST(
      jsonRequest(`/api/tables/${table.id}/records`, "POST", {
        values: { [title.id]: "New Project" },
      }),
      routeContext({ tableId: table.id }),
    )
    expect(nextRecord.status).toBe(201)
    const createdRecord = (await readJson<{ record: RecordDto }>(nextRecord)).record
    expect(createdRecord.values[ticketField.id]).toBe(7)
    expect(createdRecord.values[existingAuto.id]).toBe(7)

    const second = await recordsPOST(
      jsonRequest(`/api/tables/${table.id}/records`, "POST", {
        values: { [title.id]: "Second Project" },
      }),
      routeContext({ tableId: table.id }),
    )
    const secondRecord = (await readJson<{ record: RecordDto }>(second)).record
    expect(secondRecord.values[ticketField.id]).toBe(8)
    expect(secondRecord.values[existingAuto.id]).toBe(8)

    const fields = await readJson<{ fields: FieldDto[] }>(
      await fieldsGET(
        jsonRequest(`/api/tables/${table.id}/fields`, "GET"),
        routeContext({ tableId: table.id }),
      ),
    )
    const ranks = fields.fields.map((field) => field.rank)
    expect([...ranks].sort()).toEqual(ranks)
  })

  it("validates image columns, soft-deletes/restores fields, and rejects primary deletion", async () => {
    const { table, fieldByName } = await seededWorkspace()
    const primary = fieldByName("Project Name")
    const titleField = primary

    const created = await fieldsPOST(
      jsonRequest(`/api/tables/${table.id}/fields`, "POST", {
        name: "Cover",
        type: "image",
      }),
      routeContext({ tableId: table.id }),
    )
    expect(created.status).toBe(201)
    const imageField = (await readJson<{ field: FieldDto }>(created)).field
    expect(imageField.config.attachmentKind).toBe("image")

    const recordResponse = await recordsPOST(
      jsonRequest(`/api/tables/${table.id}/records`, "POST", {
        values: { [titleField.id]: "Cover test" },
      }),
      routeContext({ tableId: table.id }),
    )
    const record = (await readJson<{ record: RecordDto }>(recordResponse)).record

    const imageValue = {
      attachmentId: "att_one",
      name: "hero.png",
      mimeType: "image/png",
      size: 1024,
    }

    const twoImages = await recordPATCH(
      jsonRequest(`/api/records/${record.id}`, "PATCH", {
        values: { [imageField.id]: [imageValue, { ...imageValue, attachmentId: "att_two" }] },
      }),
      routeContext({ recordId: record.id }),
    )
    expect(twoImages.status).toBe(400)

    const notAnImage = await recordPATCH(
      jsonRequest(`/api/records/${record.id}`, "PATCH", {
        values: {
          [imageField.id]: [
            { attachmentId: "att_pdf", name: "spec.pdf", mimeType: "application/pdf", size: 12 },
          ],
        },
      }),
      routeContext({ recordId: record.id }),
    )
    expect(notAnImage.status).toBe(400)

    const accepted = await recordPATCH(
      jsonRequest(`/api/records/${record.id}`, "PATCH", {
        values: { [imageField.id]: [imageValue] },
      }),
      routeContext({ recordId: record.id }),
    )
    expect(accepted.status).toBe(200)

    const attachmentField = fieldByName("Brief & Specs")
    const tenFiles = Array.from({ length: 10 }, (_, index) => ({
      attachmentId: `att_file_${index}`,
      name: `file-${index}.txt`,
      mimeType: "text/plain",
      size: 10,
    }))
    const atLimit = await recordPATCH(
      jsonRequest(`/api/records/${record.id}`, "PATCH", {
        values: { [attachmentField.id]: tenFiles },
      }),
      routeContext({ recordId: record.id }),
    )
    expect(atLimit.status).toBe(200)

    const overLimit = await recordPATCH(
      jsonRequest(`/api/records/${record.id}`, "PATCH", {
        values: {
          [attachmentField.id]: [
            ...tenFiles,
            {
              attachmentId: "att_file_extra",
              name: "extra.txt",
              mimeType: "text/plain",
              size: 10,
            },
          ],
        },
      }),
      routeContext({ recordId: record.id }),
    )
    expect(overLimit.status).toBe(400)

    const primaryDelete = await fieldDELETE(
      jsonRequest(`/api/fields/${primary.id}`, "DELETE"),
      routeContext({ fieldId: primary.id }),
    )
    expect(primaryDelete.status).toBe(400)

    const removed = await fieldDELETE(
      jsonRequest(`/api/fields/${imageField.id}`, "DELETE"),
      routeContext({ fieldId: imageField.id }),
    )
    expect(removed.status).toBe(200)

    const afterDelete = await readJson<{ fields: FieldDto[] }>(
      await fieldsGET(
        jsonRequest(`/api/tables/${table.id}/fields`, "GET"),
        routeContext({ tableId: table.id }),
      ),
    )
    expect(afterDelete.fields.some((field) => field.id === imageField.id)).toBe(false)

    const restored = await fieldRestorePOST(
      jsonRequest(`/api/fields/${imageField.id}/restore`, "POST"),
      routeContext({ fieldId: imageField.id }),
    )
    expect(restored.status).toBe(200)
    expect((await readJson<{ field: FieldDto }>(restored)).field.id).toBe(imageField.id)

    const renamed = await fieldPATCH(
      jsonRequest(`/api/fields/${imageField.id}`, "PATCH", {
        name: "Hero image",
        width: 320,
        frozen: true,
      }),
      routeContext({ fieldId: imageField.id }),
    )
    expect(renamed.status).toBe(200)
    const renamedField = (await readJson<{ field: FieldDto }>(renamed)).field
    expect(renamedField.name).toBe("Hero image")
    expect(renamedField.width).toBe(320)
    expect(renamedField.frozen).toBe(true)
  })
})

describe("records, concurrency, and conditional queries", () => {
  it("enforces expectedRevision with 409 REVISION_CONFLICT and batch revisions", async () => {
    const { table, fieldByName } = await seededWorkspace()
    const title = fieldByName("Project Name")
    const priority = fieldByName("Priority")

    const createdResponse = await recordsPOST(
      jsonRequest(`/api/tables/${table.id}/records`, "POST", {
        values: { [title.id]: "Concurrency" },
      }),
      routeContext({ tableId: table.id }),
    )
    const record = (await readJson<{ record: RecordDto }>(createdResponse)).record
    expect(record.revision).toBe(1)

    const firstUpdate = await recordPATCH(
      jsonRequest(`/api/records/${record.id}`, "PATCH", {
        values: { [priority.id]: 3 },
        expectedRevision: 1,
      }),
      routeContext({ recordId: record.id }),
    )
    expect(firstUpdate.status).toBe(200)
    const updated = (await readJson<{ record: RecordDto }>(firstUpdate)).record
    expect(updated.revision).toBe(2)
    expect(updated.values[priority.id]).toBe(3)

    const staleUpdate = await recordPATCH(
      jsonRequest(`/api/records/${record.id}`, "PATCH", {
        values: { [priority.id]: 4 },
        expectedRevision: 1,
      }),
      routeContext({ recordId: record.id }),
    )
    expect(staleUpdate.status).toBe(409)
    const conflict = await readJson<{
      code: string
      details: { actualRevision: number; expectedRevision: number }
    }>(staleUpdate)
    expect(conflict.code).toBe("REVISION_CONFLICT")
    expect(conflict.details.actualRevision).toBe(2)
    expect(conflict.details.expectedRevision).toBe(1)

    const staleBatch = await recordsBatchPATCH(
      jsonRequest(`/api/tables/${table.id}/records/batch`, "PATCH", {
        updates: [{ recordId: record.id, fieldId: priority.id, value: 5, expectedRevision: 1 }],
      }),
      routeContext({ tableId: table.id }),
    )
    expect(staleBatch.status).toBe(409)

    const batch = await recordsBatchPATCH(
      jsonRequest(`/api/tables/${table.id}/records/batch`, "PATCH", {
        updates: [
          { recordId: record.id, fieldId: priority.id, value: 5, expectedRevision: 2 },
          { recordId: record.id, fieldId: title.id, value: "Concurrency v2" },
        ],
      }),
      routeContext({ tableId: table.id }),
    )
    expect(batch.status).toBe(200)
    const batchBody = await readJson<{ revisions: Record<string, number> }>(batch)
    expect(batchBody.revisions[record.id]).toBe(3)

    const fetched = await recordGET(
      jsonRequest(`/api/records/${record.id}`, "GET"),
      routeContext({ recordId: record.id }),
    )
    const fetchedRecord = (await readJson<{ record: RecordDto }>(fetched)).record
    expect(fetchedRecord.values[priority.id]).toBe(5)
    expect(fetchedRecord.values[title.id]).toBe("Concurrency v2")
    expect(fetchedRecord.revision).toBe(3)

    const badField = await recordsBatchPATCH(
      jsonRequest(`/api/tables/${table.id}/records/batch`, "PATCH", {
        updates: [{ recordId: record.id, fieldId: "fld_missing", value: 1 }],
      }),
      routeContext({ tableId: table.id }),
    )
    expect(badField.status).toBe(400)
  })

  it("filters, sorts, and groups through records/query with unified view semantics", async () => {
    const { table, fieldByName } = await seededWorkspace()
    const status = fieldByName("Status")
    const budget = fieldByName("Budget")

    const query = await recordsQueryPOST(
      jsonRequest(`/api/tables/${table.id}/records/query`, "POST", {
        filterConjunction: "and",
        filters: [{ id: "f1", fieldId: status.id, operator: "is", value: "opt_done" }],
        sorts: [{ id: "s1", fieldId: budget.id, direction: "desc", rank: "a0" }],
        groups: [{ id: "g1", fieldId: status.id, direction: "asc", rank: "a0" }],
      }),
      routeContext({ tableId: table.id }),
    )
    expect(query.status).toBe(200)
    const queryBody = await readJson<{
      records: RecordDto[]
      totalCount: number
      groupLabelsByRecordId: Record<string, string>
      groups: Array<{ label: string; records: RecordDto[] }>
    }>(query)

    expect(queryBody.totalCount).toBe(2)
    expect(queryBody.records.map((record) => record.values[budget.id])).toEqual([
      54000, 36000,
    ])
    expect(queryBody.groups).toHaveLength(1)
    expect(queryBody.groups[0].label).toBe("Launched")
    expect(Object.values(queryBody.groupLabelsByRecordId)[0]).toContain("Status:")

    const searched = await recordsQueryPOST(
      jsonRequest(`/api/tables/${table.id}/records/query`, "POST", {
        search: "mobile onboarding",
      }),
      routeContext({ tableId: table.id }),
    )
    const searchedBody = await readJson<{ totalCount: number; records: RecordDto[] }>(
      searched,
    )
    expect(searchedBody.totalCount).toBe(1)
    expect(searchedBody.records[0].values[fieldByName("Project Name").id]).toBe(
      "Q4 Mobile Onboarding Redesign",
    )

    const limited = await recordsQueryPOST(
      jsonRequest(`/api/tables/${table.id}/records/query`, "POST", {
        limit: 2,
        offset: 1,
      }),
      routeContext({ tableId: table.id }),
    )
    const limitedBody = await readJson<{ totalCount: number; records: RecordDto[] }>(
      limited,
    )
    expect(limitedBody.totalCount).toBe(6)
    expect(limitedBody.records).toHaveLength(2)

    const deleted = await recordsDELETE(
      jsonRequest(`/api/tables/${table.id}/records`, "DELETE", {
        recordIds: queryBody.records.map((record) => record.id),
      }),
      routeContext({ tableId: table.id }),
    )
    expect(deleted.status).toBe(200)
    expect((await readJson<{ deleted: number }>(deleted)).deleted).toBe(2)

    const removed = await recordDELETE(
      jsonRequest(`/api/records/${queryBody.records[0].id}`, "DELETE"),
      routeContext({ recordId: queryBody.records[0].id }),
    )
    expect(removed.status).toBe(404)

    const restored = await recordRestorePOST(
      jsonRequest(`/api/records/${queryBody.records[0].id}/restore`, "POST"),
      routeContext({ recordId: queryBody.records[0].id }),
    )
    expect(restored.status).toBe(200)
    const afterRestore = await readJson<{ records: RecordDto[] }>(
      await recordsGET(
        jsonRequest(`/api/tables/${table.id}/records`, "GET"),
        routeContext({ tableId: table.id }),
      ),
    )
    expect(afterRestore.records).toHaveLength(5)
  })
})

describe("views", () => {
  it("validates all six view types and stores per-view field config", async () => {
    const { table, fieldByName } = await seededWorkspace()
    const status = fieldByName("Status")
    const budget = fieldByName("Budget")
    const startDate = fieldByName("Start Date")
    const endDate = fieldByName("End Date")
    const title = fieldByName("Project Name")

    const kanban = await viewsPOST(
      jsonRequest("/api/views", "POST", {
        tableId: table.id,
        name: "Pipeline",
        type: "kanban",
        configuration: { kanbanFieldId: status.id, kanbanSummaryFieldIds: [budget.id] },
      }),
    )
    expect(kanban.status).toBe(201)
    const kanbanBody = await readJson<{ view: { id: string; type: string } }>(kanban)
    expect(kanbanBody.view.type).toBe("kanban")

    const invalidKanban = await viewsPOST(
      jsonRequest("/api/views", "POST", {
        tableId: table.id,
        type: "kanban",
        configuration: { kanbanFieldId: title.id },
      }),
    )
    expect(invalidKanban.status).toBe(400)

    const calendar = await viewsPOST(
      jsonRequest("/api/views", "POST", {
        tableId: table.id,
        type: "calendar",
        configuration: { calendarDateFieldId: startDate.id, calendarDisplay: "month" },
      }),
    )
    expect(calendar.status).toBe(201)

    const invalidCalendar = await viewsPOST(
      jsonRequest("/api/views", "POST", {
        tableId: table.id,
        type: "calendar",
        configuration: { calendarDateFieldId: title.id },
      }),
    )
    expect(invalidCalendar.status).toBe(400)

    const timeline = await viewsPOST(
      jsonRequest("/api/views", "POST", {
        tableId: table.id,
        type: "timeline",
        configuration: { timelineStartFieldId: startDate.id, timelineEndFieldId: endDate.id },
      }),
    )
    expect(timeline.status).toBe(201)

    const gallery = await viewsPOST(
      jsonRequest("/api/views", "POST", {
        tableId: table.id,
        type: "gallery",
        configuration: { gallerySummaryFieldIds: [budget.id] },
      }),
    )
    expect(gallery.status).toBe(201)

    const tooManyWidgets = await viewsPOST(
      jsonRequest("/api/views", "POST", {
        tableId: table.id,
        type: "dashboard",
        configuration: {
          dashboardWidgets: Array.from({ length: 13 }, (_, index) => ({
            id: `w${index}`,
            kind: "metric",
            title: `Metric ${index}`,
            aggregate: "count",
          })),
        },
      }),
    )
    expect(tooManyWidgets.status).toBe(400)

    const dashboard = await viewsPOST(
      jsonRequest("/api/views", "POST", {
        tableId: table.id,
        type: "dashboard",
        configuration: {
          dashboardWidgets: [
            { id: "w_total", kind: "metric", title: "Total", aggregate: "count" },
            {
              id: "w_budget",
              kind: "chart",
              title: "Budget by status",
              fieldId: budget.id,
              groupByFieldId: status.id,
              aggregate: "sum",
              chartType: "bar",
            },
          ],
        },
      }),
    )
    expect(dashboard.status).toBe(201)

    const gridCreate = await viewsPOST(
      jsonRequest("/api/views", "POST", { tableId: table.id, name: "Scratch grid" }),
    )
    const gridBody = await readJson<{ view: { id: string; type: string; rank: string } }>(
      gridCreate,
    )
    expect(gridBody.view.type).toBe("grid")

    const renamed = await viewPATCH(
      jsonRequest(`/api/views/${gridBody.view.id}`, "PATCH", { name: "Scratch grid v2" }),
      routeContext({ viewId: gridBody.view.id }),
    )
    expect(renamed.status).toBe(200)
    expect((await readJson<{ view: { name: string } }>(renamed)).view.name).toBe(
      "Scratch grid v2",
    )

    const config = await viewFieldConfigPATCH(
      jsonRequest(`/api/views/${kanbanBody.view.id}/fields/${budget.id}`, "PATCH", {
        hidden: true,
        width: 240,
        formatting: { precision: 0 },
      }),
      routeContext({ viewId: kanbanBody.view.id, fieldId: budget.id }),
    )
    expect(config.status).toBe(200)
    const configBody = await readJson<{
      viewFieldConfig: { hidden: boolean; width: number; formatting: Json }
    }>(config)
    expect(configBody.viewFieldConfig.hidden).toBe(true)
    expect(configBody.viewFieldConfig.width).toBe(240)
    expect(configBody.viewFieldConfig.formatting).toEqual({ precision: 0 })

    const detail = await viewGET(
      jsonRequest(`/api/views/${kanbanBody.view.id}`, "GET"),
      routeContext({ viewId: kanbanBody.view.id }),
    )
    expect((await readJson<{ viewFieldConfigs: unknown[] }>(detail)).viewFieldConfigs).toHaveLength(1)

    const listed = await readJson<{ views: Array<{ type: string }> }>(
      await viewsGET(jsonRequest(`/api/views?tableId=${table.id}`, "GET")),
    )
    expect(listed.views.length).toBeGreaterThanOrEqual(10)

    const deleted = await viewDELETE(
      jsonRequest(`/api/views/${gridBody.view.id}`, "DELETE"),
      routeContext({ viewId: gridBody.view.id }),
    )
    expect(deleted.status).toBe(200)
  })
})

describe("attachments and images", () => {
  it("runs a session -> upload -> finalize -> download roundtrip with inline metadata", async () => {
    const { table, fieldByName } = await seededWorkspace()
    const title = fieldByName("Project Name")

    const imageFieldResponse = await fieldsPOST(
      jsonRequest(`/api/tables/${table.id}/fields`, "POST", { name: "Hero", type: "image" }),
      routeContext({ tableId: table.id }),
    )
    const imageField = (await readJson<{ field: FieldDto }>(imageFieldResponse)).field

    const recordResponse = await recordsPOST(
      jsonRequest(`/api/tables/${table.id}/records`, "POST", {
        values: { [title.id]: "Attachment host" },
      }),
      routeContext({ tableId: table.id }),
    )
    const record = (await readJson<{ record: RecordDto }>(recordResponse)).record

    const sessionResponse = await uploadSessionPOST(
      jsonRequest("/api/attachments/session", "POST", {
        tableId: table.id,
        fieldId: imageField.id,
        recordId: record.id,
      }),
    )
    expect(sessionResponse.status).toBe(201)
    const session = await readJson<{
      uploadSessionId: string
      uploadUrl: string
      expiresAt: string
      attachmentKind: string
    }>(sessionResponse)
    expect(session.attachmentKind).toBe("image")
    expect(session.uploadUrl).toBe(
      `/api/attachments/upload/${session.uploadSessionId}?attachmentKind=image`,
    )
    expect(Date.parse(session.expiresAt)).toBeGreaterThan(Date.now())

    const rejectedUpload = await uploadPUT(
      new Request(`${API}${session.uploadUrl}`, {
        method: "PUT",
        headers: { "content-type": "text/plain" },
        body: "not an image",
      }),
      routeContext({ sessionId: session.uploadSessionId }),
    )
    expect(rejectedUpload.status).toBe(400)

    const png = Buffer.from(PNG_BASE64, "base64")
    const uploadResponse = await uploadPUT(
      new Request(`${API}${session.uploadUrl}`, {
        method: "PUT",
        headers: { "content-type": "image/png", "x-file-name": "hero.png" },
        body: new Uint8Array(png),
      }),
      routeContext({ sessionId: session.uploadSessionId }),
    )
    expect(uploadResponse.status).toBe(201)
    const uploaded = await readJson<{
      storageId: string
      size: number
      mimeType: string
    }>(uploadResponse)
    expect(uploaded.size).toBe(png.byteLength)
    expect(uploaded.mimeType).toBe("image/png")
    expect(uploaded.storageId.startsWith(`${session.uploadSessionId}/`)).toBe(true)

    const finalizeResponse = await finalizePOST(
      jsonRequest("/api/attachments/finalize", "POST", {
        uploadSessionId: session.uploadSessionId,
        storageId: uploaded.storageId,
        name: "hero.png",
        mimeType: "image/png",
      }),
    )
    expect(finalizeResponse.status).toBe(201)
    const finalized = await readJson<{
      ok: boolean
      attachment: {
        id: string
        attachmentId: string
        name: string
        mimeType: string
        size: number
        url: string
      }
    }>(finalizeResponse)
    expect(finalized.ok).toBe(true)
    expect(finalized.attachment.url).toBe(`/api/files/${finalized.attachment.id}`)

    const storedCell = await recordPATCH(
      jsonRequest(`/api/records/${record.id}`, "PATCH", {
        values: {
          [imageField.id]: [
            {
              attachmentId: finalized.attachment.id,
              name: finalized.attachment.name,
              mimeType: finalized.attachment.mimeType,
              size: finalized.attachment.size,
            },
          ],
        },
      }),
      routeContext({ recordId: record.id }),
    )
    expect(storedCell.status).toBe(200)
    const storedRecord = (await readJson<{ record: RecordDto }>(storedCell)).record
    const inline = (storedRecord.values[imageField.id] as Array<Record<string, unknown>>)[0]
    expect(inline.url).toBe(`/api/files/${finalized.attachment.id}`)
    expect(inline.id).toBe(finalized.attachment.id)

    const listed = await readJson<{ attachments: Array<{ id: string; url: string }> }>(
      await attachmentsGET(
        jsonRequest(`/api/attachments?ids=${finalized.attachment.id}`, "GET"),
      ),
    )
    expect(listed.attachments).toHaveLength(1)
    expect(listed.attachments[0].url).toBe(`/api/files/${finalized.attachment.id}`)

    const download = await fileGET(
      jsonRequest(`/api/files/${finalized.attachment.id}`, "GET"),
      routeContext({ attachmentId: finalized.attachment.id }),
    )
    expect(download.status).toBe(200)
    expect(download.headers.get("content-type")).toBe("image/png")
    expect(download.headers.get("cache-control")).toBe("private, max-age=3600")
    const downloaded = Buffer.from(await download.arrayBuffer())
    expect(downloaded.equals(png)).toBe(true)

    const searchByName = await searchRecordsGET(
      jsonRequest("/api/search/records?q=hero.png", "GET"),
    )
    expect(searchByName.status).toBe(200)
    const searchBody = await readJson<{
      results: Array<{ recordId: string; matchedFieldIds: string[] }>
    }>(searchByName)
    expect(searchBody.results[0].recordId).toBe(record.id)
    expect(searchBody.results[0].matchedFieldIds).toContain(imageField.id)

    const deleted = await attachmentDELETE(
      jsonRequest(`/api/attachments/${finalized.attachment.id}`, "DELETE"),
      routeContext({ attachmentId: finalized.attachment.id }),
    )
    expect(deleted.status).toBe(200)

    const missing = await fileGET(
      jsonRequest(`/api/files/${finalized.attachment.id}`, "GET"),
      routeContext({ attachmentId: finalized.attachment.id }),
    )
    expect(missing.status).toBe(404)
  })

  it("supports anonymous uploads through a published public form only", async () => {
    const { base, table } = await seededWorkspace()
    const imageFieldResponse = await fieldsPOST(
      jsonRequest(`/api/tables/${table.id}/fields`, "POST", {
        name: "Public Cover",
        type: "image",
      }),
      routeContext({ tableId: table.id }),
    )
    const imageField = (await readJson<{ field: FieldDto }>(imageFieldResponse)).field

    const db = await getDb()
    const versionId = "fver_public_test"
    const formId = "frm_public_test"
    await db.insert(formsTable).values({
      id: formId,
      orgId: "local-org",
      baseId: base.id,
      tableId: table.id,
      name: "Public upload",
      slug: "public-upload-test",
      status: "published",
      publishedVersionId: versionId,
      createdBy: "local-user",
    })
    await db.insert(formVersionsTable).values({
      id: versionId,
      orgId: "local-org",
      formId,
      versionNumber: 1,
      title: "Public upload",
      publishedBy: "local-user",
    })
    await db.insert(formVersionFieldsTable).values({
      id: "fvf_public_test",
      orgId: "local-org",
      formVersionId: versionId,
      targetFieldId: imageField.id,
      targetFieldType: "image",
      label: "Cover",
      rank: "a0",
      fieldConfig: { attachmentKind: "image" },
    })

    process.env.FACTORY_VISITOR_AUTH_URL = "https://auth.test"
    process.env.FACTORY_VISITOR_AUTH_TOKEN = "token"
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ visitor: null }), { status: 401 }),
      )

    try {
      const unauthorized = await uploadSessionPOST(
        jsonRequest("/api/attachments/session", "POST", { tableId: table.id }),
      )
      expect(unauthorized.status).toBe(401)

      const unknownSlug = await uploadSessionPOST(
        jsonRequest("/api/attachments/session", "POST", { publicFormSlug: "nope" }),
      )
      expect(unknownSlug.status).toBe(404)

      const sessionResponse = await uploadSessionPOST(
        jsonRequest("/api/attachments/session", "POST", {
          publicFormSlug: "public-upload-test",
          tableId: table.id,
          fieldId: imageField.id,
        }),
      )
      expect(sessionResponse.status).toBe(201)
      const session = await readJson<{
        uploadSessionId: string
        uploadUrl: string
        expiresAt: string
        attachmentKind: string
      }>(sessionResponse)
      expect(session.attachmentKind).toBe("image")
      expect(session.uploadUrl).toContain("publicFormSlug=public-upload-test")
      expect(Date.parse(session.expiresAt) - Date.now()).toBeLessThanOrEqual(
        15 * 60 * 1000 + 1_000,
      )

      const fieldOutsideForm = await uploadSessionPOST(
        jsonRequest("/api/attachments/session", "POST", {
          publicFormSlug: "public-upload-test",
          fieldId: "fld_not_on_form",
        }),
      )
      expect(fieldOutsideForm.status).toBe(404)

      const png = Buffer.from(PNG_BASE64, "base64")
      const upload = await uploadPUT(
        new Request(`${API}${session.uploadUrl}`, {
          method: "PUT",
          headers: { "content-type": "image/png", "x-file-name": "public.png" },
          body: new Uint8Array(png),
        }),
        routeContext({ sessionId: session.uploadSessionId }),
      )
      expect(upload.status).toBe(201)
      const stored = await readJson<{ storageId: string; mimeType: string }>(upload)
      expect(stored.mimeType).toBe("image/png")

      const finalize = await finalizePOST(
        jsonRequest("/api/attachments/finalize", "POST", {
          publicFormSlug: "public-upload-test",
          uploadSessionId: session.uploadSessionId,
          storageId: stored.storageId,
          name: "public.png",
          mimeType: "image/png",
        }),
      )
      expect(finalize.status).toBe(201)
      const finalizedBody = await readJson<{ attachment: { id: string } }>(finalize)

      const download = await fileGET(
        jsonRequest(`/api/files/${finalizedBody.attachment.id}`, "GET"),
        routeContext({ attachmentId: finalizedBody.attachment.id }),
      )
      expect(download.status).toBe(200)
      expect(Buffer.from(await download.arrayBuffer()).equals(png)).toBe(true)

      await db
        .update(formsTable)
        .set({ status: "closed" })
        .where(eq(formsTable.id, formId))
      const closed = await uploadSessionPOST(
        jsonRequest("/api/attachments/session", "POST", {
          publicFormSlug: "public-upload-test",
          fieldId: imageField.id,
        }),
      )
      expect(closed.status).toBe(404)

      await db.insert(formsTable).values({
        id: "frm_draft_test",
        orgId: "local-org",
        baseId: base.id,
        tableId: table.id,
        name: "Draft upload",
        slug: "draft-upload-test",
        status: "draft",
        createdBy: "local-user",
      })
      const draft = await uploadSessionPOST(
        jsonRequest("/api/attachments/session", "POST", {
          publicFormSlug: "draft-upload-test",
        }),
      )
      expect(draft.status).toBe(404)
    } finally {
      fetchMock.mockRestore()
      delete process.env.FACTORY_VISITOR_AUTH_URL
      delete process.env.FACTORY_VISITOR_AUTH_TOKEN
    }
  })
})

describe("global record search", () => {
  it("matches text, Chinese words, select labels, currency, and multi-term queries", async () => {
    const { table, fieldByName } = await seededWorkspace()
    const title = fieldByName("Project Name")

    const tagResponse = await fieldsPOST(
      jsonRequest(`/api/tables/${table.id}/fields`, "POST", {
        name: "标签",
        type: "singleSelect",
        config: {
          options: [
            { id: "opt_high", label: "高优先级", color: "#ef4444" },
            { id: "opt_low", label: "低优先级", color: "#64748b" },
          ],
        },
      }),
      routeContext({ tableId: table.id }),
    )
    expect(tagResponse.status).toBe(201)
    const tag = (await readJson<{ field: FieldDto }>(tagResponse)).field

    const chineseRecordResponse = await recordsPOST(
      jsonRequest(`/api/tables/${table.id}/records`, "POST", {
        values: {
          [title.id]: "季度发布计划",
          [tag.id]: "opt_high",
        },
      }),
      routeContext({ tableId: table.id }),
    )
    const chineseRecord = (await readJson<{ record: RecordDto }>(chineseRecordResponse))
      .record

    const textSearch = await readJson<{
      results: Array<{
        recordId: string
        primaryLabel: string
        snippet: string
        matchedFieldIds: string[]
      }>
    }>(await searchRecordsGET(jsonRequest("/api/search/records?q=onboarding", "GET")))
    expect(textSearch.results).toHaveLength(1)
    expect(textSearch.results[0].primaryLabel).toBe("Q4 Mobile Onboarding Redesign")
    expect(textSearch.results[0].snippet).toContain("Onboarding")

    const chinese = await readJson<{
      results: Array<{ recordId: string; primaryLabel: string; snippet: string }>
    }>(
      await searchRecordsGET(
        jsonRequest(`/api/search/records?q=${encodeURIComponent("发布")}`, "GET"),
      ),
    )
    expect(chinese.results.map((result) => result.recordId)).toContain(chineseRecord.id)
    expect(chinese.results[0].snippet).toContain("季度发布计划")

    const label = await readJson<{
      results: Array<{ recordId: string; matchedFieldIds: string[] }>
    }>(
      await searchRecordsGET(
        jsonRequest(`/api/search/records?q=${encodeURIComponent("高优先级")}`, "GET"),
      ),
    )
    expect(label.results).toHaveLength(1)
    expect(label.results[0].recordId).toBe(chineseRecord.id)
    expect(label.results[0].matchedFieldIds).toContain(tag.id)

    const numeric = await readJson<{ results: Array<{ recordId: string }> }>(
      await searchRecordsGET(jsonRequest("/api/search/records?q=48000", "GET")),
    )
    expect(numeric.results).toHaveLength(1)

    const currency = await readJson<{ results: Array<Record<string, unknown>> }>(
      await searchRecordsGET(
        jsonRequest(`/api/search/records?q=${encodeURIComponent("$48,000")}`, "GET"),
      ),
    )
    expect(currency.results).toHaveLength(1)

    const multiTerm = await readJson<{ results: Array<{ primaryLabel: string }> }>(
      await searchRecordsGET(
        jsonRequest(`/api/search/records?q=${encodeURIComponent("billing metering")}`, "GET"),
      ),
    )
    expect(multiTerm.results[0].primaryLabel).toBe("Billing & Usage Metering")

    const scoped = await searchRecordsGET(
      jsonRequest(`/api/search/records?q=onboarding&tableId=tbl_unknown`, "GET"),
    )
    expect((await readJson<{ results: unknown[] }>(scoped)).results).toHaveLength(0)

    const limited = await searchRecordsGET(
      jsonRequest("/api/search/records?q=project&limit=2", "GET"),
    )
    expect((await readJson<{ results: unknown[] }>(limited)).results.length).toBeLessThanOrEqual(2)
  })

  it("searches base, table, view, and form names case-insensitively", async () => {
    await seededWorkspace()
    const workspace = await readJson<{
      bases: Array<{ name: string }>
      tables: Array<{ name: string; baseName: string }>
      views: Array<{ name: string; type: string }>
      forms: Array<{ name: string }>
    }>(await searchGET(jsonRequest("/api/search?q=project", "GET")))

    expect(workspace.tables.some((table) => table.name === "Project Tracker")).toBe(true)
    expect(workspace.forms.some((form) => form.name === "Project Intake Form")).toBe(true)
    expect(workspace.tables[0].baseName).toBe("Product Workspace")

    const views = await readJson<{ views: Array<{ type: string }> }>(
      await searchGET(jsonRequest("/api/search?q=STATUS%20BOARD", "GET")),
    )
    expect(views.views.some((view) => view.type === "kanban")).toBe(true)

    const empty = await readJson<{ bases: unknown[] }>(
      await searchGET(jsonRequest("/api/search?q=", "GET")),
    )
    expect(empty.bases).toHaveLength(0)
  })

  it("rebuilds searchText when single-select labels change", async () => {
    const { fieldByName } = await seededWorkspace()
    const status = fieldByName("Status")

    const before = await readJson<{ results: unknown[] }>(
      await searchRecordsGET(jsonRequest("/api/search/records?q=Launched", "GET")),
    )
    expect(before.results).toHaveLength(2)

    const patched = await fieldPATCH(
      jsonRequest(`/api/fields/${status.id}`, "PATCH", {
        config: {
          options: [
            { id: "opt_backlog", label: "Queue", color: "#64748b" },
            { id: "opt_in_progress", label: "Building", color: "#2563eb" },
            { id: "opt_review", label: "Checking", color: "#d97706" },
            { id: "opt_done", label: "Shipped", color: "#059669" },
          ],
        },
      }),
      routeContext({ fieldId: status.id }),
    )
    expect(patched.status).toBe(200)

    const after = await readJson<{ results: unknown[] }>(
      await searchRecordsGET(jsonRequest("/api/search/records?q=Shipped", "GET")),
    )
    expect(after.results).toHaveLength(2)

    const stale = await readJson<{ results: unknown[] }>(
      await searchRecordsGET(jsonRequest("/api/search/records?q=Launched", "GET")),
    )
    expect(stale.results).toHaveLength(0)
  })
})

describe("preferences", () => {
  it("stores favorites and recents per user", async () => {
    const { base, table } = await seededWorkspace()

    const favorite = await preferencesPATCH(
      jsonRequest("/api/preferences", "PATCH", {
        resourceType: "base",
        resourceId: base.id,
        favorited: true,
      }),
    )
    expect(favorite.status).toBe(200)
    const favoriteBody = await readJson<{
      preference: { name: string; favorited: boolean; resourceType: string }
    }>(favorite)
    expect(favoriteBody.preference.name).toBe("Product Workspace")
    expect(favoriteBody.preference.favorited).toBe(true)

    const recent = await preferencesPATCH(
      jsonRequest("/api/preferences", "PATCH", {
        resourceType: "table",
        resourceId: table.id,
        lastOpenedAt: new Date().toISOString(),
      }),
    )
    expect(recent.status).toBe(200)

    const listed = await readJson<{
      favorites: Array<{ name: string; favorited: boolean }>
      recent: Array<{ name: string; resourceType: string }>
    }>(await preferencesGET(jsonRequest("/api/preferences", "GET")))
    expect(listed.favorites).toHaveLength(1)
    expect(listed.favorites[0].name).toBe("Product Workspace")
    expect(listed.recent).toHaveLength(1)
    expect(listed.recent[0].name).toBe("Project Tracker")

    const missingResource = await preferencesPATCH(
      jsonRequest("/api/preferences", "PATCH", {
        resourceType: "base",
        resourceId: "base_missing",
        favorited: true,
      }),
    )
    expect(missingResource.status).toBe(404)
  })
})

describe("tenant isolation", () => {
  it("never leaks bases or tables from another organization", async () => {
    const { table } = await seededWorkspace()
    const db = await getDb()
    await db.insert(basesTable).values({
      id: "base_other",
      orgId: "other-org",
      name: "Other Base",
      rank: "a0",
      createdBy: "other-user",
    })
    await db.insert(tablesTable).values({
      id: "tbl_other",
      orgId: "other-org",
      baseId: "base_other",
      name: "Other Table",
      rank: "a0",
    })

    const ownTable = await tableGET(
      jsonRequest(`/api/tables/${table.id}`, "GET"),
      routeContext({ tableId: table.id }),
    )
    expect(ownTable.status).toBe(200)

    const otherTable = await tableGET(
      jsonRequest("/api/tables/tbl_other", "GET"),
      routeContext({ tableId: "tbl_other" }),
    )
    expect(otherTable.status).toBe(404)

    const otherBase = await baseGET(
      jsonRequest("/api/bases/base_other", "GET"),
      routeContext({ baseId: "base_other" }),
    )
    expect(otherBase.status).toBe(404)

    const otherRecords = await recordsGET(
      jsonRequest("/api/tables/tbl_other/records", "GET"),
      routeContext({ tableId: "tbl_other" }),
    )
    expect(otherRecords.status).toBe(404)

    const listed = await readJson<{ bases: Array<{ id: string }> }>(
      await basesGET(jsonRequest("/api/bases", "GET")),
    )
    expect(listed.bases.some((base) => base.id === "base_other")).toBe(false)
  })
})
