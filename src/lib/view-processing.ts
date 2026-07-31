import type {
  CellValue,
  FieldDefinition,
  GridRecord,
} from "@/lib/domain"
import { compareRanks } from "@/lib/rank"

export type SavedViewFilterOperator =
  | "is"
  | "is_not"
  | "contains"
  | "does_not_contain"
  | "is_empty"
  | "is_not_empty"
  | "greater_than"
  | "less_than"
  | "before"
  | "after"

export type SavedViewDirection = "asc" | "desc"

export interface SavedViewFilter {
  id: string
  fieldId: string
  operator: SavedViewFilterOperator
  value?: CellValue
}

export interface SavedViewSort {
  id: string
  fieldId: string
  direction: SavedViewDirection
  rank: string
}

export interface SavedViewGroup {
  id: string
  fieldId: string
  direction: SavedViewDirection
  rank: string
}

export interface SavedViewDefinition {
  filterConjunction: "and" | "or"
  filters: readonly SavedViewFilter[]
  sorts: readonly SavedViewSort[]
  groups: readonly SavedViewGroup[]
}

/**
 * Rating is supported by the view engine ahead of being exposed as a creatable
 * column type. Keeping that compatibility here lets a future rating column use
 * the same numeric filtering, sorting, and grouping behavior immediately.
 */
export type ViewProcessableField = Omit<FieldDefinition, "type"> & {
  type: FieldDefinition["type"] | "rating"
}

export interface SavedViewRecordGroup {
  fieldName: string
  label: string
  records: GridRecord[]
  children: SavedViewRecordGroup[]
}

export interface ProcessedSavedView {
  records: GridRecord[]
  groups: SavedViewRecordGroup[]
}

export interface FlattenedSavedViewGroups {
  records: GridRecord[]
  labelsByRecordId: Record<string, string>
}

type RankedItem = {
  rank: string
}

const textCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
})

function orderedByRank<T extends RankedItem>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (left, right) =>
        compareRanks(left.item, right.item) ||
        left.index - right.index,
    )
    .map(({ item }) => item)
}

function fieldValue(
  record: GridRecord,
  field: ViewProcessableField,
): CellValue | undefined {
  const stored = record.values[field.id]
  if (stored !== undefined) return stored
  if (field.type === "createdTime") return record.createdAt
  if (field.type === "createdBy") return record.createdBy
  return undefined
}

function isBlank(value: CellValue | undefined): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === "string") return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

function normalizedText(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase()
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined
  }
  if (typeof value !== "string" || !value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function timestamp(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && !Number.isNaN(new Date(value).getTime())
      ? value
      : undefined
  }
  if (typeof value !== "string" || !value.trim()) return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

function dateOnlyKey(value: unknown): string | undefined {
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)
  ) {
    return value.slice(0, 10)
  }
  const parsed = timestamp(value)
  if (parsed === undefined) return undefined
  const date = new Date(parsed)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value
  const normalized = normalizedText(value)
  if (["true", "checked", "yes", "1"].includes(normalized)) return true
  if (["false", "unchecked", "no", "0"].includes(normalized)) return false
  return undefined
}

function optionLabel(
  field: ViewProcessableField,
  optionId: string,
): string | undefined {
  return field.config.options?.find((option) => option.id === optionId)?.label
}

function selectTokens(
  field: ViewProcessableField,
  value: unknown,
): string[] {
  const optionIds = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string"
      ? [value]
      : []

  return optionIds.flatMap((optionId) => {
    const label = optionLabel(field, optionId)
    return label ? [normalizedText(optionId), normalizedText(label)] : [
      normalizedText(optionId),
    ]
  })
}

function attachmentNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (
      typeof item === "object" &&
      item !== null &&
      "name" in item &&
      typeof item.name === "string"
    ) {
      return [item.name]
    }
    return []
  })
}

function searchableTokens(
  field: ViewProcessableField,
  value: CellValue | undefined,
): string[] {
  if (field.type === "singleSelect" || field.type === "multiSelect") {
    return selectTokens(field, value)
  }
  if (field.type === "attachment") {
    return attachmentNames(value).map(normalizedText)
  }
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map(normalizedText)
  }
  return [normalizedText(value)]
}

