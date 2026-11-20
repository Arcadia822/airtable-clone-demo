import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi, type Mock } from "vitest"

import { useTableData, type TableBundleDto } from "@/hooks/use-table-data"
import type { CellValue, FieldDefinition, GridRecord } from "@/lib/domain"

const tableId = "tbl_demo"

const nameField: FieldDefinition = {
  id: "field_name",
  name: "Initiative",
  type: "singleLineText",
  config: {},
  rank: "a",
  width: 240,
  isPrimary: true,
}

const statusField: FieldDefinition = {
  id: "field_status",
  name: "Status",
  type: "singleSelect",
  config: {
    options: [
      { id: "option_planned", label: "Planned", color: "#64748B" },
      { id: "option_live", label: "Live", color: "#10B981" },
    ],
  },
  rank: "b",
  width: 160,
  isPrimary: false,
}

const coverField: FieldDefinition = {
  id: "field_cover",
  name: "Cover",
  type: "image",
  config: { attachmentKind: "image" },
  rank: "c",
  width: 200,
  isPrimary: false,
}

function makeRecord(
  id: string,
  values: Record<string, CellValue>,
  revision = 1,
): GridRecord {
  return {
    id,
    rank: id,
    values,
    revision,
    createdAt: 1,
    createdBy: "user_test",
    updatedAt: 1,
    updatedBy: "user_test",
  }
}

const bundle: TableBundleDto = {
  table: {
    id: tableId,
    baseId: "base_demo",
    name: "Demo",
    description: "",
    rank: "a0",
    createdAt: 1,
    updatedAt: 1,
  },
  fields: [nameField, statusField, coverField],
  views: [
    {
      id: "view_grid",
      tableId,
      name: "Grid",
      type: "grid",
      isDefault: true,
      visibility: "visible",
      rank: "a0",
      filterConjunction: "and",
      filters: [],
      sorts: [],
      groups: [],
      configuration: {},
    },
    {
      id: "view_board",
      tableId,
      name: "Board",
      type: "kanban",
      isDefault: false,
      visibility: "visible",
      rank: "a1",
      filterConjunction: "and",
      filters: [
        {
          id: "filter_live",
          fieldId: statusField.id,
          operator: "is",
          value: "option_live",
        },
      ],
      sorts: [],
      groups: [],
      configuration: { kanbanFieldId: statusField.id },
    },
  ],
  viewFieldConfigs: [],
}

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response
}

function queryResponse(records: GridRecord[]) {
  return {
    records,
    totalCount: records.length,
    groupLabelsByRecordId: {},
    groups: [],
  }
}

type FetchCall = {
  url: string
  method: string
  body: unknown
}

type FetchMock = Mock<
  (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
>

type BatchWriteOutcome =
  | { revisions: Array<{ recordId: string; revision: number }> }
  | { saved: false; message: string }

function fetchMock(
  handle: (call: FetchCall) => Response | Promise<Response>,
): FetchMock {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawBody = init?.body
    const body =
      typeof rawBody === "string" ? JSON.parse(rawBody) : (rawBody ?? null)
    return handle({
      url: String(input),
      method: init?.method ?? "GET",
      body,
    })
  })
}

function readBodies(calls: FetchCall[], suffix: string) {
  return calls.filter((call) => call.url.endsWith(suffix)).map((call) => call.body)
}

function recordedCalls(mock: FetchMock): FetchCall[] {
  return mock.mock.calls.map(([input, init]) => ({
    url: String(input),
    method: init?.method ?? "GET",
    body:
      typeof init?.body === "string" ? JSON.parse(init.body) : (init?.body ?? null),
  }))
}

