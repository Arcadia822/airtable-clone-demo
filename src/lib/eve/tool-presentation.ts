import type { FieldType } from "@/lib/domain"
import { FIELD_TYPE_LABELS } from "@/lib/field-type-meta"

export type AssistantToolDetail = {
  label: string
  value: string
}

export type AssistantToolPresentation = {
  details: AssistantToolDetail[]
  result?: string
  title: string
}

export type AssistantRecoveryAction = "new-session" | "reload" | "retry"

export type AssistantErrorPresentation = {
  action?: AssistantRecoveryAction
  message: string
}

const TOOL_TITLES: Record<string, string> = {
  create_field: "Add a column",
  create_form: "Create a form",
  create_record: "Add a record",
  delete_field: "Delete a column",
  delete_record: "Delete a record",
  describe_table: "Review table structure",
  form_analytics: "Review form performance",
  inspect_form: "Review form setup",
  list_records: "Review records",
  summarize_table: "Analyze table",
  update_form_settings: "Update form settings",
  update_record: "Update a record",
}

const FORM_PROPERTY_LABELS: Record<string, string> = {
  accentColor: "Brand color",
  allowMultipleSubmissions: "Repeat submissions",
  description: "Description",
  isOpen: "Accepting responses",
  submitButtonLabel: "Submit button",
  successMessage: "Thank-you message",
  title: "Form title",
}

