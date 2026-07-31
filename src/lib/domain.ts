export const FIELD_TYPES = [
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
  "attachment",
  "createdTime",
  "createdBy",
] as const

export type FieldType = (typeof FIELD_TYPES)[number]

export interface SelectOption {
  id: string
  label: string
  color: string
}

export interface FieldConfig {
  maxLength?: number
  min?: number
  max?: number
  precision?: number
  currency?: string
  dateStyle?: "date" | "dateTime"
  includeTime?: boolean
  attachmentKind?: "image" | "file" | "any"
  options?: SelectOption[]
  archivedOptions?: SelectOption[]
}

export interface FieldDefinition {
  id: string
  name: string
  type: FieldType
  config: FieldConfig
  rank: string
  width: number
  isPrimary: boolean
  frozen?: boolean
  isArchived?: boolean
}

export interface AttachmentValue {
  id: string
  name: string
  mimeType: string
  size: number
  url?: string
}

export type CellValue =
  | string
  | number
  | boolean
  | string[]
  | AttachmentValue[]
  | null

export interface GridRecord {
  id: string
  rank: string
  values: Record<string, CellValue>
  revision: number
  createdAt: number
  createdBy: string
  updatedAt: number
  updatedBy: string
}

export interface BaseSummary {
  id: string
  name: string
  color: string
  tableCount: number
  recordCount: number
  updatedAt: number
}

export interface TableSummary {
  id: string
  baseId: string
  name: string
  color: string
  rank: string
}

export interface FormTheme {
  accent: string
  background: string
  layout: "card" | "plain"
  logoUrl?: string
  coverUrl?: string
  hideBranding: boolean
}

export type FormConditionOperator =
  | "is"
  | "is_not"
  | "contains"
  | "does_not_contain"
  | "is_empty"
  | "is_not_empty"
  | "is_checked"
  | "is_not_checked"
  | "greater_than"
  | "greater_than_or_equal"
  | "less_than"
  | "less_than_or_equal"
  | "before"
  | "on_or_before"
  | "after"
  | "on_or_after"

export type FormConditionValue =
  | string
  | number
  | boolean
  | string[]
  | null

export interface FormVisibilityCondition {
  id: string
  sourceQuestionId: string
  sourceFieldId?: string
  operator: FormConditionOperator
  value?: FormConditionValue
}

export interface FormVisibilityRule {
  conjunction: "and" | "or"
  conditions: readonly FormVisibilityCondition[]
}

export interface FormQuestion {
  id: string
  fieldId: string
  label: string
  helpText: string
  placeholder?: string
  required: boolean
  rank: string
  mode?: "visible" | "hidden"
  fixedValue?: FormConditionValue
  prefillParameter?: string
  visibility?: FormVisibilityRule
}

export interface FormDefinition {
  id: string
  baseId: string
  tableId: string
  name: string
  title: string
  description: string
  submitLabel: string
  thankYouTitle: string
  thankYouMessage: string
  redirectUrl?: string
  publicSlug: string
  status: "draft" | "published" | "closed"
  theme: FormTheme
  questions: FormQuestion[]
  version: number
}

export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "QUOTA_EXCEEDED"
  | "FORM_UPDATED"
  | "FORM_CLOSED"
  | "RATE_LIMITED"
  | "REVISION_CONFLICT"
  | "VALIDATION_ERROR"
  | "BILLING_UNAVAILABLE"

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = "AppError"
  }
}
