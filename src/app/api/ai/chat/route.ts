import { z } from "zod"

import { getDb } from "@/db/client"
import { AppError, FIELD_TYPES, type FieldType } from "@/lib/domain"
import {
  writeOperationSchema,
  type AssistantChart,
  type AssistantCitation,
  type AssistantStreamEvent,
} from "@/lib/eve/contracts"
import type { AssistantPageContext } from "@/lib/eve/page-context"
import {
  FACTORY_AI_ERROR_MESSAGES,
  callFactoryAi,
  isAssistantAiConfigured,
  type FactoryAiErrorCode,
  type FactoryAiMessage,
  FactoryAiError,
} from "@/server/ai/gateway"
import {
  buildWriteProposal,
  describeTable,
  formAnalytics,
  inspectForm,
  issueWriteProposalToken,
  listRecords,
  summarizeTable,
  type AiToolContext,
  type DescribeTableOutput,
  type FormAnalyticsOutput,
  type ListRecordsOutput,
  type SummarizeTableOutput,
} from "@/server/ai/tools"
import { requireSession } from "@/server/auth"
import { jsonError } from "@/server/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const messageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(8_000),
  })
  .strict()

const scopeSchema = z
  .object({
    id: z.string().trim().min(1).max(256),
    name: z.string().trim().max(240).optional(),
  })
  .strict()

const contextSchema = z
  .object({
    base: scopeSchema.optional(),
    table: scopeSchema.optional(),
    form: scopeSchema.optional(),
    view: scopeSchema.optional(),
  })
  .strict()

const requestSchema = z
  .object({
    requestId: z.string().trim().min(8).max(200),
    messages: z.array(messageSchema).min(1).max(40),
    context: contextSchema.optional(),
  })
  .strict()

type ChatRequest = z.infer<typeof requestSchema>
type Emit = (event: AssistantStreamEvent) => void

const WRITE_INTENT_PATTERN =
  /(建|创建|新建|生成|添加|新增|修改|更新|删除|移除|改名|调整|改).{0,16}(表|表格|记录|字段|列|视图|表单)|(create|add|build|make|insert|update|change|delete|remove|rename|propose).{0,20}(table|record|row|column|field|view|form)|把.{0,24}(改|换|设|删|加|移)/i
const ANALYSIS_INTENT_PATTERN =
  /(分析|统计|汇总|图表|趋势|分布|占比|多少|平均|总计|总额|关键指标|概览|洞察|analyz|analys|summar|chart|breakdown|distribution|trend|insight|how many|average|total|report)/i

export async function POST(request: Request) {
  let session
  try {
    session = await requireSession(request)
  } catch (error) {
    return jsonError(error)
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return jsonError(new AppError("VALIDATION_ERROR", "Send a JSON body."))
  }

  const parsed = requestSchema.safeParse(payload)
  if (!parsed.success) {
    return jsonError(parsed.error)
  }

  const db = await getDb()
  const ctx: AiToolContext = { db, session }
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit: Emit = (event) => {
        controller.enqueue(
          encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
        )
      }
      try {
        await runAssistantTurn({
          ctx,
          body: parsed.data,
          emit,
          signal: request.signal,
        })
      } catch (error) {
        const event = streamError(error, parsed.data.requestId)
        try {
          emit(event)
        } catch {
          // The client went away; nothing left to report.
        }
      } finally {
        try {
          controller.close()
        } catch {
          // Already closed.
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    },
  })
}

