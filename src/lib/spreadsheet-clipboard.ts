import type {
  CellValue,
  FieldDefinition,
  GridRecord,
} from "@/lib/domain"

export type ClipboardCellErrorCode =
  | "invalid_number"
  | "invalid_percentage"
  | "invalid_rating"
  | "invalid_checkbox"
  | "invalid_date"
  | "invalid_email"
  | "invalid_phone"
  | "invalid_url"
  | "unknown_choice"
  | "ambiguous_choice"
  | "read_only_column"
  | "file_upload_required"
  | "missing_destination"

export type ClipboardCellConversion =
  | { ok: true; value: CellValue }
  | {
      ok: false
      code: ClipboardCellErrorCode
      message: string
    }

export interface ConvertedClipboardCell {
  rowNumber: number
  columnNumber: number
  columnName: string
  fieldId: string
  value: CellValue
}

export interface ClipboardCellError {
  rowNumber: number
  columnNumber: number
  columnName: string
  input: string
  code: ClipboardCellErrorCode
  message: string
}

export interface ClipboardPasteConversion {
  rows: Array<Record<string, CellValue>>
  cells: ConvertedClipboardCell[]
  errors: ClipboardCellError[]
  totalCellCount: number
  convertedCellCount: number
  summary: string
}

function detectDelimiter(text: string): "\t" | "," {
  let quoted = false
  let tabs = 0
  let commas = 0

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        index += 1
      } else {
        quoted = !quoted
      }
      continue
    }
    if (quoted) continue
    if (character === "\t") tabs += 1
    if (character === ",") commas += 1
  }

  return tabs > 0 || commas === 0 ? "\t" : ","
}

function rectangularRows(rows: string[][]): string[][] {
  const width = Math.max(1, ...rows.map((row) => row.length))
  return rows.map((row) => [
    ...row,
    ...Array.from({ length: width - row.length }, () => ""),
  ])
}

/**
 * Parses the tab-delimited format produced by spreadsheets as well as
 * comma-delimited clipboard text. Quotes may contain delimiters, escaped
 * quotes, and line breaks. Ragged input is padded to a safe rectangle.
 */
export function parseClipboardRectangle(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "")
  const delimiter = detectDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  let endedWithRowBreak = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]

    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        cell += character
      }
      endedWithRowBreak = false
      continue
    }

    if (character === '"' && cell.length === 0) {
      quoted = true
      endedWithRowBreak = false
      continue
    }
    if (character === delimiter) {
      row.push(cell)
      cell = ""
      endedWithRowBreak = false
      continue
    }
    if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ""
      endedWithRowBreak = true
      continue
    }

    cell += character
    endedWithRowBreak = false
  }

  if (!endedWithRowBreak || row.length > 0 || cell.length > 0 || rows.length === 0) {
    row.push(cell)
    rows.push(row)
  }

  return rectangularRows(rows)
}

