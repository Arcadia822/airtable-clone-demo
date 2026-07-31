import type {
  FieldDefinition,
  FormDefinition,
  FormQuestion,
} from "@/lib/domain"
import type { FormAnswerValue } from "@/lib/form-conditional-logic"

const PARAMETER_PATTERN = /^[a-z][a-z0-9_]{0,63}$/
const RESERVED_PARAMETERS = new Set([
  "embed",
  "form",
  "preview",
  "slug",
  "submission",
  "token",
  "turnstile",
  "version",
])

export function normalizeFormPrefillParameter(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64)
}

export function suggestedFormPrefillName(
  questionLabel: string,
  columnName: string,
): string {
  return (
    normalizeFormPrefillParameter(questionLabel) ||
    normalizeFormPrefillParameter(columnName) ||
    "answer"
  )
}

export function formPrefillParameterIssue(
  parameter: string,
  otherParameters: readonly string[] = [],
): string | null {
  if (!parameter) return "Enter a name to use in the share link."
  if (!PARAMETER_PATTERN.test(parameter)) {
    return "The share-link name must start with a letter and use only lowercase letters, numbers, and underscores."
  }
  if (RESERVED_PARAMETERS.has(parameter)) {
    return `“${parameter}” is reserved. Choose a more specific name.`
  }
  if (
    otherParameters.some(
      (other) => other.toLowerCase() === parameter.toLowerCase(),
    )
  ) {
    return "Each prefilled question needs a different share-link name."
  }
  return null
}

export function publicFormPrefillValues(
  form: FormDefinition,
  fields: readonly FieldDefinition[],
  search: URLSearchParams,
): ReadonlyMap<string, FormAnswerValue> {
  const fieldsById = new Map(fields.map((field) => [field.id, field]))
  const values = new Map<string, FormAnswerValue>()

  for (const question of form.questions) {
    if (
      question.mode === "hidden" ||
      !question.prefillParameter ||
      formPrefillParameterIssue(question.prefillParameter)
    ) {
      continue
    }
    const field = fieldsById.get(question.fieldId)
    if (!field) continue
    const rawValues = search.getAll(question.prefillParameter)
    const value = compatiblePrefillValue(field, rawValues)
    if (value !== undefined) values.set(question.id, value)
  }

  return values
}

export function hiddenFixedAnswerLookup(
  questions: readonly FormQuestion[],
): ReadonlyMap<string, FormAnswerValue> {
  return new Map(
    questions.flatMap((question) =>
      question.mode === "hidden" && question.fixedValue !== undefined
        ? [[question.id, question.fixedValue] as const]
        : [],
    ),
  )
}

function compatiblePrefillValue(
  field: FieldDefinition,
  rawValues: readonly string[],
): FormAnswerValue {
  if (!rawValues.length || field.type === "attachment") return undefined
  const raw = rawValues.at(-1)?.trim() ?? ""
  if (!raw || raw.length > 10_000) return undefined

  if (field.type === "singleSelect") {
    return matchingOptionId(field, raw)
  }
  if (field.type === "multiSelect") {
    const optionIds = rawValues
      .flatMap((value) => value.split(","))
      .map((value) => matchingOptionId(field, value.trim()))
      .filter((value): value is string => Boolean(value))
    return optionIds.length ? Array.from(new Set(optionIds)) : undefined
  }
  if (field.type === "checkbox") {
    const normalized = raw.toLowerCase()
    if (["true", "yes", "1"].includes(normalized)) return true
    if (["false", "no", "0"].includes(normalized)) return false
    return undefined
  }
  if (
    field.type === "number" ||
    field.type === "currency" ||
    field.type === "percent" ||
    field.type === "rating"
  ) {
    const value = Number(raw)
    if (!Number.isFinite(value)) return undefined
    const canonical = field.type === "percent" ? value / 100 : value
    if (
      (field.type === "rating" &&
        (!Number.isInteger(canonical) ||
          canonical < 1 ||
          canonical > 5)) ||
      (field.config.min !== undefined && canonical < field.config.min) ||
      (field.config.max !== undefined && canonical > field.config.max)
    ) {
      return undefined
    }
    return canonical
  }
  if (field.type === "date") {
    return isCalendarDate(raw) ? raw : undefined
  }
  if (field.type === "email") {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)
      ? raw
      : undefined
  }
  if (field.type === "url") {
    try {
      const url = new URL(raw)
      return url.protocol === "https:" || url.protocol === "http:"
        ? raw
        : undefined
    } catch {
      return undefined
    }
  }

  const maxLength = Math.min(
    field.config.maxLength ??
      (field.type === "longText" ? 100_000 : 10_000),
    field.type === "longText" ? 100_000 : 10_000,
  )
  return raw.length <= maxLength ? raw : undefined
}

function matchingOptionId(
  field: FieldDefinition,
  value: string,
): string | undefined {
  const normalized = value.toLocaleLowerCase()
  return field.config.options
    ?.find(
      (option) =>
        option.label.trim().toLocaleLowerCase() === normalized,
    )
    ?.id
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}