async function runAssistantTurn(params: {
  ctx: AiToolContext
  body: ChatRequest
  emit: Emit
  signal: AbortSignal
}): Promise<void> {
  const { ctx, body, emit, signal } = params
  const { requestId, context } = body
  const lastUserMessage =
    [...body.messages].reverse().find((message) => message.role === "user")
      ?.content ?? ""

  if (!lastUserMessage.trim()) {
    emit({
      code: "validation-error",
      message: "Ask a question or describe a change to get started.",
      requestId,
      retryable: false,
      type: "error",
    })
    return
  }

  const wantsWrite = WRITE_INTENT_PATTERN.test(lastUserMessage)

  const facts = await loadWorkspaceFacts({
    ctx,
    context,
    emit,
    includeRecords: wantsWrite,
  })

  if (!isAssistantAiConfigured()) {
    emit({
      code: "ai-unavailable",
      message: FACTORY_AI_ERROR_MESSAGES["ai-unavailable"],
      requestId,
      retryable: true,
      type: "error",
    })
    return
  }

  const isAnalysis =
    !wantsWrite && ANALYSIS_INTENT_PATTERN.test(lastUserMessage)

  if (wantsWrite && context?.base?.id) {
    await emitWriteProposal({
      ctx,
      body,
      baseId: context.base.id,
      facts,
      emit,
      signal,
    })
    return
  }

  const systemPrompt = isAnalysis
    ? buildAnalysisPrompt({ context, facts })
    : buildAnswerPrompt({ context, facts })

  const response = await callFactoryAi({
    requestId,
    messages: [
      { role: "system", content: systemPrompt },
      ...conversationMessages(body.messages),
    ],
    signal,
    onDelta: (text) => emit({ text, type: "delta" }),
  })

  if (isAnalysis && facts.chart) {
    emit({ chart: facts.chart, type: "chart" })
  }

  emit({
    citations: facts.citations,
    requestId: response.requestId,
    type: "done",
    ...(response.usage ? { usage: response.usage } : {}),
  })
}

async function emitWriteProposal(params: {
  ctx: AiToolContext
  body: ChatRequest
  baseId: string
  facts: WorkspaceFacts
  emit: Emit
  signal: AbortSignal
}): Promise<void> {
  const { ctx, body, baseId, facts, emit, signal } = params
  const { requestId, context } = body

  const response = await callFactoryAi({
    requestId,
    messages: [
      {
        role: "system",
        content: buildActionPrompt({ baseId, context, facts }),
      },
      ...conversationMessages(body.messages),
    ],
    schema: buildActionSchema(baseId),
    signal,
  })

  const action = parseAction(response.text, baseId)
  const proposal = await buildWriteProposal(ctx, action.operation, action.input)
  // The approval ticket is minted here, server-side, and travels with the
  // proposal. Without it the write route refuses to execute anything.
  const token = await issueWriteProposalToken(ctx, proposal)

  emit({ proposal: { ...proposal, token }, type: "proposal" })
  emit({
    citations: facts.citations,
    requestId: response.requestId,
    type: "done",
    ...(response.usage ? { usage: response.usage } : {}),
  })
}

interface WorkspaceFacts {
  chart?: AssistantChart
  citations: AssistantCitation[]
  hasData: boolean
  text: string
}

