import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { asc, eq } from "drizzle-orm"

import { fieldSequences, records as recordsTable } from "../../../drizzle/schema"
import { getDb, resetDbForTests } from "@/db/client"
import {
  MAX_RECORD_VALUE_BYTES,
  validateRecordValues,
} from "@/lib/cell-validation"
import { AppError } from "@/lib/domain"
import { allocateSequenceValues } from "@/server/services/tables"

import { GET as basesGET } from "@/app/api/bases/route"
import { GET as tableGET } from "@/app/api/tables/[tableId]/route"
import { POST as fieldsPOST } from "@/app/api/tables/[tableId]/fields/route"
import {
  GET as recordsGET,
  POST as recordsPOST,
} from "@/app/api/tables/[tableId]/records/route"
import { POST as recordsQueryPOST } from "@/app/api/tables/[tableId]/records/query/route"
import { PATCH as recordsBatchPATCH } from "@/app/api/tables/[tableId]/records/batch/route"
import {
  GET as recordGET,
  PATCH as recordPATCH,
} from "@/app/api/records/[recordId]/route"
import { GET as viewsGET, POST as viewsPOST } from "@/app/api/views/route"
import { PATCH as viewPATCH } from "@/app/api/views/[viewId]/route"

interface FieldDto {
  id: string
  name: string
  type: string
  config: Record<string, unknown>
}

interface RecordDto {
  id: string
  rank: string
  values: Record<string, unknown>
  revision: number
  createdAt: number
  updatedAt: number
}

interface ViewDto {
  id: string
  name: string
  type: string
  isDefault: boolean
}

const API = "http://localhost"

beforeEach(async () => {
  process.env.DATABASE_URL = "pglite:memory"
  await resetDbForTests()
})

afterEach(async () => {
  await resetDbForTests()
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
    bases: Array<{ id: string; tables: Array<{ id: string }> }>
  }>(response)
  const table = payload.bases[0].tables[0]

  const tableResponse = await tableGET(
    jsonRequest(`/api/tables/${table.id}`, "GET"),
    routeContext({ tableId: table.id }),
  )
  expect(tableResponse.status).toBe(200)
  const bundle = await readJson<{ fields: FieldDto[] }>(tableResponse)

  const fieldByName = (name: string): FieldDto => {
    const field = bundle.fields.find((candidate) => candidate.name === name)
    if (!field) throw new Error(`Missing seeded field ${name}`)
    return field
  }

  return { table, fields: bundle.fields, fieldByName }
}

async function listRecords(tableId: string): Promise<RecordDto[]> {
  const response = await recordsGET(
    jsonRequest(`/api/tables/${tableId}/records`, "GET"),
    routeContext({ tableId }),
  )
  expect(response.status).toBe(200)
  return (await readJson<{ records: RecordDto[] }>(response)).records
}

async function createRecord(
  tableId: string,
  values: Record<string, unknown>,
): Promise<RecordDto> {
  const response = await recordsPOST(
    jsonRequest(`/api/tables/${tableId}/records`, "POST", { values }),
    routeContext({ tableId }),
  )
  expect(response.status).toBe(201)
  return (await readJson<{ record: RecordDto }>(response)).record
}

async function fetchRecord(recordId: string): Promise<RecordDto> {
  const response = await recordGET(
    jsonRequest(`/api/records/${recordId}`, "GET"),
    routeContext({ recordId }),
  )
  expect(response.status).toBe(200)
  return (await readJson<{ record: RecordDto }>(response)).record
}

