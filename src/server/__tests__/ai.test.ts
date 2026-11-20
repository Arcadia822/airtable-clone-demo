import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"

import {
  aiReports,
  bases,
  fields,
  fieldSequences,
  records,
  tables,
  views,
} from "../../../drizzle/schema"
import { getDb, resetDbForTests } from "@/db/client"
import { ensureSeededBase } from "@/db/seed"
import { AppError } from "@/lib/domain"
import type { AssistantStreamEvent } from "@/lib/eve/contracts"
import { POST as chatPOST } from "@/app/api/ai/chat/route"
import {
  GET as reportsGET,
  POST as reportsPOST,
} from "@/app/api/ai/reports/route"
import {
  DELETE as reportDELETE,
  GET as reportGET,
} from "@/app/api/ai/reports/[reportId]/route"
import { POST as readToolPOST } from "@/app/api/ai/tools/read/route"
import { POST as writeToolPOST } from "@/app/api/ai/tools/write/route"
import {
  callFactoryAi,
  isFactoryAiConfigured,
} from "@/server/ai/gateway"
import {
  buildWriteProposal,
  describeTable,
  type AiToolContext,
  type SummarizeTableOutput,
} from "@/server/ai/tools"
import type { AuthenticatedSession } from "@/server/auth"

const FACTORY_AI_URL = "https://ai.factory.test/app-ai"
const FACTORY_AI_TOKEN = "test-app-ai-token"

const session: AuthenticatedSession = {
  authenticated: true,
  authMode: "local",
  email: "local@factory.local",
  name: "Local Workspace",
  orgId: "local-org",
  userId: "local-user",
}