async function loadWorkspaceFacts(params: {
  ctx: AiToolContext
  context?: AssistantPageContext
  emit: Emit
  includeRecords: boolean
}): Promise<WorkspaceFacts> {
  const { ctx, context, emit, includeRecords } = params
  const citations: AssistantCitation[] = []
  const lines: string[] = []
  let chart: AssistantChart | undefined
  let hasData = false

  const baseId = context?.base?.id
  const tableId = context?.table?.id

  if (!baseId) {
    return {
      citations,
      hasData: false,
      text: "No base is open in the workspace. Ask the workspace member to open a base first.",
    }
  }

  if (tableId) {
    const described = await describeTable(ctx, { baseId, tableId })
    emit({ data: described, tool: "describe_table", type: "tool_result" })

    lines.push(`Base: ${described.base.name}`)
    lines.push(
      `Table: ${described.table.name} · ${described.table.recordCount} records · ${described.table.fields.length} columns`,
    )
    lines.push("Columns:")
    for (const field of described.table.fields.slice(0, 60)) {
      lines.push(
        `- ${field.name} [${field.type}] id=${field.id}${
          field.options?.length
            ? ` choices=${field.options.map((option) => option.label).join(" | ")}`
            : ""
        }`,
      )
    }
    if (described.views.length > 0) {
      lines.push(
        `Saved views: ${described.views.map((view) => `${view.name} (${view.type})`).join(", ")}`,
      )
    }

    const summaryFieldIds = pickSummaryFields(described.table.fields)
    const groupByFieldId = pickGroupField(described.table.fields)
    if (summaryFieldIds.length > 0) {
      const summary = await summarizeTable(ctx, {
        baseId,
        tableId,
        fieldIds: summaryFieldIds,
        ...(groupByFieldId ? { groupByFieldId } : {}),
        topValues: 10,
      })
      emit({ data: summary, tool: "summarize_table", type: "tool_result" })
      lines.push(formatSummaryFacts(summary))
      chart = chartFromSummary(described, summary, groupByFieldId)
      hasData = described.table.recordCount > 0
    }

    if (includeRecords) {
      const records = await listRecords(ctx, { baseId, tableId, limit: 20 })
      emit({ data: records, tool: "list_records", type: "tool_result" })
      lines.push(formatRecordFacts(described, records))
    }

    citations.push({
      href: `/bases/${encodeURIComponent(baseId)}/tables/${encodeURIComponent(tableId)}`,
      kind: "table",
      label: `Table · ${described.table.name}`,
    })
  } else {
    lines.push(`Base: ${context?.base?.name ?? baseId}`)
    lines.push(
      "No table is open. Ask the workspace member to open a table before requesting table analysis or record changes.",
    )
  }

  if (context?.form?.id) {
    try {
      const form = await inspectForm(ctx, { baseId, formId: context.form.id })
      emit({ data: form, tool: "inspect_form", type: "tool_result" })
      lines.push(
        `Form: ${form.form.title} · ${form.form.isOpen ? "accepting responses" : "not published"} · ${form.form.fields.length} questions`,
      )
      const analytics = await formAnalytics(ctx, {
        baseId,
        days: 30,
        formId: context.form.id,
      })
      emit({ data: analytics, tool: "form_analytics", type: "tool_result" })
      lines.push(
        `Form performance (last 30 days): ${analytics.totals.submissions} submissions, ${analytics.totals.views} views, completion ${Math.round(analytics.totals.completionRate * 100)}%.`,
      )
      chart ??= chartFromFormAnalytics(form.form.title, analytics)
      citations.push({
        href: `/bases/${encodeURIComponent(baseId)}/forms/${encodeURIComponent(context.form.id)}`,
        kind: "form",
        label: `Form · ${form.form.title}`,
      })
      hasData = true
    } catch (error) {
      if (!(error instanceof AppError && error.code === "NOT_FOUND")) {
        throw error
      }
    }
  }

  return {
    ...(chart ? { chart } : {}),
    citations,
    hasData,
    text: truncate(lines.join("\n"), 8_000),
  }
}

function pickSummaryFields(
  fields: DescribeTableOutput["table"]["fields"],
): string[] {
  const priority: FieldType[] = [
    "singleSelect",
    "multiSelect",
    "currency",
    "number",
    "percent",
    "rating",
    "date",
    "checkbox",
  ]
  const ranked = [...fields].sort((left, right) => {
    const leftRank = priority.indexOf(left.type as FieldType)
    const rightRank = priority.indexOf(right.type as FieldType)
    return (
      (leftRank === -1 ? priority.length : leftRank) -
      (rightRank === -1 ? priority.length : rightRank)
    )
  })
  return ranked.slice(0, 10).map((field) => field.id)
}

function pickGroupField(
  fields: DescribeTableOutput["table"]["fields"],
): string | undefined {
  return (
    fields.find((field) => field.type === "singleSelect")?.id ??
    fields.find((field) => field.type === "checkbox")?.id
  )
}

