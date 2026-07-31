import type {
  FieldConfig,
  FieldType,
  FormConditionOperator,
  FormConditionValue,
  FormQuestion,
  FormVisibilityCondition,
  FormVisibilityRule,
} from "@/lib/domain"

export type {
  FormConditionOperator,
  FormConditionValue,
  FormVisibilityCondition,
  FormVisibilityRule,
} from "@/lib/domain"

export type FormAnswerValue =
  | string
  | number
  | boolean
  | readonly unknown[]
  | null
  | undefined

export type FormAnswerLookup =
  | ReadonlyMap<string, FormAnswerValue>
  | Readonly<Record<string, FormAnswerValue>>

export interface ConditionalFormQuestion
  extends Pick<
    FormQuestion,
    "id" | "fieldId" | "label" | "helpText" | "placeholder" | "required" | "rank"
  > {
  visibility?: FormVisibilityRule
}

export interface FormConditionDescriptionOptions {
  valueLabel?: (
    condition: FormVisibilityCondition,
  ) => string | undefined
}

export const FORM_CONDITION_OPERATOR_LABELS: Readonly<
  Record<FormConditionOperator, string>
> = {
  is: "is",
  is_not: "is not",
  contains: "contains",
  does_not_contain: "doesn’t contain",
  is_empty: "is empty",
  is_not_empty: "is not empty",
  is_checked: "is checked",
  is_not_checked: "is not checked",
  greater_than: "is greater than",
  greater_than_or_equal: "is at least",
  less_than: "is less than",
  less_than_or_equal: "is at most",
  before: "is before",
  on_or_before: "is on or before",
  after: "is after",
  on_or_after: "is on or after",
}

export function formConditionOperatorsForField(
  type: FieldType | undefined,
): FormConditionOperator[] {
  if (type === "checkbox") {
    return ["is_checked", "is_not_checked"]
  }
  if (type === "attachment") {
    return ["is_not_empty", "is_empty"]
  }
  if (
    type === "number" ||
    type === "currency" ||
    type === "percent" ||
    type === "rating"
  ) {
    return [
      "greater_than",
      "greater_than_or_equal",
      "less_than",
      "less_than_or_equal",
      "is",
      "is_not",
      "is_empty",
      "is_not_empty",
    ]
  }
  if (type === "date") {
    return [
      "after",
      "on_or_after",
      "before",
      "on_or_before",
      "is",
      "is_not",
      "is_empty",
      "is_not_empty",
    ]
  }
  if (type === "singleSelect") {
    return ["is", "is_not", "is_empty", "is_not_empty"]
  }
  if (type === "multiSelect") {
    return [
      "contains",
      "does_not_contain",
      "is_empty",
      "is_not_empty",
    ]
  }
  return [
    "is",
    "is_not",
    "contains",
    "does_not_contain",
    "is_empty",
    "is_not_empty",
  ]
}

export function defaultFormConditionForField(
  field:
    | {
        type: FieldType
        config: FieldConfig
      }
    | undefined,
): Pick<FormVisibilityCondition, "operator" | "value"> {
  const operator = formConditionOperatorsForField(field?.type)[0]!
  if (!operatorUsesValue(operator)) return { operator }
  if (
    field?.type === "singleSelect" ||
    field?.type === "multiSelect"
  ) {
    return {
      operator,
      value: field.config.options?.[0]?.id ?? "",
    }
  }
  if (
    field?.type === "number" ||
    field?.type === "currency" ||
    field?.type === "percent" ||
    field?.type === "rating"
  ) {
    return { operator, value: 0 }
  }
  if (field?.type === "date") {
    return {
      operator,
      value: new Date().toISOString().slice(0, 10),
    }
  }
  return { operator, value: "" }
}

/**
 * Evaluates one condition against the current answer snapshot.
 *
 * Pass `questions` when available so stale question references or a changed
 * source-column mapping fail closed instead of revealing a dependent question.
 */
export function matchesFormCondition(
  condition: FormVisibilityCondition,
  answers: FormAnswerLookup,
  questions?: readonly Pick<
    ConditionalFormQuestion,
    "id" | "fieldId"
  >[],
): boolean {
  if (!hasValidSource(condition, questions)) return false
  return matchesAnswer(
    answerFor(answers, condition.sourceQuestionId),
    condition,
  )
}

