import type {
  AttachmentValue,
  CellValue,
  FieldDefinition,
  GridRecord,
} from "@/lib/domain"

/**
 * Spreadsheet apps evaluate a cell that starts with `=`, `+`, `-`, `@`, or a
 * control character as a formula. A leading apostrophe keeps the value as text
 * (CSV injection mitigation) and applies to headers as well as values.
 */
const FORMULA_PREFIX_PATTERN = /^[=+\-@\t\r]/

function csvCell(value: string): string {
  const safe = FORMULA_PREFIX_PATTERN.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe)
    ? `"${safe.replaceAll('"', '""')}"`
    : safe
}

function optionLabel(field: FieldDefinition, optionId: string) {
  return (
    field.config.options?.find((option) => option.id === optionId)?.label ??
    "Unavailable choice"
  )
}

function isAttachment(value: unknown): value is AttachmentValue {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string"
  )
}

function friendlyCellValue(
  field: FieldDefinition,
  value: CellValue | undefined,
): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (Array.isArray(value)) {
    if (field.type === "attachment") {
      return value.filter(isAttachment).map((item) => item.name).join(", ")
    }
    if (field.type === "multiSelect") {
      return value
        .filter((item): item is string => typeof item === "string")
        .map((item) => optionLabel(field, item))
        .join(", ")
    }
    return value.join(", ")
  }
  if (field.type === "singleSelect" && typeof value === "string") {
    return optionLabel(field, value)
  }
  if (
    (field.type === "date" || field.type === "createdTime") &&
    typeof value === "number"
  ) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return field.config.dateStyle === "dateTime"
        ? parsed.toISOString()
        : parsed.toISOString().slice(0, 10)
    }
  }
  return String(value)
}

export function createRecordsCsv(
  fields: readonly FieldDefinition[],
  records: readonly GridRecord[],
): string {
  const header = fields.map((field) => csvCell(field.name)).join(",")
  const rows = records.map((record) =>
    fields
      .map((field) =>
        csvCell(friendlyCellValue(field, record.values[field.id])),
      )
      .join(","),
  )
  return [header, ...rows].join("\r\n")
}

export function csvFileName(name: string | undefined): string {
  const normalized = (name ?? "records")
    .trim()
    .replaceAll(/[^a-zA-Z0-9._ -]+/g, "")
    .replaceAll(/\s+/g, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^[.-]+|[.-]+$/g, "")
    .toLowerCase()
  return `${normalized || "records"}.csv`
}