function formatSummaryFacts(summary: SummarizeTableOutput): string {
  const lines = ["Computed summary (verified from stored records):"]
  for (const field of summary.summaries) {
    const parts = [
      `${field.populatedCount} filled`,
      `${field.emptyCount} empty`,
    ]
    if (field.distinctCount !== undefined) {
      parts.push(`${field.distinctCount} distinct`)
    }
    if (field.total !== undefined) {
      parts.push(`sum ${formatNumber(field.total)}`)
      parts.push(`average ${formatNumber(field.average ?? 0)}`)
      parts.push(
        `range ${formatNumber(field.minimum ?? 0)}–${formatNumber(field.maximum ?? 0)}`,
      )
    }
    if (field.topValues?.length) {
      parts.push(
        `top values ${field.topValues
          .map((entry) => `${String(entry.value)} (${entry.count})`)
          .join(", ")}`,
      )
    }
    lines.push(`- ${field.fieldName} (${field.fieldType}): ${parts.join("; ")}`)
  }
  if (summary.grouped?.length) {
    lines.push(
      `Grouped counts: ${summary.grouped
        .map((entry) => `${entry.label} (${entry.value})`)
        .join(", ")}`,
    )
  }
  if (summary.truncated) {
    lines.push(
      `Note: only the first ${summary.recordCount} records were available when summarizing.`,
    )
  }
  return lines.join("\n")
}

function formatRecordFacts(
  described: DescribeTableOutput,
  records: ListRecordsOutput,
): string {
  if (records.records.length === 0) {
    return "Records: none yet."
  }
  const nameById = new Map(
    described.table.fields.map((field) => [field.id, field.name]),
  )
  const lines = [
    "Records available for updates or deletions (use these IDs and versions):",
  ]
  for (const record of records.records) {
    const values = Object.entries(record.values)
      .slice(0, 8)
      .map(
        ([fieldId, value]) =>
          `${nameById.get(fieldId) ?? "Column"}=${JSON.stringify(value)}`,
      )
      .join(", ")
    lines.push(`- id=${record.id} version=${record.version} ${values}`)
  }
  return lines.join("\n")
}

function chartFromSummary(
  described: DescribeTableOutput,
  summary: SummarizeTableOutput,
  groupByFieldId: string | undefined,
): AssistantChart | undefined {
  if (summary.grouped && summary.grouped.length > 0) {
    const groupName =
      described.table.fields.find((field) => field.id === groupByFieldId)?.name ??
      "Group"
    return {
      data: summary.grouped.slice(0, 20).map((entry) => ({
        label: entry.label,
        value: entry.value,
      })),
      title: `${described.table.name} by ${groupName}`,
      type: "bar",
      xLabel: groupName,
      yLabel: "Records",
    }
  }

  for (const field of summary.summaries) {
    if (!field.topValues || field.topValues.length === 0) continue
    return {
      data: field.topValues.slice(0, 20).map((entry) => ({
        label: String(entry.value).slice(0, 120),
        value: entry.count,
      })),
      title: `${described.table.name}: ${field.fieldName}`,
      type: "bar",
      xLabel: field.fieldName,
      yLabel: "Records",
    }
  }

  const averages = summary.summaries
    .filter((field) => field.average !== undefined)
    .map((field) => ({
      label: field.fieldName,
      value: Math.max(0, field.average ?? 0),
    }))
  if (averages.length > 0) {
    return {
      data: averages.slice(0, 10),
      title: `${described.table.name}: averages`,
      type: "bar",
      xLabel: "Column",
      yLabel: "Average",
    }
  }
  return undefined
}

function chartFromFormAnalytics(
  title: string,
  analytics: FormAnalyticsOutput,
): AssistantChart | undefined {
  if (analytics.series.length < 2) return undefined
  return {
    data: analytics.series.slice(-30).map((row) => ({
      label: row.date,
      value: row.submissions,
    })),
    title: `${title} submissions`,
    type: "line",
    xLabel: "Date",
    yLabel: "Submissions",
  }
}