/**
 * A rule with no conditions means the question is always visible. Invalid or
 * missing source references never throw and never satisfy a condition.
 */
export function evaluateFormVisibility(
  rule: FormVisibilityRule | undefined,
  answers: FormAnswerLookup,
  questions?: readonly Pick<
    ConditionalFormQuestion,
    "id" | "fieldId"
  >[],
): boolean {
  if (!rule || rule.conditions.length === 0) return true
  const matches = rule.conditions.map((condition) =>
    matchesFormCondition(condition, answers, questions),
  )
  return rule.conjunction === "and"
    ? matches.every(Boolean)
    : matches.some(Boolean)
}

/**
 * Evaluates a question within the full dependency graph. Hidden source
 * questions cannot unlock downstream questions with stale answers, and cycles
 * fail closed.
 */
export function isFormQuestionVisible(
  questionId: string,
  questions: readonly ConditionalFormQuestion[],
  answers: FormAnswerLookup,
): boolean {
  return createQuestionVisibilityEvaluator(questions, answers)(questionId)
}

export function visibleFormQuestions<T extends ConditionalFormQuestion>(
  questions: readonly T[],
  answers: FormAnswerLookup,
): T[] {
  const isVisible = createQuestionVisibilityEvaluator(questions, answers)
  return questions.filter((question) => isVisible(question.id))
}

/**
 * Produces editor/preview copy without exposing internal identifiers. A caller
 * can resolve choice IDs through `valueLabel`; unresolved opaque values are
 * described generically as a selected choice.
 */
export function describeFormCondition(
  condition: FormVisibilityCondition,
  questions: readonly Pick<
    ConditionalFormQuestion,
    "id" | "label"
  >[],
  options: FormConditionDescriptionOptions = {},
): string {
  const question = questions.find(
    (candidate) => candidate.id === condition.sourceQuestionId,
  )
  const questionLabel = question
    ? friendlyQuestionLabel(question.label)
    : "Unavailable question"
  const operatorLabel = FORM_CONDITION_OPERATOR_LABELS[condition.operator]
  if (!operatorUsesValue(condition.operator)) {
    return `${questionLabel} ${operatorLabel}`
  }
  const resolvedLabel = options.valueLabel?.(condition)
  const valueLabel = friendlyConditionValue(
    resolvedLabel ?? condition.value,
    condition.operator,
  )
  return `${questionLabel} ${operatorLabel} ${valueLabel}`
}

export function describeFormVisibility(
  rule: FormVisibilityRule | undefined,
  questions: readonly Pick<
    ConditionalFormQuestion,
    "id" | "label"
  >[],
  options: FormConditionDescriptionOptions = {},
): string {
  if (!rule || rule.conditions.length === 0) return "Always shown"
  const descriptions = rule.conditions.map((condition) =>
    describeFormCondition(condition, questions, options),
  )
  if (descriptions.length === 1) return `Show when ${descriptions[0]}`
  return `Show when ${
    rule.conjunction === "and"
      ? "all conditions match"
      : "any condition matches"
  }: ${descriptions.join("; ")}`
}

function createQuestionVisibilityEvaluator(
  questions: readonly ConditionalFormQuestion[],
  answers: FormAnswerLookup,
) {
  const questionsById = new Map(
    questions.map((question) => [question.id, question]),
  )
  const memo = new Map<string, boolean>()
  const visiting = new Set<string>()

  function evaluate(questionId: string): boolean {
    const cached = memo.get(questionId)
    if (cached !== undefined) return cached
    const question = questionsById.get(questionId)
    if (!question) return false
    if (visiting.has(questionId)) return false
    const rule = question.visibility
    if (!rule || rule.conditions.length === 0) {
      memo.set(questionId, true)
      return true
    }

    visiting.add(questionId)
    const matches = rule.conditions.map((condition) => {
      const sourceQuestion = questionsById.get(
        condition.sourceQuestionId,
      )
      if (
        !sourceQuestion ||
        (condition.sourceFieldId !== undefined &&
          sourceQuestion.fieldId !== condition.sourceFieldId) ||
        !evaluate(sourceQuestion.id)
      ) {
        return false
      }
      return matchesAnswer(
        answerFor(answers, condition.sourceQuestionId),
        condition,
      )
    })
    visiting.delete(questionId)

    const visible =
      rule.conjunction === "and"
        ? matches.every(Boolean)
        : matches.some(Boolean)
    memo.set(questionId, visible)
    return visible
  }

  return evaluate
}