function quoteClipboardCell(value: string): string {
  if (
    !/[\t\n\r",]/.test(value) &&
    value === value.trim()
  ) {
    return value
  }
  return `"${value.replaceAll('"', '""')}"`
}

function localDate(value: number): string {
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function localDateTime(value: number): string {
  const date = new Date(value)
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${localDate(value)} ${hours}:${minutes}`
}

function optionLabel(
  field: FieldDefinition,
  optionId: string,
): string | undefined {
  return field.config.options?.find((option) => option.id === optionId)?.label
}

function attachmentNames(value: CellValue | undefined): string[] {
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

function valueForRecord(
  record: GridRecord,
  field: FieldDefinition,
): CellValue | undefined {
  const stored = record.values[field.id]
  if (stored !== undefined) return stored
  if (field.type === "createdTime") return record.createdAt
  if (field.type === "createdBy") return record.createdBy
  return undefined
}

export function formatClipboardCellValue(
  value: CellValue | undefined,
  field: FieldDefinition,
): string {
  if (value === null || value === undefined) return ""

  if (field.type === "singleSelect") {
    if (typeof value !== "string") return ""
    return optionLabel(field, value) ?? "Unavailable choice"
  }
  if (field.type === "multiSelect") {
    if (!Array.isArray(value)) return ""
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => optionLabel(field, item) ?? "Unavailable choice")
      .join(", ")
  }
  if (field.type === "checkbox") {
    return value === true ? "Checked" : "Not checked"
  }
  if (field.type === "percent" && typeof value === "number") {
    return new Intl.NumberFormat("en", {
      style: "percent",
      maximumFractionDigits: field.config.precision ?? 2,
    }).format(value)
  }
  if (field.type === "rating" && typeof value === "number") {
    return String(value)
  }
  if (field.type === "currency" && typeof value === "number") {
    if (!field.config.currency) return String(value)
    try {
      return new Intl.NumberFormat("en", {
        style: "currency",
        currency: field.config.currency,
        maximumFractionDigits: field.config.precision ?? 2,
      }).format(value)
    } catch {
      return String(value)
    }
  }
  if (
    (field.type === "date" || field.type === "createdTime") &&
    typeof value === "number"
  ) {
    return field.config.dateStyle === "dateTime"
      ? localDateTime(value)
      : localDate(value)
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
  if (Array.isArray(value)) return value.map(String).join(", ")
  return String(value)
}

/**
 * Serializes selected records and columns as a spreadsheet-compatible TSV
 * rectangle. Choice labels and attachment names are copied instead of IDs.
 */
export function serializeClipboardRectangle(
  records: readonly GridRecord[],
  fields: readonly FieldDefinition[],
): string {
  return records
    .map((record) =>
      fields
        .map((field) =>
          quoteClipboardCell(
            formatClipboardCellValue(valueForRecord(record, field), field),
          ),
        )
        .join("\t"),
    )
    .join("\n")
}

function normalizeChoiceLabel(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function choiceMatches(
  field: FieldDefinition,
  label: string,
): NonNullable<FieldDefinition["config"]["options"]> {
  const normalized = normalizeChoiceLabel(label)
  return (field.config.options ?? []).filter(
    (option) => normalizeChoiceLabel(option.label) === normalized,
  )
}

function choiceError(
  field: FieldDefinition,
  label: string,
): ClipboardCellConversion {
  const matches = choiceMatches(field, label)
  if (matches.length > 1) {
    return {
      ok: false,
      code: "ambiguous_choice",
      message: `That entry matches more than one choice in ${field.name}. Rename one of those choices first.`,
    }
  }
  return {
    ok: false,
    code: "unknown_choice",
    message: `That entry is not an available choice in ${field.name}.`,
  }
}

function parseChoice(
  input: string,
  field: FieldDefinition,
): ClipboardCellConversion {
  const matches = choiceMatches(field, input)
  if (matches.length === 1) return { ok: true, value: matches[0]!.id }
  return choiceError(field, input)
}

function parseMultipleChoices(
  input: string,
  field: FieldDefinition,
): ClipboardCellConversion {
  const wholeValueMatches = choiceMatches(field, input)
  if (wholeValueMatches.length === 1) {
    return { ok: true, value: [wholeValueMatches[0]!.id] }
  }

  const labels = input
    .split(/\s*(?:,|;|\n)\s*/)
    .map((label) => label.trim())
    .filter(Boolean)
  const optionIds: string[] = []
  for (const label of labels) {
    const matches = choiceMatches(field, label)
    if (matches.length !== 1) return choiceError(field, label)
    if (!optionIds.includes(matches[0]!.id)) optionIds.push(matches[0]!.id)
  }
  return labels.length
    ? { ok: true, value: optionIds }
    : { ok: true, value: null }
}

function numericText(
  input: string,
  options: {
    allowCurrency: boolean
    allowPercent: boolean
    currencyCode?: string
  },
): { value?: number; hadPercent: boolean } {
  let normalized = input.trim().replaceAll("\u00a0", " ")
  const negative =
    normalized.startsWith("(") && normalized.endsWith(")")
  if (negative) normalized = normalized.slice(1, -1).trim()

  const hadPercent = normalized.endsWith("%")
  if (hadPercent) normalized = normalized.slice(0, -1).trim()
  if (hadPercent && !options.allowPercent) return { hadPercent }

  if (options.allowCurrency) {
    if (options.currencyCode) {
      const escapedCode = options.currencyCode.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      )
      normalized = normalized.replace(
        new RegExp(`\\b${escapedCode}\\b`, "gi"),
        "",
      )
    }
    normalized = normalized
      .replace(/\b[A-Z]{3}\b/g, "")
      .replace(/[$£€¥₹₩₽₺₴₦₫₪₱฿₡₲₵]/g, "")
  }
  normalized = normalized.replace(/[\s'_]/g, "")

  const commaIndex = normalized.lastIndexOf(",")
  const dotIndex = normalized.lastIndexOf(".")
  if (commaIndex >= 0 && dotIndex >= 0) {
    const decimal = commaIndex > dotIndex ? "," : "."
    const thousands = decimal === "," ? /\./g : /,/g
    normalized = normalized.replace(thousands, "")
    if (decimal === ",") normalized = normalized.replace(",", ".")
  } else if (commaIndex >= 0) {
    const looksLikeThousands =
      /^[+-]?\d{1,3}(?:,\d{3})+$/.test(normalized)
    normalized = looksLikeThousands
      ? normalized.replaceAll(",", "")
      : normalized.replace(",", ".")
  }

  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) {
    return { hadPercent }
  }
  const parsed = Number(normalized) * (negative ? -1 : 1)
  return Number.isFinite(parsed)
    ? { value: parsed, hadPercent }
    : { hadPercent }
}

function parseNumber(
  input: string,
  field: FieldDefinition,
): ClipboardCellConversion {
  const parsed = numericText(input, {
    allowCurrency: field.type === "currency",
    allowPercent: field.type === "percent",
    currencyCode: field.config.currency,
  })
  if (parsed.value === undefined) {
    return {
      ok: false,
      code:
        field.type === "percent"
          ? "invalid_percentage"
          : "invalid_number",
      message:
        field.type === "percent"
          ? `Enter ${field.name} as a percentage, such as 75%.`
          : `Enter a valid number for ${field.name}.`,
    }
  }
  if (field.type === "percent") {
    const value =
      parsed.hadPercent || Math.abs(parsed.value) > 1
        ? parsed.value / 100
        : parsed.value
    return { ok: true, value }
  }
  return { ok: true, value: parsed.value }
}

function parseRating(
  input: string,
  field: FieldDefinition,
): ClipboardCellConversion {
  const normalized = input.trim()
  const namedMatch = normalized.match(
    /^([1-5])(?:\s*(?:\/\s*5|stars?))?$/i,
  )
  const starMatch = normalized.match(/^([★⭐]{1,5})[☆\s]*$/u)
  const value = namedMatch
    ? Number(namedMatch[1])
    : starMatch
      ? Array.from(starMatch[1]!).length
      : undefined
  if (value === undefined || !Number.isInteger(value)) {
    return {
      ok: false,
      code: "invalid_rating",
      message: `Enter ${field.name} as a whole-number rating from 1 to 5.`,
    }
  }
  return { ok: true, value }
}

function parseCheckbox(
  input: string,
  field: FieldDefinition,
): ClipboardCellConversion {
  const normalized = input.trim().toLocaleLowerCase()
  if (
    ["true", "checked", "yes", "y", "1", "x", "✓"].includes(normalized)
  ) {
    return { ok: true, value: true }
  }
  if (
    ["false", "not checked", "unchecked", "no", "n", "0", "✗"].includes(
      normalized,
    )
  ) {
    return { ok: true, value: false }
  }
  return {
    ok: false,
    code: "invalid_checkbox",
    message: `Use Checked or Not checked for ${field.name}.`,
  }
}

function parsedDate(input: string): number | undefined {
  const value = Date.parse(input)
  return Number.isNaN(value) ? undefined : value
}

function parseDate(
  input: string,
  field: FieldDefinition,
): ClipboardCellConversion {
  const parsed = parsedDate(input)
  if (parsed === undefined) {
    return {
      ok: false,
      code: "invalid_date",
      message: `Enter a valid date for ${field.name}, such as 2026-07-30.`,
    }
  }
  return {
    ok: true,
    value:
      field.config.dateStyle === "dateTime"
        ? localDateTime(parsed).replace(" ", "T")
        : localDate(parsed),
  }
}

function parseEmail(
  input: string,
  field: FieldDefinition,
): ClipboardCellConversion {
  const value = input.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return {
      ok: false,
      code: "invalid_email",
      message: `Enter a valid email address for ${field.name}.`,
    }
  }
  return { ok: true, value }
}

function parsePhone(
  input: string,
  field: FieldDefinition,
): ClipboardCellConversion {
  const value = input.trim()
  const digitCount = value.replace(/\D/g, "").length
  if (
    digitCount < 3 ||
    !/^[+()\d\s.-]+(?:\s*(?:x|ext\.?)\s*\d+)?$/i.test(value)
  ) {
    return {
      ok: false,
      code: "invalid_phone",
      message: `Enter a valid phone number for ${field.name}.`,
    }
  }
  return { ok: true, value }
}

function parseUrl(
  input: string,
  field: FieldDefinition,
): ClipboardCellConversion {
  const trimmed = input.trim()
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`
  try {
    const url = new URL(candidate)
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      !url.hostname
    ) {
      throw new Error("Unsupported URL")
    }
    return { ok: true, value: url.toString() }
  } catch {
    return {
      ok: false,
      code: "invalid_url",
      message: `Enter a valid web link for ${field.name}.`,
    }
  }
}

export function convertClipboardCell(
  input: string,
  field: FieldDefinition,
): ClipboardCellConversion {
  if (
    field.type === "createdTime" ||
    field.type === "createdBy"
  ) {
    return {
      ok: false,
      code: "read_only_column",
      message: `${field.name} is filled in automatically and cannot be pasted.`,
    }
  }
  if (field.type === "attachment") {
    return {
      ok: false,
      code: "file_upload_required",
      message: `Files cannot be pasted into ${field.name}. Upload them instead.`,
    }
  }
  if (input.length === 0) return { ok: true, value: null }

  if (
    field.type === "singleLineText" ||
    field.type === "longText"
  ) {
    return { ok: true, value: input }
  }
  if (
    field.type === "number" ||
    field.type === "currency" ||
    field.type === "percent"
  ) {
    return parseNumber(input, field)
  }
  if (field.type === "rating") return parseRating(input, field)
  if (field.type === "checkbox") return parseCheckbox(input, field)
  if (field.type === "date") return parseDate(input, field)
  if (field.type === "email") return parseEmail(input, field)
  if (field.type === "phone") return parsePhone(input, field)
  if (field.type === "url") return parseUrl(input, field)
  if (field.type === "singleSelect") return parseChoice(input, field)
  return parseMultipleChoices(input, field)
}

function pasteSummary(
  totalCellCount: number,
  convertedCellCount: number,
  errorCount: number,
): string {
  if (totalCellCount === 0) return "There is nothing to paste."
  if (errorCount === 0) {
    return `${convertedCellCount} ${
      convertedCellCount === 1 ? "cell is" : "cells are"
    } ready to paste.`
  }
  if (errorCount === totalCellCount) {
    if (errorCount === 1) {
      return "The pasted cell needs attention. Fix the highlighted value and try again."
    }
    return `All ${errorCount} ${
      errorCount === 1 ? "cell needs" : "cells need"
    } attention. Fix the highlighted values and try again.`
  }
  return `${errorCount} of ${totalCellCount} ${
    errorCount === 1 ? "cell needs" : "cells need"
  } attention. Fix the highlighted ${
    errorCount === 1 ? "value" : "values"
  } and try again.`
}

/**
 * Converts a parsed clipboard rectangle into row updates. Valid cells are
 * returned separately from row maps so callers can highlight or preview them;
 * invalid cells include friendly one-based row and column locations.
 */
export function convertClipboardRectangle(
  rectangle: readonly (readonly string[])[],
  fields: readonly FieldDefinition[],
): ClipboardPasteConversion {
  const rows: Array<Record<string, CellValue>> = rectangle.map(() => ({}))
  const cells: ConvertedClipboardCell[] = []
  const errors: ClipboardCellError[] = []
  const width = Math.max(0, ...rectangle.map((row) => row.length))
  const totalCellCount = rectangle.length * width

  for (let rowIndex = 0; rowIndex < rectangle.length; rowIndex += 1) {
    const row = rectangle[rowIndex] ?? []
    for (let columnIndex = 0; columnIndex < width; columnIndex += 1) {
      const input = row[columnIndex] ?? ""
      const field = fields[columnIndex]
      if (!field) {
        errors.push({
          rowNumber: rowIndex + 1,
          columnNumber: columnIndex + 1,
          columnName: `Column ${columnIndex + 1}`,
          input,
          code: "missing_destination",
          message: `Column ${columnIndex + 1} has no destination in this selection.`,
        })
        continue
      }

      const converted = convertClipboardCell(input, field)
      if (!converted.ok) {
        errors.push({
          rowNumber: rowIndex + 1,
          columnNumber: columnIndex + 1,
          columnName: field.name,
          input,
          code: converted.code,
          message: converted.message,
        })
        continue
      }

      rows[rowIndex]![field.id] = converted.value
      cells.push({
        rowNumber: rowIndex + 1,
        columnNumber: columnIndex + 1,
        columnName: field.name,
        fieldId: field.id,
        value: converted.value,
      })
    }
  }

  return {
    rows,
    cells,
    errors,
    totalCellCount,
    convertedCellCount: cells.length,
    summary: pasteSummary(totalCellCount, cells.length, errors.length),
  }
}

export function parseAndConvertClipboard(
  input: string,
  fields: readonly FieldDefinition[],
): ClipboardPasteConversion {
  return convertClipboardRectangle(parseClipboardRectangle(input), fields)
}