function buildActionSchema(baseId: string): Record<string, unknown> {
  const fieldType = { enum: [...FIELD_TYPES] }
  const choose = {
    additionalProperties: false,
    required: ["name"],
    properties: {
      name: { maxLength: 240, minLength: 1, type: "string" },
      type: fieldType,
      primary: { type: "boolean" },
      config: { type: "object" },
    },
    type: "object",
  }

  return {
    additionalProperties: false,
    oneOf: [
      {
        additionalProperties: false,
        required: ["operation", "input"],
        properties: {
          operation: { enum: ["create_table"] },
          input: {
            additionalProperties: false,
            required: ["baseId", "name", "fields"],
            properties: {
              baseId: { enum: [baseId] },
              name: { maxLength: 240, minLength: 1, type: "string" },
              description: { maxLength: 2_000, type: "string" },
              fields: { items: choose, maxItems: 40, minItems: 1, type: "array" },
              sampleRows: {
                items: { type: "object" },
                maxItems: 50,
                type: "array",
              },
            },
            type: "object",
          },
        },
        type: "object",
      },
      {
        additionalProperties: false,
        required: ["operation", "input"],
        properties: {
          operation: { enum: ["create_field"] },
          input: {
            additionalProperties: false,
            required: ["baseId", "tableId", "field"],
            properties: {
              baseId: { enum: [baseId] },
              tableId: { minLength: 1, type: "string" },
              field: choose,
              insertAfterFieldId: { minLength: 1, type: "string" },
            },
            type: "object",
          },
        },
        type: "object",
      },
      {
        additionalProperties: false,
        required: ["operation", "input"],
        properties: {
          operation: { enum: ["create_record"] },
          input: {
            additionalProperties: false,
            required: ["baseId", "tableId", "values"],
            properties: {
              baseId: { enum: [baseId] },
              tableId: { minLength: 1, type: "string" },
              values: {
                items: {
                  additionalProperties: false,
                  required: ["fieldId", "fieldName", "value"],
                  properties: {
                    fieldId: { minLength: 1, type: "string" },
                    fieldName: { maxLength: 240, minLength: 1, type: "string" },
                    value: {},
                  },
                  type: "object",
                },
                maxItems: 50,
                minItems: 1,
                type: "array",
              },
            },
            type: "object",
          },
        },
        type: "object",
      },
      {
        additionalProperties: false,
        required: ["operation", "input"],
        properties: {
          operation: { enum: ["update_record"] },
          input: {
            additionalProperties: false,
            required: ["baseId", "tableId", "recordId", "expectedVersion", "changes"],
            properties: {
              baseId: { enum: [baseId] },
              tableId: { minLength: 1, type: "string" },
              recordId: { minLength: 1, type: "string" },
              expectedVersion: { minimum: 0, type: "integer" },
              changes: {
                items: {
                  additionalProperties: false,
                  required: ["fieldId", "fieldName", "before", "after"],
                  properties: {
                    fieldId: { minLength: 1, type: "string" },
                    fieldName: { maxLength: 240, minLength: 1, type: "string" },
                    before: {},
                    after: {},
                  },
                  type: "object",
                },
                maxItems: 50,
                minItems: 1,
                type: "array",
              },
            },
            type: "object",
          },
        },
        type: "object",
      },
      {
        additionalProperties: false,
        required: ["operation", "input"],
        properties: {
          operation: { enum: ["delete_record"] },
          input: {
            additionalProperties: false,
            required: [
              "baseId",
              "tableId",
              "recordId",
              "expectedVersion",
              "expectedPrimaryValue",
              "deletionSummary",
            ],
            properties: {
              baseId: { enum: [baseId] },
              tableId: { minLength: 1, type: "string" },
              recordId: { minLength: 1, type: "string" },
              expectedVersion: { minimum: 0, type: "integer" },
              expectedPrimaryValue: {},
              deletionSummary: {
                items: { maxLength: 240, minLength: 1, type: "string" },
                maxItems: 20,
                minItems: 1,
                type: "array",
              },
            },
            type: "object",
          },
        },
        type: "object",
      },
      {
        additionalProperties: false,
        required: ["operation", "input"],
        properties: {
          operation: { enum: ["create_view"] },
          input: {
            additionalProperties: false,
            required: ["baseId", "tableId", "name", "type"],
            properties: {
              baseId: { enum: [baseId] },
              tableId: { minLength: 1, type: "string" },
              name: { maxLength: 240, minLength: 1, type: "string" },
              type: {
                enum: ["grid", "kanban", "timeline", "calendar", "gallery", "dashboard"],
              },
              configuration: { type: "object" },
            },
            type: "object",
          },
        },
        type: "object",
      },
      {
        additionalProperties: false,
        required: ["operation", "input"],
        properties: {
          operation: { enum: ["create_form"] },
          input: {
            additionalProperties: false,
            required: ["baseId", "tableId", "title", "fields", "appearance"],
            properties: {
              baseId: { enum: [baseId] },
              tableId: { minLength: 1, type: "string" },
              title: { maxLength: 240, minLength: 1, type: "string" },
              description: { maxLength: 2_000, type: "string" },
              fields: {
                items: {
                  additionalProperties: false,
                  required: ["fieldId", "fieldName", "label", "required", "position"],
                  properties: {
                    fieldId: { minLength: 1, type: "string" },
                    fieldName: { maxLength: 240, minLength: 1, type: "string" },
                    label: { maxLength: 240, minLength: 1, type: "string" },
                    description: { maxLength: 1_000, type: "string" },
                    required: { type: "boolean" },
                    position: { minimum: 0, type: "integer" },
                  },
                  type: "object",
                },
                maxItems: 100,
                minItems: 1,
                type: "array",
              },
              appearance: {
                additionalProperties: false,
                required: ["accentColor", "submitButtonLabel", "successMessage"],
                properties: {
                  accentColor: { maxLength: 64, minLength: 1, type: "string" },
                  submitButtonLabel: { maxLength: 240, minLength: 1, type: "string" },
                  successMessage: { maxLength: 2_000, minLength: 1, type: "string" },
                },
                type: "object",
              },
            },
            type: "object",
          },
        },
        type: "object",
      },
    ],
    type: "object",
  }
}