const INTERNAL_REFERENCE_PATTERN =
  /["'`]?\b(?:baseId|tableId|formId|formFieldId|fieldId|recordId|viewId|operationId|entityIds|expectedVersion|organizationId|userId|sessionId|turnId|callId|requestId|continuationToken|idempotencyKey|payloadHash|proofHash|targetFieldId|fieldMap|fieldMapping|prefillParameter|fixedValue|cursor|revision|rank|slug)\b["'`]?\s*[:=]\s*(?:"[^"]*"|'[^']*'|`[^`]*`|[^\s,;)}\]]+)/gi
const INTERNAL_KEY_PATTERN =
  /\b(?:baseId|tableId|formId|formFieldId|fieldId|recordId|viewId|operationId|entityIds|expectedVersion|organizationId|userId|sessionId|turnId|callId|requestId|continuationToken|idempotencyKey|payloadHash|proofHash|targetFieldId|fieldMap|fieldMapping|prefillParameter|fixedValue|cursor|revision|rank|slug)\b/gi
const PREFIXED_REFERENCE_PATTERN =
  /\b(?:org|user|session|turn|base|table|form|field|record|view|operation)_[a-z0-9_-]+\b/gi
const CONVEX_REFERENCE_PATTERN = /\b[a-z0-9]{30,40}\b/gi
const UUID_REFERENCE_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi
const JWT_REFERENCE_PATTERN =
  /\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/g
const FENCED_TECHNICAL_BLOCK_PATTERN =
  /```(?:json|javascript|typescript|js|ts)?\s*[\s\S]*?```/gi
const INLINE_OBJECT_PATTERN = /\{[^\n]*\}/g
const INLINE_JSON_ARRAY_PATTERN =
  /\[(?=[^\n\]]*["'][^"']+["']\s*:)[^\n]*\]/g
const TECHNICAL_ERROR_PATTERN =
  /\b(?:FatalError|EveWorkflowFailure|USER_ERROR|[A-Z][A-Z0-9]+(?:_[A-Z0-9]+){1,})\b/g

const FRIENDLY_TERM_REPLACEMENTS: Record<string, string> = {
  accentColor: "brand color",
  allowMultipleSubmissions: "repeat submissions",
  dataLossSummary: "impact",
  deletionSummary: "impact",
  expectedName: "column name",
  expectedPrimaryValue: "record name",
  expectedType: "column type",
  fieldName: "column",
  isOpen: "accepting responses",
  submitButtonLabel: "submit button",
  successMessage: "thank-you message",
}

export function presentAssistantTool(
  toolName: string,
  input: unknown,
  output: unknown,
): AssistantToolPresentation {
  const inputObject = asObject(input)
  const outputObject = asObject(output)

  return {
    title: TOOL_TITLES[toolName] ?? "Work with workspace data",
    details: buildToolDetails(toolName, inputObject, outputObject),
    result: buildToolResult(toolName, outputObject),
  }
}

export function sanitizeAssistantText(text: string): string {
  let sanitized = text
    .replace(FENCED_TECHNICAL_BLOCK_PATTERN, "Technical details hidden.")
    .replace(INLINE_OBJECT_PATTERN, "Technical details hidden.")
    .replace(INLINE_JSON_ARRAY_PATTERN, "Technical details hidden.")
    .replace(INTERNAL_REFERENCE_PATTERN, "the selected item")
    .replace(PREFIXED_REFERENCE_PATTERN, "the selected item")
    .replace(CONVEX_REFERENCE_PATTERN, "the selected item")
    .replace(UUID_REFERENCE_PATTERN, "the selected item")
    .replace(JWT_REFERENCE_PATTERN, "a secure credential")
    .replace(INTERNAL_KEY_PATTERN, "the selected item")
    .replace(TECHNICAL_ERROR_PATTERN, "a workspace error")

  for (const [type, label] of Object.entries(FIELD_TYPE_LABELS)) {
    sanitized = sanitized.replace(
      new RegExp(`\\b${escapeRegExp(type)}\\b`, "g"),
      label.toLocaleLowerCase(),
    )
  }
  for (const [term, label] of Object.entries(FRIENDLY_TERM_REPLACEMENTS)) {
    sanitized = sanitized.replace(
      new RegExp(`\\b${escapeRegExp(term)}\\b`, "g"),
      label,
    )
  }

  return sanitized
    .replace(
      /["'`]?\bstatus\b["'`]?\s*[:=]\s*["'`]?(?:applied|replayed)["'`]?/gi,
      "change completed",
    )
    .replace(
      /["'`]?\boutcome\b["'`]?\s*[:=]\s*["'`]?(?:authorized|denied)["'`]?/gi,
      "access decision completed",
    )
    .replace(/\breplayed\b/gi, "completed")
    .replace(/(?:Technical details hidden\.\s*){2,}/g, "Technical details hidden. ")
    .trim()
}

export function friendlyAssistantError(message?: string): string | undefined {
  if (!message) {
    return undefined
  }

  return presentAssistantError(message).message
}

export function presentAssistantError(
  error: unknown,
): AssistantErrorPresentation {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : ""
  const normalized = message.toLocaleLowerCase()
  if (
    normalized.includes("eve_session_forbidden") ||
    normalized.includes("assistant_session_forbidden") ||
    normalized.includes("ownership") ||
    normalized.includes("continuation token") ||
    normalized.includes("stale continuation") ||
    normalized.includes("does not belong")
  ) {
    return {
      action: "new-session",
      message:
        "This conversation is no longer linked to your workspace. Start a new conversation and try again.",
    }
  }
  if (
    normalized.includes("431") ||
    normalized.includes("header fields too large") ||
    normalized.includes("request header")
  ) {
    return {
      action: "reload",
      message:
        "The assistant connection needs a clean refresh. Reload the page, then try your request again.",
    }
  }
  if (
    normalized.includes("sign in") ||
    normalized.includes("auth") ||
    normalized.includes("session") ||
    normalized.includes("forbidden") ||
    /\b(?:401|403)\b/.test(normalized)
  ) {
    return {
      action: "reload",
      message:
        "Your workspace session could not be verified. Reload the page and try again.",
    }
  }
  if (
    normalized.includes("quota") ||
    normalized.includes("rate limit") ||
    normalized.includes("too many requests") ||
    /\b429\b/.test(normalized)
  ) {
    return {
      message:
        "Your workspace has reached its current assistant usage limit. Try again after the limit resets.",
    }
  }
  if (
    normalized.includes("billing") ||
    normalized.includes("entitlement") ||
    normalized.includes("plan") ||
    normalized.includes("upgrade")
  ) {
    return {
      message:
        "Your workspace does not currently include the AI analyst. A workspace admin can review available plans.",
    }
  }
  if (
    normalized.includes("stale") ||
    normalized.includes("conflict") ||
    normalized.includes("version")
  ) {
    return {
      action: "retry",
      message:
        "The workspace changed while this request was running. Try again so the assistant can review the latest data.",
    }
  }
  if (
    normalized.includes("max retries") ||
    normalized.includes("retry limit") ||
    normalized.includes("network") ||
    normalized.includes("fetch") ||
    normalized.includes("timeout") ||
    normalized.includes("connection") ||
    /\b(?:502|503|504)\b/.test(normalized)
  ) {
    return {
      action: "retry",
      message:
        "The assistant could not finish the request in time. Check your connection and try again.",
    }
  }
  if (
    normalized.includes("denied") ||
    normalized.includes("cancel") ||
    normalized.includes("abort")
  ) {
    return {
      action: "retry",
      message: "The request was stopped. No changes were made. You can try again.",
    }
  }

  return {
    action: "retry",
    message: "The assistant could not complete that request. Try again.",
  }
}

function buildToolDetails(
  toolName: string,
  input: Record<string, unknown> | undefined,
  output: Record<string, unknown> | undefined,
): AssistantToolDetail[] {
  switch (toolName) {
    case "create_record": {
      const values = asArray(input?.values)
      return [
        detail("Before", "No new record"),
        detail(
          "After",
          values
            ? `New record with ${values.length} ${values.length === 1 ? "value" : "values"}`
            : "New record",
        ),
        ...valueDetails(values),
      ].filter(isDetail)
    }
    case "update_record":
      return changeDetails(input?.changes)
    case "delete_record":
      return [
        detail("Before", input?.expectedPrimaryValue),
        detail("After", "Record removed"),
        detail("What will be removed", sentenceList(input?.deletionSummary)),
      ].filter(isDetail)
    case "create_field": {
      const field = asObject(input?.field)
      return [
        detail("Before", "No new column"),
        detail(
          "After",
          [readableValue(field?.name), fieldTypeLabel(field?.type)]
            .filter(Boolean)
            .join(" · "),
        ),
        detail("Column", field?.name),
        detail("Type", fieldTypeLabel(field?.type)),
      ].filter(isDetail)
    }
    case "delete_field":
      return [
        detail(
          "Before",
          [readableValue(input?.expectedName), fieldTypeLabel(input?.expectedType)]
            .filter(Boolean)
            .join(" · "),
        ),
        detail("After", "Column removed"),
        detail("Type", fieldTypeLabel(input?.expectedType)),
        detail("Impact", input?.dataLossSummary),
      ].filter(isDetail)
    case "create_form": {
      const fields = asArray(input?.fields)
      return [
        detail("Before", "No new form"),
        detail("After", input?.title),
        detail("Form", input?.title),
        detail(
          "Questions",
          fields
            ? `${fields.length} ${fields.length === 1 ? "question" : "questions"}`
            : undefined,
        ),
        detail("Includes", namedItems(fields, ["label", "fieldName"])),
      ].filter(isDetail)
    }
    case "update_form_settings":
      return formSettingDetails(input?.changes)
    case "describe_table": {
      const table = asObject(output?.table)
      const fields = asArray(table?.fields)
      return [
        detail("Table", table?.name),
        detail("Records", table?.recordCount),
        detail("Columns", fields?.length),
      ].filter(isDetail)
    }
    case "list_records": {
      const records = asArray(output?.records)
      return [
        detail(
          "Records reviewed",
          records
            ? `${records.length}${output?.truncated === true ? "+" : ""}`
            : undefined,
        ),
      ].filter(isDetail)
    }
    case "summarize_table": {
      const summaries = asArray(output?.summaries)
      return [
        detail("Records analyzed", output?.recordCount),
        detail("Columns analyzed", summaries?.length),
      ].filter(isDetail)
    }
    case "inspect_form": {
      const form = asObject(output?.form)
      const fields = asArray(form?.fields)
      return [
        detail("Form", form?.title),
        detail("Questions", fields?.length),
        detail(
          "Accepting responses",
          typeof form?.isOpen === "boolean" ? form.isOpen : undefined,
        ),
      ].filter(isDetail)
    }
    case "form_analytics": {
      const totals = asObject(output?.totals)
      return [
        detail("Views", totals?.views),
        detail("Started", totals?.starts),
        detail("Submitted", totals?.submissions),
        detail("Completion", percentage(totals?.completionRate)),
      ].filter(isDetail)
    }
    default:
      return []
  }
}

function buildToolResult(
  toolName: string,
  output: Record<string, unknown> | undefined,
): string | undefined {
  if (!output) {
    return undefined
  }

  if (
    [
      "create_field",
      "create_form",
      "create_record",
      "delete_field",
      "delete_record",
      "update_form_settings",
      "update_record",
    ].includes(toolName)
  ) {
    return readableValue(output.summary) ?? "The approved change is complete."
  }

  return "Workspace data reviewed."
}

function valueDetails(value: unknown[] | unknown): AssistantToolDetail[] {
  const values = Array.isArray(value) ? value : asArray(value)
  if (!values) {
    return []
  }
  return values
    .slice(0, 8)
    .map((entry) => {
      const item = asObject(entry)
      return detail(item?.fieldName, item?.value)
    })
    .filter(isDetail)
    .concat(
      values.length > 8
        ? [{ label: "More changes", value: `${values.length - 8}` }]
        : [],
    )
}

function changeDetails(value: unknown): AssistantToolDetail[] {
  const changes = asArray(value)
  if (!changes) {
    return []
  }
  return changes
    .slice(0, 8)
    .map((entry) => {
      const change = asObject(entry)
      const before = readableChangeValue(change?.before)
      const after = readableChangeValue(change?.after)
      const fieldName = readableValue(change?.fieldName) ?? "Column"
      return [
        before ? { label: `${fieldName} before`, value: before } : undefined,
        after ? { label: `${fieldName} after`, value: after } : undefined,
      ]
    })
    .flat()
    .filter(isDetail)
    .concat(
      changes.length > 8
        ? [{ label: "More changes", value: `${changes.length - 8}` }]
        : [],
    )
}

function formSettingDetails(value: unknown): AssistantToolDetail[] {
  const changes = asArray(value)
  if (!changes) {
    return []
  }
  return changes
    .slice(0, 8)
    .map((entry) => {
      const change = asObject(entry)
      const property =
        typeof change?.property === "string"
          ? FORM_PROPERTY_LABELS[change.property]
          : undefined
      const before = readableChangeValue(change?.before)
      const after = readableChangeValue(change?.after)
      return property
        ? [
            before
              ? { label: `${property} before`, value: before }
              : undefined,
            after ? { label: `${property} after`, value: after } : undefined,
          ]
        : []
    })
    .flat()
    .filter(isDetail)
}

function detail(
  label: unknown,
  value: unknown,
): AssistantToolDetail | undefined {
  const readableLabel = readableValue(label)
  const readable = readableValue(value)
  return readableLabel && readable
    ? { label: readableLabel, value: readable }
    : undefined
}

function readableValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const sanitized = sanitizeAssistantText(value).trim()
    return sanitized ? truncate(sanitized, 180) : undefined
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Intl.NumberFormat().format(value)
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No"
  }
  if (value === null) {
    return "Empty"
  }
  if (Array.isArray(value)) {
    const items = value
      .slice(0, 4)
      .map(readableValue)
      .filter((item): item is string => Boolean(item))
    if (items.length === 0) {
      return value.length === 0 ? "None" : undefined
    }
    return `${items.join(", ")}${value.length > items.length ? ` +${value.length - items.length}` : ""}`
  }
  return undefined
}

function readableChangeValue(value: unknown): string | undefined {
  if (value === undefined) {
    return "Not set"
  }
  if (typeof value === "string" && value.trim().length === 0) {
    return "Empty"
  }
  return readableValue(value)
}

function fieldTypeLabel(value: unknown): string | undefined {
  return typeof value === "string" && value in FIELD_TYPE_LABELS
    ? FIELD_TYPE_LABELS[value as FieldType]
    : undefined
}

function percentage(value: unknown): string | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat(undefined, {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(value)
    : undefined
}

function sentenceList(value: unknown): string | undefined {
  const values = asArray(value)
  return values ? values.map(readableValue).filter(Boolean).join(" ") : undefined
}

function namedItems(
  items: unknown[] | undefined,
  preferredKeys: string[],
): string | undefined {
  if (!items) {
    return undefined
  }
  const labels = items
    .slice(0, 4)
    .map((entry) => {
      const item = asObject(entry)
      return preferredKeys
        .map((key) => readableValue(item?.[key]))
        .find(Boolean)
    })
    .filter((value): value is string => Boolean(value))

  if (labels.length === 0) {
    return undefined
  }
  return `${labels.join(", ")}${items.length > labels.length ? ` +${items.length - labels.length}` : ""}`
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined
}

function isDetail(
  value: AssistantToolDetail | undefined,
): value is AssistantToolDetail {
  return value !== undefined
}

function truncate(value: string, maximum: number): string {
  return value.length > maximum ? `${value.slice(0, maximum - 1)}…` : value
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