function hasValidSource(
  condition: FormVisibilityCondition,
  questions:
    | readonly Pick<ConditionalFormQuestion, "id" | "fieldId">[]
    | undefined,
): boolean {
  if (!questions) return true
  const question = questions.find(
    (candidate) => candidate.id === condition.sourceQuestionId,
  )
  if (!question) return false
  return (
    condition.sourceFieldId === undefined ||
    question.fieldId === condition.sourceFieldId
  )
}

function matchesAnswer(
  actual: FormAnswerValue,
  condition: FormVisibilityCondition,
): boolean {
  const operator = condition.operator
  if (operator === "is_empty") return isBlank(actual)
  if (operator === "is_not_empty") return !isBlank(actual)
  if (operator === "is_checked") return booleanValue(actual) === true
  if (operator === "is_not_checked") {
    const checked = booleanValue(actual)
    return isBlank(actual) || checked === false
  }

  // Negative comparisons should not reveal dependent questions before the
  // respondent has answered their source question.
  if (isBlank(actual)) return false

  if (operator === "is") {
    return valuesAreEqual(actual, condition.value)
  }
  if (operator === "is_not") {
    return !valuesAreEqual(actual, condition.value)
  }
  if (
    operator === "contains" ||
    operator === "does_not_contain"
  ) {
    const contains = valueContains(actual, condition.value)
    return operator === "contains" ? contains : !contains
  }

  if (
    operator === "greater_than" ||
    operator === "greater_than_or_equal" ||
    operator === "less_than" ||
    operator === "less_than_or_equal"
  ) {
    const actualNumber = finiteNumber(actual)
    const expectedNumber = finiteNumber(condition.value)
    if (actualNumber === undefined || expectedNumber === undefined) {
      return false
    }
    if (operator === "greater_than") return actualNumber > expectedNumber
    if (operator === "greater_than_or_equal") {
      return actualNumber >= expectedNumber
    }
    if (operator === "less_than") return actualNumber < expectedNumber
    return actualNumber <= expectedNumber
  }

  const comparison = compareDates(actual, condition.value)
  if (comparison === undefined) return false
  if (operator === "before") return comparison < 0
  if (operator === "on_or_before") return comparison <= 0
  if (operator === "after") return comparison > 0
  return comparison >= 0
}

function answerFor(
  answers: FormAnswerLookup,
  questionId: string,
): FormAnswerValue {
  try {
    if ("get" in answers && typeof answers.get === "function") {
      return answers.get(questionId)
    }
    const answerRecord = answers as Readonly<
      Record<string, FormAnswerValue>
    >
    return Object.prototype.hasOwnProperty.call(answerRecord, questionId)
      ? answerRecord[questionId]
      : undefined
  } catch {
    return undefined
  }
}

function isBlank(value: FormAnswerValue): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === "string") return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

function normalizedText(value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string"
  ) {
    return value.name.trim().toLocaleLowerCase()
  }
  return String(value ?? "").trim().toLocaleLowerCase()
}

function valueTokens(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(normalizedText)
  return [normalizedText(value)]
}

function valuesAreEqual(
  actual: FormAnswerValue,
  expected: FormConditionValue | undefined,
): boolean {
  const actualBoolean = booleanValue(actual)
  const expectedBoolean = booleanValue(expected)
  if (
    actualBoolean !== undefined &&
    expectedBoolean !== undefined &&
    (typeof actual === "boolean" || typeof expected === "boolean")
  ) {
    return actualBoolean === expectedBoolean
  }

  const actualNumber = finiteNumber(actual)
  const expectedNumber = finiteNumber(expected)
  if (
    actualNumber !== undefined &&
    expectedNumber !== undefined &&
    (typeof actual === "number" || typeof expected === "number")
  ) {
    return actualNumber === expectedNumber
  }

  if (isDateOnlyValue(expected)) {
    const actualDate = dateOnlyKey(actual)
    return actualDate !== undefined && actualDate === dateOnlyKey(expected)
  }

  const actualTokens = valueTokens(actual)
  const expectedTokens = valueTokens(expected)
  if (Array.isArray(actual) && !Array.isArray(expected)) {
    return actualTokens.includes(expectedTokens[0] ?? "")
  }
  if (!Array.isArray(actual) && Array.isArray(expected)) {
    return expectedTokens.includes(actualTokens[0] ?? "")
  }
  if (Array.isArray(actual) || Array.isArray(expected)) {
    const left = [...new Set(actualTokens)].sort()
    const right = [...new Set(expectedTokens)].sort()
    return (
      left.length === right.length &&
      left.every((token, index) => token === right[index])
    )
  }
  return actualTokens[0] === expectedTokens[0]
}