function buildActionPrompt(params: {
  baseId: string
  context?: AssistantPageContext
  facts: WorkspaceFacts
}): string {
  const { baseId, context, facts } = params
  return [
    "You turn a workspace member's request into one safe, reviewable change.",
    "Reply with a single JSON object and nothing else. Do not wrap it in code fences.",
    'Shape: { "operation": string, "input": object }.',
    "Allowed operations: create_table, create_field, create_record, update_record, delete_record, create_view, create_form.",
    "Rules:",
    `- Always set input.baseId to "${baseId}".`,
    context?.table?.id
      ? `- For record or column changes, set input.tableId to "${context.table.id}".`
      : "- Only create_table and create_form do not need a tableId.",
    "- Use only the column IDs and record IDs listed in the workspace facts.",
    "- For choice columns, send the choice label as the value; the server resolves it.",
    "- Prefer the smallest change that satisfies the request. Never invent records that the member did not ask for.",
    "- When the member asks for a new table, include sensible columns (status choices, amounts, sequence, dates) and 3-5 realistic sample rows.",
    "",
    "Workspace facts:",
    facts.text,
  ].join("\n")
}

function buildAnalysisPrompt(params: {
  context?: AssistantPageContext
  facts: WorkspaceFacts
}): string {
  const { context, facts } = params
  return [
    "You are the workspace analyst inside a spreadsheet-style database app.",
    "Analyze only the verified facts below. Never invent numbers, records, or columns.",
    "Structure the answer with exactly these headings:",
    "Facts from workspace data",
    "Interpretation",
    "Limitations",
    "Keep it concise: short paragraphs or bullets, plain language, no file paths or internal IDs.",
    facts.hasData
      ? "Reference concrete counts and values from the facts."
      : "If there is not enough data, say so plainly in Limitations.",
    context?.table?.name ? `Active table: ${context.table.name}.` : "",
    "",
    "Verified workspace facts:",
    facts.text,
  ]
    .filter(Boolean)
    .join("\n")
}