function equalSelection(
  field: ViewProcessableField,
  actual: CellValue | undefined,
  expected: CellValue | undefined,
): boolean {
  const actualTokens = searchableTokens(field, actual)
  if (field.type !== "multiSelect") {
    const expectedToken = normalizedText(expected)
    return actualTokens.includes(expectedToken)
  }

  const expectedItems = Array.isArray(expected) ? expected : [expected]
  const expectedTokens = expectedItems
    .filter((item): item is string => typeof item === "string")
    .map((item) => {
      const normalized = normalizedText(item)
      const matchingOption = field.config.options?.find(
        (option) => normalizedText(option.label) === normalized,
      )
      return normalizedText(matchingOption?.id ?? item)
    })
    .sort()
  if (!Array.isArray(expected)) {
    return searchableTokens(field, actual).some((item) =>
      searchableTokens(field, expected).includes(item),
    )
  }

  const actualOptionIds = Array.isArray(actual)
    ? actual
        .filter((item): item is string => typeof item === "string")
        .map(normalizedText)
        .sort()
    : []
  return (
    actualOptionIds.length === expectedTokens.length &&
    actualOptionIds.every((item, index) => item === expectedTokens[index])
  )
}

function valuesAreEqual(
  field: ViewProcessableField,
  actual: CellValue | undefined,
  expected: CellValue | undefined,
): boolean {
  if (field.type === "singleSelect" || field.type === "multiSelect") {
    return equalSelection(field, actual, expected)
  }
  if (
    field.type === "number" ||
    field.type === "currency" ||
    field.type === "percent" ||
    field.type === "rating"
  ) {
    const left = finiteNumber(actual)
    const right = finiteNumber(expected)
    return left !== undefined && right !== undefined && left === right
  }
  if (field.type === "checkbox") {
    const left = booleanValue(actual)
    const right = booleanValue(expected)
    return left !== undefined && right !== undefined && left === right
  }
  if (field.type === "date" || field.type === "createdTime") {
    if (field.config.dateStyle !== "dateTime") {
      const left = dateOnlyKey(actual)
      const right = dateOnlyKey(expected)
      return left !== undefined && right !== undefined && left === right
    }
    const left = timestamp(actual)
    const right = timestamp(expected)
    return left !== undefined && right !== undefined && left === right
  }
  return normalizedText(actual) === normalizedText(expected)
}

function compareValues(
  field: ViewProcessableField,
  left: CellValue | undefined,
  right: CellValue | undefined,
): number | undefined {
  if (
    field.type === "number" ||
    field.type === "currency" ||
    field.type === "percent" ||
    field.type === "rating"
  ) {
    const leftNumber = finiteNumber(left)
    const rightNumber = finiteNumber(right)
    if (leftNumber === undefined || rightNumber === undefined) return undefined
    return leftNumber - rightNumber
  }
  if (field.type === "date" || field.type === "createdTime") {
    if (field.config.dateStyle !== "dateTime") {
      const leftDate = dateOnlyKey(left)
      const rightDate = dateOnlyKey(right)
      if (leftDate === undefined || rightDate === undefined) return undefined
      return leftDate.localeCompare(rightDate)
    }
    const leftTime = timestamp(left)
    const rightTime = timestamp(right)
    if (leftTime === undefined || rightTime === undefined) return undefined
    return leftTime - rightTime
  }
  if (field.type === "checkbox") {
    const leftBoolean = booleanValue(left)
    const rightBoolean = booleanValue(right)
    if (leftBoolean === undefined || rightBoolean === undefined) return undefined
    return Number(leftBoolean) - Number(rightBoolean)
  }
  const leftLabel = comparableText(field, left)
  const rightLabel = comparableText(field, right)
  return textCollator.compare(leftLabel, rightLabel)
}

function comparableText(
  field: ViewProcessableField,
  value: CellValue | undefined,
): string {
  if (field.type === "singleSelect" && typeof value === "string") {
    return optionLabel(field, value) ?? "Unavailable choice"
  }
  if (field.type === "multiSelect" && Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => optionLabel(field, item) ?? "Unavailable choice")
      .sort((left, right) => textCollator.compare(left, right))
      .join(", ")
  }
  if (field.type === "attachment") return attachmentNames(value).join(", ")
  if (
    field.type === "createdBy" &&
    typeof value === "string" &&
    looksLikeOpaqueIdentifier(value)
  ) {
    return "Team member"
  }
  return String(value ?? "")
}

function matchesFilter(
  record: GridRecord,
  field: ViewProcessableField,
  filter: SavedViewFilter,
): boolean {
  const actual = fieldValue(record, field)
  if (filter.operator === "is_empty") return isBlank(actual)
  if (filter.operator === "is_not_empty") return !isBlank(actual)

  const expected = filter.value
  if (filter.operator === "is") {
    return valuesAreEqual(field, actual, expected)
  }
  if (filter.operator === "is_not") {
    return !valuesAreEqual(field, actual, expected)
  }

  if (
    filter.operator === "contains" ||
    filter.operator === "does_not_contain"
  ) {
    const expectedToken = normalizedText(expected)
    const contains =
      expectedToken.length > 0 &&
      searchableTokens(field, actual).some((token) =>
        token.includes(expectedToken),
      )
    return filter.operator === "contains" ? contains : !contains
  }

  const comparison = compareValues(field, actual, expected)
  if (comparison === undefined) return false
  if (filter.operator === "greater_than" || filter.operator === "after") {
    return comparison > 0
  }
  return comparison < 0
}