async function renderTable(mock: FetchMock) {
  vi.stubGlobal("fetch", mock)
  const hook = renderHook(() => useTableData(tableId))
  await waitFor(() => expect(hook.result.current.records.length).toBeGreaterThan(0))
  return hook
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("useTableData writes", () => {
  it("rolls an optimistic cell back when the server rejects it", async () => {
    const record = makeRecord(
      "record_atlas",
      { field_name: "Atlas", field_status: "option_live" },
      4,
    )
    const writeGate = Promise.withResolvers<void>()
    const mock = fetchMock(async (call) => {
      if (call.url.endsWith("/records/query")) return jsonResponse(queryResponse([record]))
      if (call.url.endsWith("/records/batch")) {
        await writeGate.promise
        return jsonResponse({ code: "WRITE_FAILED", message: "Write rejected." }, 500)
      }
      return jsonResponse(bundle)
    })
    const { result } = await renderTable(mock)

    let pending: Promise<number | null> | undefined
    act(() => {
      pending = result.current.updateCell(
        record.id,
        nameField.id,
        "Atlas renamed",
        record.revision,
      )
    })
    expect(result.current.records[0]?.values[nameField.id]).toBe("Atlas renamed")

    await act(async () => {
      writeGate.resolve()
      expect(await pending).toBeNull()
    })

    expect(result.current.records[0]?.values[nameField.id]).toBe("Atlas")
    expect(result.current.error).toBe("Write rejected.")
    expect(result.current.syncing).toBe(false)
  })

  it("reuses the revision the server returned for the next write of a record", async () => {
    const record = makeRecord("record_atlas", { field_status: "option_planned" }, 4)
    const mock = fetchMock((call) => {
      if (call.url.endsWith("/records/query")) return jsonResponse(queryResponse([record]))
      if (call.url.endsWith("/records/batch")) {
        return jsonResponse({ revisions: { [record.id]: 5 } })
      }
      return jsonResponse(bundle)
    })
    const { result } = await renderTable(mock)

    let first: number | null = null
    await act(async () => {
      first = await result.current.updateCell(
        record.id,
        statusField.id,
        "option_live",
        4,
      )
      await result.current.updateCell(
        record.id,
        statusField.id,
        "option_planned",
        4,
      )
    })

    expect(first).toBe(5)
    const bodies = readBodies(recordedCalls(mock), "/records/batch") as Array<{
      updates: Array<{ expectedRevision: number }>
    }>
    expect(bodies.map((body) => body.updates[0]!.expectedRevision)).toEqual([4, 5])
    expect(result.current.records[0]?.revision).toBe(5)
  })

  it("restores every touched cell when a batch write fails", async () => {
    const record = makeRecord(
      "record_atlas",
      { field_name: "Atlas", field_status: "option_live" },
      4,
    )
    const mock = fetchMock((call) => {
      if (call.url.endsWith("/records/query")) return jsonResponse(queryResponse([record]))
      if (call.url.endsWith("/records/batch")) {
        return jsonResponse({ message: "Batch rejected." }, 409)
      }
      return jsonResponse(bundle)
    })
    const { result } = await renderTable(mock)

    let outcome: BatchWriteOutcome
    await act(async () => {
      outcome = await result.current.batchUpdateCells([
        {
          recordId: record.id,
          fieldId: nameField.id,
          value: "Changed",
          expectedRevision: record.revision,
        },
        {
          recordId: record.id,
          fieldId: statusField.id,
          value: "option_planned",
          expectedRevision: record.revision,
        },
      ])
    })

    expect("saved" in outcome! && outcome!.saved).toBe(false)
    expect(result.current.records[0]?.values).toMatchObject({
      field_name: "Atlas",
      field_status: "option_live",
    })
  })
})

describe("useTableData view retention", () => {
  it("keeps the active kanban view after adding and deleting a field", async () => {
    const record = makeRecord("record_atlas", { field_name: "Atlas" }, 2)
    const mock = fetchMock((call) => {
      if (call.url.endsWith("/records/query")) return jsonResponse(queryResponse([record]))
      if (call.url.endsWith("/fields")) {
        return jsonResponse({
          field: {
            ...nameField,
            id: "field_owner",
            name: "Owner",
            rank: "d",
          },
        })
      }
      if (call.method === "DELETE") return jsonResponse({ deleted: true })
      return jsonResponse(bundle)
    })
    const { result } = await renderTable(mock)

    await act(async () => {
      await result.current.selectView("view_board")
    })
    expect(result.current.activeViewId).toBe("view_board")

    await act(async () => {
      await result.current.addField({ name: "Owner", type: "singleLineText" })
    })
    expect(result.current.activeViewId).toBe("view_board")

    await act(async () => {
      await result.current.deleteField("field_owner")
    })
    expect(result.current.activeViewId).toBe("view_board")

    const queries = readBodies(recordedCalls(mock), "/records/query") as Array<{
      filters: Array<{ id: string }>
    }>
    // Every refresh after the switch must query the kanban view's filters.
    expect(queries.at(-1)?.filters).toEqual(bundle.views[1]!.filters)
    expect(queries.at(-1)?.filters.map((filter) => filter.id)).toEqual([
      "filter_live",
    ])
  })

  it("adopts the field the server returned instead of the request patch", async () => {
    const record = makeRecord("record_atlas", { field_name: "Atlas" }, 2)
    const renamed = { ...nameField, name: "Server name", width: 300 }
    const mock = fetchMock((call) => {
      if (call.url.endsWith("/records/query")) return jsonResponse(queryResponse([record]))
      if (call.method === "PATCH" && call.url.includes("/api/fields/")) {
        return jsonResponse({ field: renamed })
      }
      return jsonResponse(bundle)
    })
    const { result } = await renderTable(mock)

    await act(async () => {
      await result.current.renameField(nameField.id, "Client name")
    })

    const field = result.current.fields.find((candidate) => candidate.id === nameField.id)
    expect(field?.name).toBe("Server name")
    expect(field?.width).toBe(300)
  })
})

describe("useTableData mutations", () => {
  it("reports how many duplicates landed before a partial failure", async () => {
    const first = makeRecord("record_one", { field_name: "One" }, 1)
    const second = makeRecord("record_two", { field_name: "Two" }, 1)
    let created = 0
    const mock = fetchMock((call) => {
      if (call.url.endsWith("/records/query")) {
        return jsonResponse(queryResponse([first, second]))
      }
      if (call.method === "POST" && call.url.endsWith("/records")) {
        created += 1
        return created === 1
          ? jsonResponse({ record: { ...first, id: "record_copy" } }, 201)
          : jsonResponse({ message: "Quota exceeded." }, 500)
      }
      return jsonResponse(bundle)
    })
    const { result } = await renderTable(mock)

    let outcome: boolean | undefined
    await act(async () => {
      outcome = await result.current.duplicateRecords([first, second])
    })

    expect(outcome).toBe(false)
    expect(result.current.error).toBe(
      "Duplicated 1 of 2 records before the request failed. Quota exceeded.",
    )
    const queries = readBodies(recordedCalls(mock), "/records/query")
    // The copies that landed are re-read instead of being left invisible.
    expect(queries.length).toBe(2)
  })

  it("merges an upload against the server's current cell and revision", async () => {
    const existing = {
      id: "attachment_existing",
      name: "existing.png",
      mimeType: "image/png",
      size: 10,
      url: "https://example.test/existing.png",
    }
    const concurrentlyAdded = {
      id: "attachment_concurrent",
      name: "concurrent.png",
      mimeType: "image/png",
      size: 11,
      url: "https://example.test/concurrent.png",
    }
    const record = makeRecord(
      "record_atlas",
      { field_name: "Atlas", field_cover: [existing] },
      4,
    )
    const latest = makeRecord(
      "record_atlas",
      { field_name: "Atlas", field_cover: [existing, concurrentlyAdded] },
      9,
    )
    const mock = fetchMock((call) => {
      if (call.url.endsWith("/records/query")) return jsonResponse(queryResponse([record]))
      if (call.url.endsWith("/api/attachments/session")) {
        return jsonResponse({
          uploadSessionId: "session_1",
          uploadUrl: "/api/attachments/upload/session_1",
        })
      }
      if (call.url.endsWith("/api/attachments/upload/session_1")) {
        return jsonResponse({
          storageId: "storage_1",
          name: "chart.png",
          mimeType: "image/png",
        })
      }
      if (call.url.endsWith("/api/attachments/finalize")) {
        return jsonResponse({
          attachment: {
            id: "attachment_new",
            attachmentId: "attachment_new",
            name: "chart.png",
            mimeType: "image/png",
            size: 12,
            url: "/api/files/attachment_new",
          },
        })
      }
      if (call.method === "GET" && call.url.endsWith("/api/records/record_atlas")) {
        return jsonResponse({ record: latest })
      }
      if (call.url.endsWith("/records/batch")) {
        return jsonResponse({ revisions: { record_atlas: 10 } })
      }
      return jsonResponse(bundle)
    })
    const { result } = await renderTable(mock)

    await act(async () => {
      await result.current.uploadAttachments(
        { recordId: record.id, fieldId: coverField.id },
        [new File(["chart"], "chart.png", { type: "image/png" })],
      )
    })

    const bodies = readBodies(recordedCalls(mock), "/records/batch") as Array<{
      updates: Array<{
        expectedRevision: number
        value: Array<{ id: string }>
      }>
    }>
    expect(bodies).toHaveLength(1)
    expect(bodies[0]!.updates[0]!.expectedRevision).toBe(9)
    expect(bodies[0]!.updates[0]!.value.map((item) => item.id)).toEqual([
      "attachment_existing",
      "attachment_concurrent",
      "attachment_new",
    ])
    expect(result.current.records[0]?.revision).toBe(10)
  })

  it("guards an upload on the revision it read instead of a newer local one", async () => {
    const existing = {
      id: "attachment_existing",
      name: "existing.png",
      mimeType: "image/png",
      size: 10,
      url: "https://example.test/existing.png",
    }
    const record = makeRecord(
      "record_atlas",
      { field_name: "Atlas", field_cover: [existing] },
      4,
    )
    // The read the upload merges against was served before the queued rename
    // landed, so the server snapshot is still at revision 4.
    const snapshot = makeRecord(
      "record_atlas",
      { field_name: "Atlas", field_cover: [existing] },
      4,
    )
    let batchCalls = 0
    let queryCalls = 0
    const mock = fetchMock((call) => {
      if (call.url.endsWith("/records/query")) {
        queryCalls += 1
        return jsonResponse(queryResponse([record]))
      }
      if (call.url.endsWith("/api/attachments/session")) {
        return jsonResponse({
          uploadSessionId: "session_1",
          uploadUrl: "/api/attachments/upload/session_1",
        })
      }
      if (call.url.endsWith("/api/attachments/upload/session_1")) {
        return jsonResponse({
          storageId: "storage_1",
          name: "chart.png",
          mimeType: "image/png",
        })
      }
      if (call.url.endsWith("/api/attachments/finalize")) {
        return jsonResponse({
          attachment: {
            id: "attachment_new",
            attachmentId: "attachment_new",
            name: "chart.png",
            mimeType: "image/png",
            size: 12,
            url: "/api/files/attachment_new",
          },
        })
      }
      if (call.method === "GET" && call.url.endsWith("/api/records/record_atlas")) {
        return jsonResponse({ record: snapshot })
      }
      if (call.url.endsWith("/records/batch")) {
        batchCalls += 1
        return batchCalls === 1
          ? jsonResponse({ revisions: { record_atlas: 5 } })
          : jsonResponse(
              {
                code: "REVISION_CONFLICT",
                message: "This record was updated by someone else.",
              },
              409,
            )
      }
      return jsonResponse(bundle)
    })
    const { result } = await renderTable(mock)

    await act(async () => {
      await result.current.updateCell(record.id, nameField.id, "Atlas renamed", 4)
      await result.current.uploadAttachments(
        { recordId: record.id, fieldId: coverField.id },
        [new File(["chart"], "chart.png", { type: "image/png" })],
      )
    })

    const bodies = readBodies(recordedCalls(mock), "/records/batch") as Array<{
      updates: Array<{ expectedRevision: number; exactRevision?: boolean }>
    }>
    expect(bodies).toHaveLength(2)
    // Revision 5 is already known locally, but the merged cell came from the
    // revision-4 read: the guard must stay at 4 so the race is reported.
    expect(bodies[1]!.updates[0]!.expectedRevision).toBe(4)
    expect(bodies[1]!.updates[0]).not.toHaveProperty("exactRevision")
    expect(result.current.error).toBe("This record was updated by someone else.")
    // The conflict refreshed the grid instead of overwriting the other edit.
    expect(queryCalls).toBe(2)
    expect(result.current.records[0]?.values[coverField.id]).toEqual([existing])
  })
})