describe("optimistic concurrency", () => {
  it("lets exactly one of two competing cell writes win", async () => {
    const { table, fieldByName } = await seededWorkspace()
    const title = fieldByName("Project Name")
    const priority = fieldByName("Priority")
    const record = await createRecord(table.id, { [title.id]: "Race condition" })

    const [first, second] = await Promise.all([
      recordPATCH(
        jsonRequest(`/api/records/${record.id}`, "PATCH", {
          values: { [priority.id]: 1 },
          expectedRevision: 1,
        }),
        routeContext({ recordId: record.id }),
      ),
      recordPATCH(
        jsonRequest(`/api/records/${record.id}`, "PATCH", {
          values: { [priority.id]: 2 },
          expectedRevision: 1,
        }),
        routeContext({ recordId: record.id }),
      ),
    ])

    expect([first.status, second.status].sort()).toEqual([200, 409])
    const stale = first.status === 409 ? first : second
    const conflict = await readJson<{
      code: string
      details: { recordId: string; expectedRevision: number; actualRevision: number }
    }>(stale)
    expect(conflict.code).toBe("REVISION_CONFLICT")
    expect(conflict.details).toMatchObject({
      recordId: record.id,
      expectedRevision: 1,
      actualRevision: 2,
    })

    const winner = first.status === 200 ? first : second
    const winnerBody = await readJson<{ record: RecordDto }>(winner)
    expect(winnerBody.record.revision).toBe(2)

    const stored = await fetchRecord(record.id)
    expect(stored.revision).toBe(2)
    expect([1, 2]).toContain(stored.values[priority.id])
  })

  it("reports only revisions the batch actually committed", async () => {
    const { table, fieldByName } = await seededWorkspace()
    const title = fieldByName("Project Name")
    const priority = fieldByName("Priority")
    const status = fieldByName("Status")

    const first = await createRecord(table.id, { [title.id]: "Batch A" })
    const second = await createRecord(table.id, { [title.id]: "Batch B" })

    const applied = await recordsBatchPATCH(
      jsonRequest(`/api/tables/${table.id}/records/batch`, "PATCH", {
        updates: [
          { recordId: first.id, fieldId: priority.id, value: 2, expectedRevision: 1 },
          { recordId: second.id, fieldId: status.id, value: "opt_done" },
        ],
      }),
      routeContext({ tableId: table.id }),
    )
    expect(applied.status).toBe(200)
    const appliedBody = await readJson<{ revisions: Record<string, number> }>(applied)
    expect(appliedBody.revisions).toEqual({ [first.id]: 2, [second.id]: 2 })
    expect((await fetchRecord(first.id)).revision).toBe(2)
    expect((await fetchRecord(second.id)).revision).toBe(2)

    // One stale expectation must roll back the whole batch: the still-valid
    // record in the same batch must keep the revision it had before.
    const partial = await recordsBatchPATCH(
      jsonRequest(`/api/tables/${table.id}/records/batch`, "PATCH", {
        updates: [
          { recordId: second.id, fieldId: priority.id, value: 3, expectedRevision: 2 },
          { recordId: first.id, fieldId: priority.id, value: 4, expectedRevision: 1 },
        ],
      }),
      routeContext({ tableId: table.id }),
    )
    expect(partial.status).toBe(409)
    const partialBody = await readJson<{
      code: string
      details: { recordId: string; expectedRevision: number; actualRevision: number }
    }>(partial)
    expect(partialBody.code).toBe("REVISION_CONFLICT")
    expect(partialBody.details).toMatchObject({
      recordId: first.id,
      expectedRevision: 1,
      actualRevision: 2,
    })

    const untouched = await fetchRecord(second.id)
    expect(untouched.revision).toBe(2)
    expect(untouched.values[priority.id]).toBeUndefined()

    const retried = await recordsBatchPATCH(
      jsonRequest(`/api/tables/${table.id}/records/batch`, "PATCH", {
        updates: [
          { recordId: first.id, fieldId: priority.id, value: 4, expectedRevision: 2 },
        ],
      }),
      routeContext({ tableId: table.id }),
    )
    expect(retried.status).toBe(200)
    const retriedBody = await readJson<{ revisions: Record<string, number> }>(retried)
    expect(retriedBody.revisions[first.id]).toBe(3)
    expect((await fetchRecord(first.id)).revision).toBe(3)
  })

  it("hands out disjoint auto-number ranges under concurrency", async () => {
    const { table, fieldByName } = await seededWorkspace()
    const autoNumber = fieldByName("ID")
    const db = await getDb()

    const [left, right] = await Promise.all([
      allocateSequenceValues(db, table.id, [autoNumber.id], 2),
      allocateSequenceValues(db, table.id, [autoNumber.id], 2),
    ])
    const ranges = [
      [left[autoNumber.id], left[autoNumber.id] + 1],
      [right[autoNumber.id], right[autoNumber.id] + 1],
    ].sort((first, second) => first[0] - second[0])
    expect(ranges).toEqual([
      [7, 8],
      [9, 10],
    ])

    const title = fieldByName("Project Name")
    const later = await createRecord(table.id, { [title.id]: "After allocation" })
    expect(later.values[autoNumber.id]).toBe(11)

    const records = await listRecords(table.id)
    const numbers = records.map((record) => record.values[autoNumber.id])
    expect(new Set(numbers).size).toBe(numbers.length)
  })
})