export function filterRecordsForView(
  records: readonly GridRecord[],
  fields: readonly ViewProcessableField[],
  filters: readonly SavedViewFilter[],
  conjunction: "and" | "or",
): GridRecord[] {
  const fieldsById = new Map(fields.map((field) => [field.id, field]))
  const applicable = filters.flatMap((filter) => {
    const field = fieldsById.get(filter.fieldId)
    return field ? [{ field, filter }] : []
  })
  if (!applicable.length) return [...records]

  return records.filter((record) => {
    const matches = applicable.map(({ field, filter }) =>
      matchesFilter(record, field, filter),
    )
    return conjunction === "and" ? matches.every(Boolean) : matches.some(Boolean)
  })
}

function compareForSort(
  field: ViewProcessableField,
  left: CellValue | undefined,
  right: CellValue | undefined,
  direction: SavedViewDirection,
): number {
  const leftBlank = isBlank(left)
  const rightBlank = isBlank(right)
  if (leftBlank || rightBlank) {
    if (leftBlank === rightBlank) return 0
    return leftBlank ? 1 : -1
  }
  const compared = compareValues(field, left, right) ?? 0
  return direction === "desc" ? -compared : compared
}

export function sortRecordsForView(
  records: readonly GridRecord[],
  fields: readonly ViewProcessableField[],
  sorts: readonly SavedViewSort[],
): GridRecord[] {
  const fieldsById = new Map(fields.map((field) => [field.id, field]))
  const applicable = orderedByRank(sorts).flatMap((sort) => {
    const field = fieldsById.get(sort.fieldId)
    return field ? [{ field, sort }] : []
  })
  if (!applicable.length) return [...records]

  return records
    .map((record, index) => ({ record, index }))
    .sort((left, right) => {
      for (const { field, sort } of applicable) {
        const compared = compareForSort(
          field,
          fieldValue(left.record, field),
          fieldValue(right.record, field),
          sort.direction,
        )
        if (compared !== 0) return compared
      }
      return left.index - right.index
    })
    .map(({ record }) => record)
}

export function applySavedView(
  records: readonly GridRecord[],
  fields: readonly ViewProcessableField[],
  view: Pick<
    SavedViewDefinition,
    "filterConjunction" | "filters" | "sorts"
  >,
): GridRecord[] {
  const filtered = filterRecordsForView(
    records,
    fields,
    view.filters,
    view.filterConjunction,
  )
  return sortRecordsForView(filtered, fields, view.sorts)
}

function looksLikeOpaqueIdentifier(value: string): boolean {
  const normalized = value.trim()
  return (
    /^(?:user|org|fld|field|rec|record|att|option|opt|view|tbl|table|base)_[a-z0-9_-]+$/i.test(
      normalized,
    ) ||
    (!normalized.includes(" ") &&
      !normalized.includes("@") &&
      normalized.length >= 24 &&
      /^[a-z0-9_-]+$/i.test(normalized))
  )
}

function friendlyNumber(value: number): string {
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 12,
  }).format(value)
}

function groupLabel(
  field: ViewProcessableField,
  value: CellValue | undefined,
): string {
  if (isBlank(value)) return "Empty"
  if (field.type === "checkbox") {
    return booleanValue(value) ? "Checked" : "Not checked"
  }
  if (field.type === "singleSelect" && typeof value === "string") {
    return optionLabel(field, value) ?? "Unavailable choice"
  }
  if (field.type === "multiSelect" && Array.isArray(value)) {
    const labels = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => optionLabel(field, item) ?? "Unavailable choice")
      .sort((left, right) => textCollator.compare(left, right))
    return labels.length ? [...new Set(labels)].join(", ") : "Empty"
  }
  if (
    field.type === "number" ||
    field.type === "rating" ||
    field.type === "percent" ||
    field.type === "currency"
  ) {
    const numeric = finiteNumber(value)
    if (numeric === undefined) return "Empty"
    if (field.type === "percent") {
      return new Intl.NumberFormat("en", {
        style: "percent",
        maximumFractionDigits: field.config.precision ?? 2,
      }).format(numeric)
    }
    if (field.type === "currency" && field.config.currency) {
      try {
        return new Intl.NumberFormat("en", {
          style: "currency",
          currency: field.config.currency,
          maximumFractionDigits: field.config.precision ?? 2,
        }).format(numeric)
      } catch {
        return friendlyNumber(numeric)
      }
    }
    return friendlyNumber(numeric)
  }
  if (field.type === "date" || field.type === "createdTime") {
    const parsed = timestamp(value)
    if (parsed === undefined) return "Empty"
    return new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      ...(field.config.dateStyle === "dateTime"
        ? { timeStyle: "short" as const }
        : {}),
    }).format(parsed)
  }
  if (field.type === "attachment") {
    const names = attachmentNames(value)
    return names.length ? names.join(", ") : "Files attached"
  }
  if (
    field.type === "createdBy" &&
    typeof value === "string" &&
    looksLikeOpaqueIdentifier(value)
  ) {
    return "Team member"
  }
  return String(value).trim() || "Empty"
}

