import type {
  FieldConfig,
  FieldDefinition,
  FieldType,
} from "@/lib/domain"
import { fieldConfigIssue } from "@/lib/field-config-validation"

export const CONVERTIBLE_FIELD_TYPES = [
  "singleLineText",
  "longText",
  "number",
  "currency",
  "percent",
  "rating",
  "checkbox",
  "date",
  "email",
  "phone",
  "url",
  "singleSelect",
  "multiSelect",
] as const satisfies readonly FieldType[]

export type ConvertibleFieldType =
  (typeof CONVERTIBLE_FIELD_TYPES)[number]

export type FieldConversionResult =
  | "Kept as-is"
  | "Will change"
  | "Will be cleared"

export interface FieldConversionPreview {
  columnName: string
  currentType: string
  newType: string
  expectedFieldRevision: number
  previewVersion: string
  canApply: boolean
  blockingReason: string | null
  requiresDataLossAcknowledgement: boolean
  counts: {
    reviewedRows: number
    filledCells: number
    keptAsIs: number
    changed: number
    cleared: number
    losingSomeInformation: number
  }
  examples: Array<{
    before: string
    after: string
    result: FieldConversionResult
    explanation: string
  }>
  dependencies: Array<{
    category:
      | "Draft form"
      | "Published form"
      | "Saved view"
      | "Saved analysis"
    name: string
  }>
  warnings: string[]
}

export interface FieldConversionJobProgress {
  jobId: string
  fieldId: string
  columnName: string
  targetType: ConvertibleFieldType
  targetConfig: FieldConfig
  status:
    | "staging"
    | "ready"
    | "applying"
    | "failed"
    | "cancelling"
    | "cancelled"
    | "completed"
  phase: "staging" | "applying"
  counts: FieldConversionPreview["counts"] & {
    appliedRows: number
    rowsUpdated: number
  }
  failureMessage: string | null
}

export function isConvertibleFieldType(
  type: FieldType,
): type is ConvertibleFieldType {
  return CONVERTIBLE_FIELD_TYPES.some((candidate) => candidate === type)
}

export function conversionConfigForTarget(
  source: Pick<FieldDefinition, "type" | "config">,
  targetType: ConvertibleFieldType,
): FieldConfig {
  if (targetType === "singleSelect" || targetType === "multiSelect") {
    return {
      options:
        source.type === "singleSelect" || source.type === "multiSelect"
          ? (source.config.options ?? []).map((option) => ({ ...option }))
          : [],
    }
  }
  if (targetType === "rating") {
    return { min: 1, max: 5, precision: 0 }
  }
  if (targetType === "currency") {
    return {
      currency: source.config.currency ?? "USD",
      precision: source.config.precision ?? 2,
    }
  }
  if (targetType === "percent") {
    return { min: 0, max: 1, precision: source.config.precision ?? 0 }
  }
  if (targetType === "number") {
    return { precision: source.config.precision ?? 0 }
  }
  if (targetType === "date") {
    return { dateStyle: source.config.dateStyle ?? "date" }
  }
  if (targetType === "longText") return { maxLength: 100_000 }
  if (targetType === "singleLineText") return { maxLength: 10_000 }
  if (targetType === "email") return { maxLength: 320 }
  if (targetType === "phone") return { maxLength: 64 }
  if (targetType === "url") return { maxLength: 2_048 }
  return {}
}

export function fieldConversionApplyDisabled(
  preview: FieldConversionPreview | undefined,
  acknowledged: boolean,
  applying: boolean,
): boolean {
  return (
    applying ||
    !preview ||
    !preview.canApply ||
    (preview.requiresDataLossAcknowledgement && !acknowledged)
  )
}

export function fieldConversionConfigIssue(
  targetType: ConvertibleFieldType,
  config: FieldConfig,
): string | null {
  const validationIssue = fieldConfigIssue(targetType, config)
  if (validationIssue) return validationIssue

  if (targetType === "singleSelect" || targetType === "multiSelect") {
    const options = config.options ?? []
    if (options.length === 0) {
      return "Add at least one named choice before reviewing this change."
    }
    if (options.some((option) => !option.label.trim())) {
      return "Give every choice a name before reviewing this change."
    }
    const normalizedNames = options.map((option) =>
      option.label.trim().toLocaleLowerCase(),
    )
    if (new Set(normalizedNames).size !== normalizedNames.length) {
      return "Use a different name for each choice."
    }
  }
  return null
}
