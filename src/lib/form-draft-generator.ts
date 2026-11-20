import { generateKeyBetween } from "jittered-fractional-indexing"

import {
  FIELD_TYPES,
  type FieldDefinition,
  type FieldType,
  type FormVisibilityRule,
} from "@/lib/domain"

/**
 * Columns whose values are owned by the table engine. A form can never write
 * to them, so they are never offered as questions.
 */
const READ_ONLY_FORM_FIELD_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  "createdTime",
  "createdBy",
  "autoNumber",
])

export const ELIGIBLE_FORM_FIELD_TYPES: readonly FieldType[] = FIELD_TYPES.filter(
  (type) => !READ_ONLY_FORM_FIELD_TYPES.has(type),
)

const ELIGIBLE_FORM_FIELD_TYPE_SET: ReadonlySet<FieldType> = new Set(
  ELIGIBLE_FORM_FIELD_TYPES,
)

export function isEligibleFormFieldType(type: FieldType): boolean {
  return ELIGIBLE_FORM_FIELD_TYPE_SET.has(type)
}

export type DraftQuestionMode = "input" | "hidden"

export interface GeneratedDraftQuestion {
  targetFieldId: string
  targetFieldType: FieldType
  label: string
  helpText: string
  placeholder: string
  required: boolean
  mode: DraftQuestionMode
  rank: string
  visibilityRule: FormVisibilityRule | null
}

/**
 * Builds `count` fractional ranks, optionally continuing after `afterRank`.
 */
export function draftRanks(
  count: number,
  afterRank: string | null = null,
): string[] {
  const ranks: string[] = []
  let cursor: string | null = afterRank
  for (let index = 0; index < count; index += 1) {
    cursor = generateKeyBetween(cursor, null)
    ranks.push(cursor)
  }
  return ranks
}

function orderedFields(
  fields: readonly FieldDefinition[],
): FieldDefinition[] {
  return [...fields].sort((left, right) => {
    if (left.rank < right.rank) return -1
    if (left.rank > right.rank) return 1
    return 0
  })
}

/**
 * Turns table columns into ordered draft questions.
 *
 * The generated order always follows the table's own column order (by rank),
 * even when `selectedFieldIds` arrives in a different order. Read-only columns
 * are skipped entirely.
 */
export function draftQuestionsFromFields(
  fields: readonly FieldDefinition[],
  selectedFieldIds?: readonly string[],
): GeneratedDraftQuestion[] {
  const selected = selectedFieldIds ? new Set(selectedFieldIds) : null
  const seen = new Set<string>()
  const eligible: FieldDefinition[] = []

  for (const field of orderedFields(fields)) {
    if (!isEligibleFormFieldType(field.type)) continue
    if (selected && !selected.has(field.id)) continue
    if (seen.has(field.id)) continue
    seen.add(field.id)
    eligible.push(field)
  }

  const ranks = draftRanks(eligible.length)
  return eligible.map((field, index) => ({
    targetFieldId: field.id,
    targetFieldType: field.type,
    label: field.name,
    helpText: "",
    placeholder: "",
    required: field.isPrimary,
    mode: "input",
    rank: ranks[index],
    visibilityRule: null,
  }))
}