type GroupBucket = {
  label: string
  value: CellValue | undefined
  records: GridRecord[]
}

function compareGroupBuckets(
  field: ViewProcessableField,
  left: GroupBucket,
  right: GroupBucket,
  direction: SavedViewDirection,
): number {
  const leftBlank = isBlank(left.value)
  const rightBlank = isBlank(right.value)
  if (leftBlank || rightBlank) {
    if (leftBlank === rightBlank) return 0
    return leftBlank ? 1 : -1
  }
  if (
    field.type === "number" ||
    field.type === "currency" ||
    field.type === "percent" ||
    field.type === "rating" ||
    field.type === "date" ||
    field.type === "createdTime" ||
    field.type === "checkbox"
  ) {
    return compareForSort(field, left.value, right.value, direction)
  }
  const compared = textCollator.compare(left.label, right.label)
  return direction === "desc" ? -compared : compared
}

function groupAtLevel(
  records: readonly GridRecord[],
  fieldsById: ReadonlyMap<string, ViewProcessableField>,
  definitions: readonly SavedViewGroup[],
  level: number,
): SavedViewRecordGroup[] {
  const definition = definitions[level]
  if (!definition) return []
  const field = fieldsById.get(definition.fieldId)
  if (!field) {
    return groupAtLevel(records, fieldsById, definitions, level + 1)
  }

  const buckets = new Map<string, GroupBucket>()
  for (const record of records) {
    const value = fieldValue(record, field)
    const label = groupLabel(field, value)
    const bucket = buckets.get(label)
    if (bucket) {
      bucket.records.push(record)
    } else {
      buckets.set(label, { label, value, records: [record] })
    }
  }

  return [...buckets.values()]
    .sort((left, right) =>
      compareGroupBuckets(field, left, right, definition.direction),
    )
    .map((bucket) => ({
      fieldName: field.name,
      label: bucket.label,
      records: bucket.records,
      children: groupAtLevel(
        bucket.records,
        fieldsById,
        definitions,
        level + 1,
      ),
    }))
}

export function groupRecordsForView(
  records: readonly GridRecord[],
  fields: readonly ViewProcessableField[],
  groups: readonly SavedViewGroup[],
): SavedViewRecordGroup[] {
  if (!groups.length) return []
  const fieldsById = new Map(fields.map((field) => [field.id, field]))
  return groupAtLevel(
    records,
    fieldsById,
    orderedByRank(groups),
    0,
  )
}

export function flattenSavedViewGroups(
  groups: readonly SavedViewRecordGroup[],
): FlattenedSavedViewGroups {
  const records: GridRecord[] = []
  const labelsByRecordId: Record<string, string> = {}
  const includedRecordIds = new Set<string>()

  function visit(
    group: SavedViewRecordGroup,
    parentLabels: readonly string[],
  ) {
    const labels = [
      ...parentLabels,
      `${group.fieldName}: ${group.label}`,
    ]
    if (group.children.length) {
      for (const child of group.children) visit(child, labels)
      return
    }
    const friendlyPath = labels.join(" · ")
    for (const record of group.records) {
      if (includedRecordIds.has(record.id)) continue
      includedRecordIds.add(record.id)
      records.push(record)
      labelsByRecordId[record.id] = friendlyPath
    }
  }

  for (const group of groups) visit(group, [])
  return { records, labelsByRecordId }
}

export function processSavedView(
  records: readonly GridRecord[],
  fields: readonly ViewProcessableField[],
  view: SavedViewDefinition,
): ProcessedSavedView {
  const processedRecords = applySavedView(records, fields, view)
  return {
    records: processedRecords,
    groups: groupRecordsForView(processedRecords, fields, view.groups),
  }
}