describe("query pagination", () => {
  it("paginates in SQL and treats search wildcards literally", async () => {
    const { table, fieldByName } = await seededWorkspace()
    const title = fieldByName("Project Name")
    await createRecord(table.id, { [title.id]: "100% coverage" })
    await createRecord(table.id, { [title.id]: "100_ coverage" })

    const wildcardPercent = await recordsQueryPOST(
      jsonRequest(`/api/tables/${table.id}/records/query`, "POST", {
        search: "100%",
      }),
      routeContext({ tableId: table.id }),
    )
    expect(wildcardPercent.status).toBe(200)
    const percentBody = await readJson<{ totalCount: number; records: RecordDto[] }>(
      wildcardPercent,
    )
    expect(percentBody.totalCount).toBe(1)
    expect(percentBody.records[0].values[title.id]).toBe("100% coverage")

    const wildcardUnderscore = await recordsQueryPOST(
      jsonRequest(`/api/tables/${table.id}/records/query`, "POST", {
        search: "100_",
      }),
      routeContext({ tableId: table.id }),
    )
    const underscoreBody = await readJson<{ totalCount: number; records: RecordDto[] }>(
      wildcardUnderscore,
    )
    expect(underscoreBody.totalCount).toBe(1)
    expect(underscoreBody.records[0].values[title.id]).toBe("100_ coverage")

    const paged = await recordsQueryPOST(
      jsonRequest(`/api/tables/${table.id}/records/query`, "POST", {
        limit: 2,
        offset: 1,
      }),
      routeContext({ tableId: table.id }),
    )
    const pagedBody = await readJson<{ totalCount: number; records: RecordDto[] }>(paged)
    expect(pagedBody.totalCount).toBe(8)
    expect(pagedBody.records).toHaveLength(2)

    const searchedPage = await recordsQueryPOST(
      jsonRequest(`/api/tables/${table.id}/records/query`, "POST", {
        search: "coverage",
        limit: 1,
      }),
      routeContext({ tableId: table.id }),
    )
    const searchedPageBody = await readJson<{
      totalCount: number
      records: RecordDto[]
    }>(searchedPage)
    expect(searchedPageBody.totalCount).toBe(2)
    expect(searchedPageBody.records).toHaveLength(1)
  })

  it("keeps engine semantics for OR and text-equality filters", async () => {
    const { table, fieldByName } = await seededWorkspace()
    const budget = fieldByName("Budget")
    const priority = fieldByName("Priority")
    const title = fieldByName("Project Name")

    const query = async (body: unknown) => {
      const response = await recordsQueryPOST(
        jsonRequest(`/api/tables/${table.id}/records/query`, "POST", body),
        routeContext({ tableId: table.id }),
      )
      expect(response.status).toBe(200)
      return readJson<{ totalCount: number; records: RecordDto[] }>(response)
    }

    const budgetFilter = {
      id: "f1",
      fieldId: budget.id,
      operator: "greater_than",
      value: 50_000,
    }
    const priorityFilter = {
      id: "f2",
      fieldId: priority.id,
      operator: "greater_than",
      value: 2,
    }
    const budgetOnly = await query({ filters: [budgetFilter] })
    const priorityOnly = await query({ filters: [priorityFilter] })
    const either = await query({
      filterConjunction: "or",
      filters: [budgetFilter, priorityFilter],
    })
    const expectedIds = new Set([
      ...budgetOnly.records.map((record) => record.id),
      ...priorityOnly.records.map((record) => record.id),
    ])
    expect(either.totalCount).toBe(expectedIds.size)
    expect(new Set(either.records.map((record) => record.id))).toEqual(expectedIds)

    const named = await query({
      filters: [
        {
          id: "f3",
          fieldId: title.id,
          operator: "is",
          value: "  billing & usage metering  ",
        },
      ],
    })
    expect(named.totalCount).toBe(1)
    expect(named.records[0].values[title.id]).toBe("Billing & Usage Metering")
  })
})

describe("auto-number columns", () => {
  it("backfills in one transaction without bumping record revisions", async () => {
    const { table, fieldByName } = await seededWorkspace()
    const title = fieldByName("Project Name")
    const before = await listRecords(table.id)

    const created = await fieldsPOST(
      jsonRequest(`/api/tables/${table.id}/fields`, "POST", {
        name: "Ticket",
        type: "autoNumber",
      }),
      routeContext({ tableId: table.id }),
    )
    expect(created.status).toBe(201)
    const field = (await readJson<{ field: FieldDto }>(created)).field

    const after = await listRecords(table.id)
    expect(after).toHaveLength(before.length)
    expect(after.map((record) => record.revision)).toEqual(
      before.map((record) => record.revision),
    )
    expect(after.map((record) => record.values[field.id])).toEqual(
      before.map((_, index) => index + 1),
    )

    const db = await getDb()
    const [sequence] = await db
      .select()
      .from(fieldSequences)
      .where(eq(fieldSequences.fieldId, field.id))
      .limit(1)
    expect(sequence.nextValue).toBe(before.length + 1)

    const appended = await createRecord(table.id, { [title.id]: "Post backfill" })
    expect(appended.values[field.id]).toBe(before.length + 1)

    const rows = await db
      .select()
      .from(recordsTable)
      .where(eq(recordsTable.tableId, table.id))
      .orderBy(asc(recordsTable.rank))
    expect(rows.every((row) => row.revision === 1)).toBe(true)
  })
})

