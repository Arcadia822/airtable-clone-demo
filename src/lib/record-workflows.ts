import type {
  FieldDefinition,
  GridRecord,
} from "@/lib/domain"

export const MAX_BULK_RECORDS = 100

export type WritableRecordValues = Record<
  string,
  string | number | boolean | string[]
>

export function selectedVisibleRecords(
  records: readonly GridRecord[],
  selectedRecordIds: ReadonlySet<string>,
): GridRecord[] {
  return records.filter((record) => selectedRecordIds.has(record.id))
}

export function toggleVisibleRecordSelection(
  selectedRecordIds: ReadonlySet<string>,
  visibleRecordIds: readonly string[],
  selected: boolean,
): Set<string> {
  const next = new Set(selectedRecordIds)
  for (const recordId of visibleRecordIds) {
    if (selected) next.add(recordId)
    else next.delete(recordId)
  }
  return next
}

export function toggleRecordSelection(
  selectedRecordIds: ReadonlySet<string>,
  recordId: string,
  selected: boolean,
): Set<string> {
  const next = new Set(selectedRecordIds)
  if (selected) next.add(recordId)
  else next.delete(recordId)
  return next
}

export function pruneRecordSelection(
  selectedRecordIds: ReadonlySet<string>,
  visibleRecordIds: ReadonlySet<string>,
): Set<string> {
  const next = new Set<string>()
  for (const recordId of selectedRecordIds) {
    if (visibleRecordIds.has(recordId)) next.add(recordId)
  }
  return next
}

export function sameRecordSelection(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  if (left.size !== right.size) return false
  for (const recordId of left) {
    if (!right.has(recordId)) return false
  }
  return true
}

export function duplicateRecordValues(
  record: GridRecord,
  fields: readonly FieldDefinition[],
): WritableRecordValues {
  const values: WritableRecordValues = {}
  for (const field of fields) {
    if (
      field.type === "attachment" ||
      field.type === "createdBy" ||
      field.type === "createdTime"
    ) {
      continue
    }
    const value = record.values[field.id]
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      (Array.isArray(value) &&
        value.every((item) => typeof item === "string"))
    ) {
      values[field.id] = value
    }
  }
  return values
}

export function chunkBulkRecords<T>(
  records: readonly T[],
  size = MAX_BULK_RECORDS,
): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error("Bulk record batch size must be a positive integer.")
  }
  const chunks: T[][] = []
  for (let index = 0; index < records.length; index += size) {
    chunks.push(records.slice(index, index + size))
  }
  return chunks
}

export function recordLabel(
  value: unknown,
): string {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  return "Untitled record"
}

export function recordDeletionDescription(
  labels: readonly string[],
): string {
  if (labels.length === 1) {
    return `“${labels[0]}” will be removed from this table for every collaborator.`
  }
  const preview = labels.slice(0, 3).map((label) => `“${label}”`)
  const remainder = labels.length - preview.length
  return `${preview.join(", ")}${
    remainder > 0 ? ` and ${remainder.toLocaleString()} more` : ""
  } will be removed from this table for every collaborator.`
}