function buildAnswerPrompt(params: {
  context?: AssistantPageContext
  facts: WorkspaceFacts
}): string {
  const { context, facts } = params
  return [
    "You are a helpful assistant inside a spreadsheet-style database app.",
    "Answer using only the verified workspace facts below. Do not invent data.",
    "Keep answers short and practical. Never mention internal IDs, tokens, or provider details.",
    context?.base?.name ? `Active base: ${context.base.name}.` : "",
    context?.table?.name ? `Active table: ${context.table.name}.` : "",
    "",
    "Verified workspace facts:",
    facts.text,
  ]
    .filter(Boolean)
    .join("\n")
}

function conversationMessages(
  messages: ChatRequest["messages"],
): FactoryAiMessage[] {
  return messages.slice(-12).map((message) => ({
    content: message.content,
    role: message.role,
  }))
}

function parseAction(
  text: string,
  baseId: string,
): { input: Record<string, unknown>; operation: z.infer<typeof writeOperationSchema> } {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new AppError(
      "VALIDATION_ERROR",
      "The assistant could not describe that change. Try rephrasing it.",
    )
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError(
      "VALIDATION_ERROR",
      "The assistant could not describe that change. Try rephrasing it.",
    )
  }

  const candidate = parsed as { input?: unknown; operation?: unknown }
  const operation = writeOperationSchema.safeParse(candidate.operation)
  if (!operation.success) {
    throw new AppError(
      "VALIDATION_ERROR",
      "The assistant proposed an unsupported change. Try rephrasing it.",
    )
  }
  if (
    candidate.input === null ||
    typeof candidate.input !== "object" ||
    Array.isArray(candidate.input)
  ) {
    throw new AppError(
      "VALIDATION_ERROR",
      "The assistant could not describe that change. Try rephrasing it.",
    )
  }

  return {
    operation: operation.data,
    input: { baseId, ...(candidate.input as Record<string, unknown>) },
  }
}

function streamError(error: unknown, requestId: string): AssistantStreamEvent {
  if (error instanceof FactoryAiError) {
    return {
      code: error.code,
      message: error.message,
      requestId,
      retryable: error.retryable,
      type: "error",
    }
  }
  if (error instanceof AppError) {
    return {
      code: error.code.toLowerCase(),
      message: error.message,
      requestId,
      retryable:
        error.code === "REVISION_CONFLICT" || error.code === "VALIDATION_ERROR",
      type: "error",
    }
  }
  if (error instanceof z.ZodError) {
    const issue = error.issues[0]?.message
    return {
      code: "schema-invalid",
      message:
        issue?.slice(0, 400) ??
        FACTORY_AI_ERROR_MESSAGES["schema-invalid"],
      requestId,
      retryable: true,
      type: "error",
    }
  }
  if (error instanceof Error && error.name === "AbortError") {
    return {
      code: "cancelled",
      message: "The request was stopped. No changes were made.",
      requestId,
      retryable: true,
      type: "error",
    }
  }
  return {
    code: "provider-failed" satisfies FactoryAiErrorCode,
    message: FACTORY_AI_ERROR_MESSAGES["provider-failed"],
    requestId,
    retryable: true,
    type: "error",
  }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(
    value,
  )
}

function truncate(value: string, maximum: number): string {
  return value.length > maximum ? `${value.slice(0, maximum - 1)}…` : value
}