describe("saved view validation", () => {
  it("rejects malformed filters and non-numeric aggregates", async () => {
    const { table, fieldByName } = await seededWorkspace()
    const status = fieldByName("Status")
    const title = fieldByName("Project Name")
    const budget = fieldByName("Budget")

    const badFilter = await viewsPOST(
      jsonRequest("/api/views", "POST", {
        tableId: table.id,
        filters: [{ id: "f1", fieldId: status.id, operator: "roughly_equals" }],
      }),
    )
    expect(badFilter.status).toBe(400)

    const badSort = await viewsPOST(
      jsonRequest("/api/views", "POST", {
        tableId: table.id,
        sorts: [{ id: "s1", fieldId: status.id, direction: "up" }],
      }),
    )
    expect(badSort.status).toBe(400)

    const textualSum = await viewsPOST(
      jsonRequest("/api/views", "POST", {
        tableId: table.id,
        type: "dashboard",
        configuration: {
          dashboardWidgets: [
            {
              id: "w1",
              kind: "metric",
              title: "Sum of names",
              fieldId: title.id,
              aggregate: "sum",
            },
          ],
        },
      }),
    )
    expect(textualSum.status).toBe(400)

    const orphanPopulated = await viewsPOST(
      jsonRequest("/api/views", "POST", {
        tableId: table.id,
        type: "dashboard",
        configuration: {
          dashboardWidgets: [
            { id: "w2", kind: "metric", title: "Filled", aggregate: "populated" },
          ],
        },
      }),
    )
    expect(orphanPopulated.status).toBe(400)

    const valid = await viewsPOST(
      jsonRequest("/api/views", "POST", {
        tableId: table.id,
        name: "Budget filter",
        filters: [
          { id: "f2", fieldId: budget.id, operator: "greater_than", value: 40000 },
        ],
        sorts: [{ id: "s2", fieldId: budget.id, direction: "desc", rank: "a0" }],
        type: "dashboard",
        configuration: {
          dashboardWidgets: [
            {
              id: "w3",
              kind: "metric",
              title: "Budget total",
              fieldId: budget.id,
              aggregate: "sum",
            },
          ],
        },
      }),
    )
    expect(valid.status).toBe(201)
  })

  it("keeps exactly one default view per table when the flag is cleared", async () => {
    const { table } = await seededWorkspace()
    const created = await viewsPOST(
      jsonRequest("/api/views", "POST", {
        tableId: table.id,
        name: "Default candidate",
        isDefault: true,
      }),
    )
    expect(created.status).toBe(201)
    const candidate = (await readJson<{ view: ViewDto }>(created)).view
    expect(candidate.isDefault).toBe(true)

    const cleared = await viewPATCH(
      jsonRequest(`/api/views/${candidate.id}`, "PATCH", { isDefault: false }),
      routeContext({ viewId: candidate.id }),
    )
    expect(cleared.status).toBe(200)
    expect((await readJson<{ view: ViewDto }>(cleared)).view.isDefault).toBe(false)

    const listed = await readJson<{ views: ViewDto[] }>(
      await viewsGET(jsonRequest(`/api/views?tableId=${table.id}`, "GET")),
    )
    const defaults = listed.views.filter((view) => view.isDefault)
    expect(defaults).toHaveLength(1)
    expect(defaults[0].id).not.toBe(candidate.id)
  })
})

describe("cell payload limits", () => {
  it("measures the payload in UTF-8 bytes instead of UTF-16 length", () => {
    const field = {
      id: "fld_bytes",
      name: "Notes",
      type: "longText" as const,
      config: {},
    }

    const ascii = "x".repeat(100_000)
    expect(() => validateRecordValues({ [field.id]: ascii }, [field])).not.toThrow()

    const multiByte = "字".repeat(100_000)
    expect(multiByte.length).toBeLessThan(MAX_RECORD_VALUE_BYTES)
    try {
      validateRecordValues({ [field.id]: multiByte }, [field])
      throw new Error("expected the byte limit to reject the payload")
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe("VALIDATION_ERROR")
      expect((error as AppError).message).toContain("byte limit")
    }
  })
})

describe("rank ordering", () => {
  it("appends sixteen records in stable rank order", async () => {
    const { table, fieldByName } = await seededWorkspace()
    const title = fieldByName("Project Name")
    const appended: string[] = []
    for (let index = 0; index < 10; index += 1) {
      const name = `Appended ${index.toString().padStart(2, "0")}`
      appended.push(name)
      await createRecord(table.id, { [title.id]: name })
    }

    const records = await listRecords(table.id)
    expect(records).toHaveLength(16)
    const ranks = records.map((record) => record.rank)
    expect([...ranks].sort()).toEqual(ranks)
    expect(records.slice(6).map((record) => record.values[title.id])).toEqual(appended)
  })
})