function valueContains(
  actual: FormAnswerValue,
  expected: FormConditionValue | undefined,
): boolean {
  const expectedTokens = valueTokens(expected).filter(Boolean)
  if (!expectedTokens.length) return false
  const actualTokens = valueTokens(actual)
  if (Array.isArray(actual)) {
    return expectedTokens.every((expectedToken) =>
      actualTokens.includes(expectedToken),
    )
  }
  return expectedTokens.every((expectedToken) =>
    (actualTokens[0] ?? "").includes(expectedToken),
  )
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined
  }
  if (typeof value !== "string" || !value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value
  const normalized = normalizedText(value)
  if (["true", "checked", "yes", "1"].includes(normalized)) return true
  if (["false", "unchecked", "no", "0"].includes(normalized)) return false
  return undefined
}

function isDateOnlyValue(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
  )
}

function dateOnlyKey(value: unknown): string | undefined {
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value.trim())
  ) {
    return value.trim().slice(0, 10)
  }
  const parsed = timestamp(value)
  if (parsed === undefined) return undefined
  return new Date(parsed).toISOString().slice(0, 10)
}

function timestamp(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) &&
      !Number.isNaN(new Date(value).getTime())
      ? value
      : undefined
  }
  if (typeof value !== "string" || !value.trim()) return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

function compareDates(
  actual: FormAnswerValue,
  expected: FormConditionValue | undefined,
): number | undefined {
  if (isDateOnlyValue(expected)) {
    const actualDate = dateOnlyKey(actual)
    const expectedDate = dateOnlyKey(expected)
    if (!actualDate || !expectedDate) return undefined
    return actualDate.localeCompare(expectedDate)
  }
  const actualTime = timestamp(actual)
  const expectedTime = timestamp(expected)
  if (actualTime === undefined || expectedTime === undefined) {
    return undefined
  }
  return actualTime - expectedTime
}

function operatorUsesValue(operator: FormConditionOperator): boolean {
  return ![
    "is_empty",
    "is_not_empty",
    "is_checked",
    "is_not_checked",
  ].includes(operator)
}

function friendlyQuestionLabel(label: string): string {
  const trimmed = label.trim()
  return trimmed && !looksLikeOpaqueIdentifier(trimmed)
    ? `“${trimmed}”`
    : "Question"
}

function friendlyConditionValue(
  value: FormConditionValue | string | undefined,
  operator: FormConditionOperator,
): string {
  if (isReadonlyStringArray(value)) {
    if (!value.length) return "no choices"
    if (value.some(looksLikeOpaqueIdentifier)) {
      return `${value.length} selected ${
        value.length === 1 ? "choice" : "choices"
      }`
    }
    return value.map((item) => `“${item}”`).join(", ")
  }
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "number") {
    return new Intl.NumberFormat("en", {
      maximumFractionDigits: 12,
    }).format(value)
  }
  if (value === undefined || value === null || !value.trim()) {
    return "a value"
  }
  if (looksLikeOpaqueIdentifier(value)) return "the selected choice"
  if (
    ["before", "on_or_before", "after", "on_or_after"].includes(
      operator,
    ) &&
    isDateOnlyValue(value)
  ) {
    return new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(`${value}T00:00:00.000Z`))
  }
  return `“${value.trim()}”`
}

function isReadonlyStringArray(
  value: FormConditionValue | string | undefined,
): value is string[] {
  return Array.isArray(value)
}

function looksLikeOpaqueIdentifier(value: string): boolean {
  const normalized = value.trim()
  return (
    /^(?:question|field|form|option|choice|fld|qst)_[a-z0-9_-]+$/i.test(
      normalized,
    ) ||
    (!normalized.includes(" ") &&
      normalized.length >= 24 &&
      /^[a-z0-9_-]+$/i.test(normalized))
  )
}