describe("Factory managed AI", () => {
  beforeEach(async () => {
    process.env.DATABASE_URL = "pglite:memory"
    delete process.env.FACTORY_VISITOR_AUTH_URL
    delete process.env.FACTORY_VISITOR_AUTH_TOKEN
    delete process.env.FACTORY_PREVIEW_HOST
    delete process.env.LLM_GATEWAY_BASE_URL
    delete process.env.LLM_GATEWAY_API_KEY
    delete process.env.LLM_GATEWAY_MODEL
    process.env.FACTORY_APP_AI_URL = FACTORY_AI_URL
    process.env.FACTORY_APP_AI_TOKEN = FACTORY_AI_TOKEN
    await resetDbForTests()
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete process.env.FACTORY_APP_AI_URL
    delete process.env.FACTORY_APP_AI_TOKEN
    delete process.env.LLM_GATEWAY_BASE_URL
    delete process.env.LLM_GATEWAY_API_KEY
    delete process.env.LLM_GATEWAY_MODEL
    await resetDbForTests()
  })

  it("calls the Factory app-ai protocol with the exact request shape", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        { data: { text: "Total budget " }, event: "delta" },
        { data: { text: "is 48,000." }, event: "delta" },
        {
          data: {
            requestId: "req_gateway_0001",
            usage: { inputTokens: 21, outputTokens: 7 },
          },
          event: "done",
        },
      ]),
    )
    vi.stubGlobal("fetch", fetchMock)

    expect(isFactoryAiConfigured()).toBe(true)

    const messages = [{ content: "Summarize the budget", role: "user" as const }]
    const schema = { type: "object", properties: { answer: { type: "string" } } }
    const result = await callFactoryAi({
      lastEventId: "evt_42",
      messages,
      requestId: "req_gateway_0001",
      schema,
    })

    expect(result.text).toBe("Total budget is 48,000.")
    expect(result.requestId).toBe("req_gateway_0001")
    expect(result.usage).toEqual({ inputTokens: 21, outputTokens: 7 })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe(FACTORY_AI_URL)
    expect(init.method).toBe("POST")
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${FACTORY_AI_TOKEN}`)
    expect(headers["Content-Type"]).toBe("application/json")
    expect(headers["Last-Event-ID"]).toBe("evt_42")
    expect(JSON.parse(String(init.body))).toEqual({
      messages,
      requestId: "req_gateway_0001",
      schema,
    })
  })

  it("omits the schema field when no schema is requested", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        { data: { requestId: "req_gateway_0002" }, event: "done" },
      ]),
    )
    vi.stubGlobal("fetch", fetchMock)

    await callFactoryAi({
      messages: [{ content: "hi", role: "user" }],
      requestId: "req_gateway_0002",
    })

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      messages: [{ content: "hi", role: "user" }],
      requestId: "req_gateway_0002",
    })
  })

  it("turns error frames into plain-language failures without provider details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          {
            data: {
              error: {
                code: "credits-exhausted",
                message: "openai 429 insufficient_quota for sk-live-secret",
                provider: "openai",
              },
            },
            event: "error",
          },
        ]),
      ),
    )

    await expect(
      callFactoryAi({
        messages: [{ content: "hi", role: "user" }],
        requestId: "req_gateway_0003",
      }),
    ).rejects.toMatchObject({
      code: "credits-exhausted",
      retryable: false,
    })

    try {
      await callFactoryAi({
        messages: [{ content: "hi", role: "user" }],
        requestId: "req_gateway_0003",
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      expect(message).toBe(
        "This workspace has used all of its AI credits. A workspace admin can add more.",
      )
      expect(message.toLowerCase()).not.toContain("openai")
      expect(message).not.toContain("sk-live")
    }
  })

  it("surfaces request-pending as a retryable failure for the same request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "request-pending", requestId: "req_pending_01" }), {
          headers: { "content-type": "application/json" },
          status: 409,
        }),
      ),
    )

    await expect(
      callFactoryAi({
        messages: [{ content: "hi", role: "user" }],
        requestId: "req_pending_01",
      }),
    ).rejects.toMatchObject({
      code: "request-pending",
      requestId: "req_pending_01",
      retryable: true,
    })
  })

  it("uses the explicit OpenAI-compatible gateway only when Factory AI is unset", async () => {
    delete process.env.FACTORY_APP_AI_URL
    delete process.env.FACTORY_APP_AI_TOKEN
    process.env.LLM_GATEWAY_BASE_URL = "https://llm.example.test/v1"
    process.env.LLM_GATEWAY_API_KEY = "llm-gateway-key"
    process.env.LLM_GATEWAY_MODEL = "demo-model"

    const fetchMock = vi.fn(
      async () =>
        new Response(
          [
            'data: {"choices":[{"delta":{"content":"Hi "}}]}',
            'data: {"choices":[{"delta":{"content":"there"}}]}',
            "data: [DONE]",
            "",
          ].join("\n\n"),
          { headers: { "content-type": "text/event-stream" } },
        ),
    )
    vi.stubGlobal("fetch", fetchMock)

    const result = await callFactoryAi({
      messages: [{ content: "hi", role: "user" }],
      requestId: "req_fallback_0001",
    })
    expect(result.text).toBe("Hi there")

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://llm.example.test/v1/chat/completions")
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe("Bearer llm-gateway-key")
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "demo-model",
      stream: true,
    })
  })

  it("prefers Factory AI over the OpenAI-compatible fallback", async () => {
    process.env.LLM_GATEWAY_BASE_URL = "https://llm.example.test/v1"
    process.env.LLM_GATEWAY_API_KEY = "llm-gateway-key"
    process.env.LLM_GATEWAY_MODEL = "demo-model"

    const fetchMock = vi.fn(async () =>
      sseResponse([{ data: { requestId: "req_prefer_0001" }, event: "done" }]),
    )
    vi.stubGlobal("fetch", fetchMock)

    await callFactoryAi({
      messages: [{ content: "hi", role: "user" }],
      requestId: "req_prefer_0001",
    })

    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(FACTORY_AI_URL)
  })

  it("reports an honest ai-unavailable error when nothing is configured", async () => {
    delete process.env.FACTORY_APP_AI_URL
    delete process.env.FACTORY_APP_AI_TOKEN
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    expect(isFactoryAiConfigured()).toBe(false)
    await expect(
      callFactoryAi({
        messages: [{ content: "hi", role: "user" }],
        requestId: "req_unconfigured",
      }),
    ).rejects.toMatchObject({ code: "ai-unavailable" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("previews create_table without writing, then applies it through the write route", async () => {
    const db = await getDb()
    const seeded = await ensureSeededBase(db, session.orgId, session.userId)
    const ctx: AiToolContext = { db, session }

    const tablesBefore = await db.select().from(tables).where(eq(tables.orgId, session.orgId))
    const fieldsBefore = await db.select().from(fields).where(eq(fields.orgId, session.orgId))

    const input = {
      baseId: seeded.baseId,
      name: "客户跟进表",
      description: "Track sales follow-ups",
      fields: [
        { name: "客户名称", type: "singleLineText" },
        {
          config: { options: ["线索", "跟进中", "已成交", "已流失"] },
          name: "状态",
          type: "singleSelect",
        },
        { config: { currency: "CNY", precision: 0 }, name: "金额", type: "currency" },
        { name: "序号", type: "autoNumber" },
        { config: { dateStyle: "date" }, name: "跟进日期", type: "date" },
        { config: { dateStyle: "date" }, name: "下次跟进", type: "date" },
      ],
      sampleRows: [
        {
          金额: 12800,
          下次跟进: "2026-11-28",
          客户名称: "Acme Ltd",
          序号: 1,
          状态: "跟进中",
          跟进日期: "2026-11-12",
        },
        {
          金额: 42000,
          客户名称: "Globex",
          状态: "已成交",
          跟进日期: "2026-11-05",
        },
      ],
    }

    const proposal = await buildWriteProposal(ctx, "create_table", input)
    expect(proposal.requiresApproval).toBe(true)
    expect(proposal.operation).toBe("create_table")
    expect(proposal.summary).toContain("6 columns")
    expect(proposal.diff.some((row) => row.label === "Views")).toBe(true)

    expect(
      await db.select().from(tables).where(eq(tables.orgId, session.orgId)),
    ).toHaveLength(tablesBefore.length)
    expect(
      await db.select().from(fields).where(eq(fields.orgId, session.orgId)),
    ).toHaveLength(fieldsBefore.length)

    const response = await writeToolPOST(
      jsonRequest("/api/ai/tools/write", {
        input: proposal.input,
        operation: proposal.operation,
      }),
    )
    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      ok: boolean
      result: {
        entityIds: { baseId: string; tableId: string }
        result: { fieldCount: number; href: string; recordCount: number }
        summary: string
      }
    }
    expect(payload.ok).toBe(true)

    const tableId = payload.result.entityIds.tableId
    const [tableRow] = await db.select().from(tables).where(eq(tables.id, tableId))
    expect(tableRow.name).toBe("客户跟进表")
    expect(tableRow.baseId).toBe(seeded.baseId)

    const fieldRows = await db
      .select()
      .from(fields)
      .where(eq(fields.tableId, tableId))
    expect(fieldRows).toHaveLength(6)

    const autoField = fieldRows.find((row) => row.name === "序号")
    const currencyField = fieldRows.find((row) => row.name === "金额")
    const statusField = fieldRows.find((row) => row.name === "状态")
    expect(autoField?.type).toBe("autoNumber")
    expect(currencyField?.type).toBe("currency")
    expect(currencyField?.config).toMatchObject({ currency: "CNY" })
    expect(
      ((statusField?.config as { options?: unknown[] }).options ?? []).length,
    ).toBe(4)

    const sequenceRows = await db
      .select()
      .from(fieldSequences)
      .where(eq(fieldSequences.tableId, tableId))
    expect(sequenceRows).toHaveLength(1)
    expect(sequenceRows[0].fieldId).toBe(autoField?.id)
    expect(sequenceRows[0].nextValue).toBe(3)

    const viewRows = await db
      .select()
      .from(views)
      .where(eq(views.tableId, tableId))
    const viewTypes = viewRows.map((row) => row.type).sort()
    expect(viewTypes).toContain("grid")
    expect(viewTypes).toContain("kanban")
    expect(viewTypes).toContain("timeline")
    expect(viewTypes).toContain("dashboard")
    expect(viewRows.find((row) => row.type === "grid")?.isDefault).toBe(true)

    const recordRows = await db
      .select()
      .from(records)
      .where(eq(records.tableId, tableId))
    expect(recordRows).toHaveLength(2)
    for (const record of recordRows) {
      expect(record.searchText.length).toBeGreaterThan(0)
      expect(record.revision).toBe(1)
    }
    const autoValues = recordRows
      .map((record) => (record.values as Record<string, unknown>)[autoField!.id])
      .sort()
    expect(autoValues).toEqual([1, 2])

    expect(payload.result.result.href).toBe(
      `/bases/${seeded.baseId}/tables/${tableId}`,
    )
    expect(payload.result.result.recordCount).toBe(2)
  })

  it("updates a record and rejects stale revisions with 409", async () => {
    const db = await getDb()
    const seeded = await ensureSeededBase(db, session.orgId, session.userId)
    const ctx: AiToolContext = { db, session }

    const described = await describeTable(ctx, {
      baseId: seeded.baseId,
      tableId: seeded.tableId,
    })
    const primary = described.table.fields.find((field) => field.name === "Project Name")
    expect(primary).toBeDefined()

    const [record] = await db
      .select()
      .from(records)
      .where(eq(records.tableId, seeded.tableId))
      .limit(1)

    const proposal = await buildWriteProposal(ctx, "update_record", {
      baseId: seeded.baseId,
      changes: [
        {
          after: "Renamed launch",
          before: (record.values as Record<string, unknown>)[primary!.id] ?? null,
          fieldId: primary!.id,
          fieldName: primary!.name,
        },
      ],
      expectedVersion: record.revision,
      recordId: record.id,
      tableId: seeded.tableId,
    })
    expect(proposal.diff.some((row) => row.after === "Renamed launch")).toBe(true)

    const response = await writeToolPOST(
      jsonRequest("/api/ai/tools/write", {
        input: proposal.input,
        operation: proposal.operation,
      }),
    )
    expect(response.status).toBe(200)

    const [updated] = await db
      .select()
      .from(records)
      .where(eq(records.id, record.id))
    expect((updated.values as Record<string, unknown>)[primary!.id]).toBe(
      "Renamed launch",
    )
    expect(updated.revision).toBe(record.revision + 1)
    expect(updated.searchText).toContain("renamed launch")

    const stale = await writeToolPOST(
      jsonRequest("/api/ai/tools/write", {
        input: { ...proposal.input, expectedVersion: record.revision },
        operation: "update_record",
      }),
    )
    expect(stale.status).toBe(409)
  })

  it("computes real summaries and grouped chart series from stored records", async () => {
    const db = await getDb()
    const seeded = await ensureSeededBase(db, session.orgId, session.userId)
    const ctx: AiToolContext = { db, session }

    const described = await describeTable(ctx, {
      baseId: seeded.baseId,
      tableId: seeded.tableId,
    })
    const statusField = described.table.fields.find((field) => field.name === "Status")
    const budgetField = described.table.fields.find((field) => field.name === "Budget")
    expect(statusField).toBeDefined()
    expect(budgetField).toBeDefined()

    const response = await readToolPOST(
      jsonRequest("/api/ai/tools/read", {
        input: {
          baseId: seeded.baseId,
          fieldIds: [statusField!.id, budgetField!.id],
          groupByFieldId: statusField!.id,
          tableId: seeded.tableId,
        },
        tool: "summarize_table",
      }),
    )
    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      ok: boolean
      result: SummarizeTableOutput
    }
    const summary = payload.result

    expect(summary.recordCount).toBe(6)
    const budget = summary.summaries.find(
      (entry) => entry.fieldId === budgetField!.id,
    )
    expect(budget?.populatedCount).toBe(6)
    expect(budget?.total).toBe(329_000)
    expect(budget?.average).toBeCloseTo(329_000 / 6, 4)
    expect(budget?.minimum).toBe(24_000)
    expect(budget?.maximum).toBe(95_000)

    const status = summary.summaries.find(
      (entry) => entry.fieldId === statusField!.id,
    )
    expect(status?.distinctCount).toBe(4)
    expect(
      status?.topValues?.find((entry) => entry.value === "In Progress")?.count,
    ).toBe(2)

    expect(summary.grouped).toHaveLength(4)
    expect(
      summary.grouped?.reduce((total, entry) => total + entry.value, 0),
    ).toBe(6)
    expect(
      summary.grouped?.find((entry) => entry.label === "Launched")?.value,
    ).toBe(2)
    expect(
      summary.grouped?.find((entry) => entry.label === "In Progress")?.value,
    ).toBe(2)
    expect(summary.truncated).toBe(false)
  })

  it("round-trips saved AI reports through the reports routes", async () => {
    const db = await getDb()
    const seeded = await ensureSeededBase(db, session.orgId, session.userId)

    const createResponse = await reportsPOST(
      jsonRequest("/api/ai/reports", {
        baseId: seeded.baseId,
        chart: {
          data: [
            { label: "In Progress", value: 2 },
            { label: "Launched", value: 2 },
          ],
          title: "Project Tracker by Status",
          type: "bar",
          xLabel: "Status",
          yLabel: "Records",
        },
        citations: [],
        content: "Facts from workspace data\nSix projects.\n\nInterpretation\nHalf shipped.",
        format: "chart",
        name: "Project Tracker analysis",
        scopeLabel: "Product Workspace › Project Tracker",
        tableId: seeded.tableId,
      }),
    )
    expect(createResponse.status).toBe(201)
    const created = (await createResponse.json()) as {
      report: { id: string; name: string; chart: { title: string } | null }
    }
    expect(created.report.name).toBe("Project Tracker analysis")
    expect(created.report.chart?.title).toBe("Project Tracker by Status")

    const listResponse = await reportsGET(
      new Request(
        `http://localhost:3000/api/ai/reports?baseId=${seeded.baseId}`,
      ),
    )
    expect(listResponse.status).toBe(200)
    const listed = (await listResponse.json()) as { reports: Array<{ id: string }> }
    expect(listed.reports.map((report) => report.id)).toContain(created.report.id)

    const savedRows = await db
      .select()
      .from(aiReports)
      .where(eq(aiReports.orgId, session.orgId))
    expect(savedRows).toHaveLength(1)
    expect(savedRows[0].createdBy).toBe(session.userId)

    const detailResponse = await reportGET(
      new Request(`http://localhost:3000/api/ai/reports/${created.report.id}`),
      { params: Promise.resolve({ reportId: created.report.id }) },
    )
    expect(detailResponse.status).toBe(200)

    const deleteResponse = await reportDELETE(
      new Request(`http://localhost:3000/api/ai/reports/${created.report.id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ reportId: created.report.id }) },
    )
    expect(deleteResponse.status).toBe(200)

    const afterDelete = await reportsGET(
      new Request(`http://localhost:3000/api/ai/reports?baseId=${seeded.baseId}`),
    )
    const afterDeleteJson = (await afterDelete.json()) as {
      reports: Array<{ id: string }>
    }
    expect(afterDeleteJson.reports).toHaveLength(0)

    const archivedDetail = await reportGET(
      new Request(`http://localhost:3000/api/ai/reports/${created.report.id}`),
      { params: Promise.resolve({ reportId: created.report.id }) },
    )
    expect(archivedDetail.status).toBe(404)
  })

  it("streams an approval-gated create_table proposal without mutating the database", async () => {
    const db = await getDb()
    const seeded = await ensureSeededBase(db, session.orgId, session.userId)

    const action = {
      input: {
        baseId: seeded.baseId,
        description: "Pipeline follow-ups",
        fields: [
          { name: "客户名称", type: "singleLineText" },
          { config: { options: ["线索", "跟进中", "已成交"] }, name: "状态", type: "singleSelect" },
          { config: { currency: "CNY" }, name: "金额", type: "currency" },
          { name: "序号", type: "autoNumber" },
        ],
        name: "客户跟进表",
        sampleRows: [
          { 客户名称: "Acme", 状态: "跟进中", 金额: 9800 },
          { 客户名称: "Globex", 状态: "已成交", 金额: 54000 },
        ],
      },
      operation: "create_table",
    }

    const fetchMock = vi.fn(async () =>
      sseResponse([
        { data: { text: JSON.stringify(action) }, event: "delta" },
        {
          data: { requestId: "req_chat_proposal_1", usage: { outputTokens: 42 } },
          event: "done",
        },
      ]),
    )
    vi.stubGlobal("fetch", fetchMock)

    const tablesBefore = await db
      .select()
      .from(tables)
      .where(eq(tables.orgId, session.orgId))

    const response = await chatPOST(
      jsonRequest("/api/ai/chat", {
        context: {
          base: { id: seeded.baseId, name: "Product Workspace" },
          table: { id: seeded.tableId, name: "Project Tracker" },
        },
        messages: [
          {
            content: "帮我建一张客户跟进表（含状态、金额、序号、跟进日期）",
            role: "user",
          },
        ],
        requestId: "req_chat_proposal_1",
      }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")

    const events = parseEvents(await response.text())
    const types = events.map((event) => event.type)
    expect(types).toContain("tool_result")
    expect(types).toContain("proposal")
    expect(types).toContain("done")

    const proposalEvent = events.find((event) => event.type === "proposal")
    if (proposalEvent?.type !== "proposal") {
      throw new Error("Expected a proposal event")
    }
    expect(proposalEvent.proposal.operation).toBe("create_table")
    expect(proposalEvent.proposal.requiresApproval).toBe(true)
    expect(proposalEvent.proposal.diff.length).toBeGreaterThan(0)

    const tablesAfter = await db
      .select()
      .from(tables)
      .where(eq(tables.orgId, session.orgId))
    expect(tablesAfter).toHaveLength(tablesBefore.length)

    const [sentUrl, sentInit] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(sentUrl).toBe(FACTORY_AI_URL)
    const sentBody = JSON.parse(String(sentInit.body)) as {
      requestId: string
      schema?: Record<string, unknown>
    }
    expect(sentBody.requestId).toBe("req_chat_proposal_1")
    expect(sentBody.schema).toBeDefined()
    expect(JSON.stringify(sentBody.schema)).toContain("create_table")
  })

  it("streams verified analysis text, a chart, and citations", async () => {
    const db = await getDb()
    const seeded = await ensureSeededBase(db, session.orgId, session.userId)

    const fetchMock = vi.fn(async () =>
      sseResponse([
        {
          data: {
            text: "Facts from workspace data\nSix projects are tracked.\n\nInterpretation\nTwo have shipped.\n\nLimitations\nBudget is self-reported.",
          },
          event: "delta",
        },
        { data: { requestId: "req_chat_analysis_1" }, event: "done" },
      ]),
    )
    vi.stubGlobal("fetch", fetchMock)

    const response = await chatPOST(
      jsonRequest("/api/ai/chat", {
        context: {
          base: { id: seeded.baseId, name: "Product Workspace" },
          table: { id: seeded.tableId, name: "Project Tracker" },
        },
        messages: [{ content: "分析当前表的数据分布和关键指标", role: "user" }],
        requestId: "req_chat_analysis_1",
      }),
    )
    expect(response.status).toBe(200)

    const events = parseEvents(await response.text())
    const deltaText = events
      .filter((event) => event.type === "delta")
      .map((event) => (event.type === "delta" ? event.text : ""))
      .join("")
    expect(deltaText).toContain("Facts from workspace data")

    const chartEvent = events.find((event) => event.type === "chart")
    if (chartEvent?.type !== "chart") {
      throw new Error("Expected a chart event")
    }
    expect(chartEvent.chart.type).toBe("bar")
    expect(chartEvent.chart.data.length).toBeGreaterThan(0)

    const doneEvent = events.find((event) => event.type === "done")
    if (doneEvent?.type !== "done") {
      throw new Error("Expected a done event")
    }
    expect(doneEvent.citations[0]?.href).toBe(
      `/bases/${seeded.baseId}/tables/${seeded.tableId}`,
    )

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const sent = JSON.parse(String(init.body)) as {
      messages: Array<{ content: string; role: string }>
      schema?: unknown
    }
    expect(sent.messages[0].content).toContain("Facts from workspace data")
    expect(sent.messages[0].content).toContain("Project Tracker")
    expect(sent.schema).toBeUndefined()
  })

  it("rejects unauthenticated write calls", async () => {
    const db = await getDb()
    await ensureSeededBase(db, session.orgId, session.userId)
    process.env.FACTORY_VISITOR_AUTH_URL = "https://auth.factory.test"
    process.env.FACTORY_VISITOR_AUTH_TOKEN = "auth-token"

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 })),
    )

    const response = await writeToolPOST(
      jsonRequest("/api/ai/tools/write", {
        input: { baseId: "base_missing" },
        operation: "create_table",
      }),
    )
    expect(response.status).toBe(401)

    delete process.env.FACTORY_VISITOR_AUTH_URL
    delete process.env.FACTORY_VISITOR_AUTH_TOKEN
  })

  it("keeps tenant isolation for reads", async () => {
    const db = await getDb()
    const seeded = await ensureSeededBase(db, session.orgId, session.userId)

    const [otherBase] = await db
      .select()
      .from(bases)
      .where(eq(bases.id, seeded.baseId))
    await db
      .insert(bases)
      .values({
        ...otherBase,
        createdBy: "other-user",
        id: "base_other_org",
        name: "Someone else's base",
        orgId: "other-org",
        rank: "a0",
      })

    const ctx: AiToolContext = { db, session }
    await expect(
      describeTable(ctx, { baseId: "base_other_org", tableId: seeded.tableId }),
    ).rejects.toBeInstanceOf(AppError)
  })
})

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost:3000${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  })
}

function sseResponse(frames: Array<{ data: unknown; event: string }>): Response {
  const body = frames
    .map((frame) => `event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`)
    .join("")
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
    status: 200,
  })
}

function parseEvents(text: string): AssistantStreamEvent[] {
  const events: AssistantStreamEvent[] = []
  for (const frame of text.split("\n\n")) {
    const dataLine = frame
      .split("\n")
      .find((line) => line.startsWith("data:"))
    if (!dataLine) continue
    events.push(JSON.parse(dataLine.slice(5).trim()) as AssistantStreamEvent)
  }
  return events
}
