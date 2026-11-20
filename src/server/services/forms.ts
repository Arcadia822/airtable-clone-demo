import { createHash } from "node:crypto"

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { generateKeyBetween } from "jittered-fractional-indexing"
import { customAlphabet, nanoid } from "nanoid"

import {
  bases,
  fields,
  fieldSequences,
  formDraftFields,
  formMetricBuckets,
  formSubmissions,
  formVersionFields,
  formVersions,
  forms,
  records,
  tables,
} from "../../../drizzle/schema"
import type { AppDb } from "@/db/client"
import { isReadOnlyFieldType, validateRecordValues } from "@/lib/cell-validation"
import {
  AppError,
  type FieldConfig,
  type FieldDefinition,
  type FieldType,
  type FormConditionOperator,
  type FormConditionValue,
  type FormDefinition,
  type FormQuestion,
  type FormTheme,
  type FormVisibilityCondition,
  type FormVisibilityRule,
} from "@/lib/domain"
import {
  analyticsDay,
  analyticsRange,
} from "@/lib/form-analytics"
import {
  FORM_CONDITION_OPERATOR_LABELS,
  visibleFormQuestions,
  type FormAnswerValue,
} from "@/lib/form-conditional-logic"
import {
  draftQuestionsFromFields,
  draftRanks,
  isEligibleFormFieldType,
} from "@/lib/form-draft-generator"
import {
  createFormSubmissionsCsv,
  formSubmissionsCsvFileName,
} from "@/lib/form-submissions"
import { HttpStatusError } from "@/server/http"
import { buildRecordSearchText } from "@/server/search-text"

/* -------------------------------------------------------------------------- */
/* Constants and public DTOs                                                   */
/* -------------------------------------------------------------------------- */

export const FORM_STATUSES = ["draft", "published", "closed"] as const
export type FormStatus = (typeof FORM_STATUSES)[number]

const PUBLIC_FORM_METRICS = new Set(["view", "start", "submission"])
const DRAFT_METRICS = new Set(["view", "start"])

const DEFAULT_THEME: FormTheme = {
  accent: "#2563eb",
  background: "#f8fafc",
  layout: "card",
  hideBranding: false,
}

const DEFAULT_THANK_YOU = {
  title: "Thank you for your submission",
  message: "Your response has been received.",
}

const DEFAULT_SETTINGS = {
  allowMultipleSubmissions: true,
  submitLabel: "Submit",
  showPoweredBy: true,
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const PUBLIC_ACTOR = "public-form"

export interface FormSettings {
  allowMultipleSubmissions: boolean
  submitLabel: string
  showPoweredBy: boolean
}

export interface FormThankYou {
  title: string
  message: string
  redirectUrl?: string
}

export interface FormRecordDto {
  id: string
  orgId: string
  baseId: string
  tableId: string
  name: string
  description: string
  slug: string
  status: FormStatus
  settings: FormSettings
  theme: FormTheme
  thankYou: FormThankYou
  analyticsTimeZone: string
  publishedVersionId: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface FormFieldOption {
  id: string
  name: string
  type: FieldType
  config: FieldConfig
  rank: string
  isPrimary: boolean
  eligible: boolean
}

export interface FormDraftFieldDto {
  id: string
  formId: string
  targetFieldId: string
  label: string
  helpText: string
  placeholder: string
  required: boolean
  hidden: boolean
  rank: string
  mode: string
  visibilityRule: FormVisibilityRule | null
}

export interface PublishedVersionSummary {
  id: string
  versionNumber: number
  title: string
  description: string
  publishedAt: string
}

export interface FormDetailDto {
  form: FormRecordDto
  base: { id: string; name: string } | null
  table: { id: string; name: string } | null
  draftFields: FormDraftFieldDto[]
  tableFields: FormFieldOption[]
  publishedVersion: PublishedVersionSummary | null
  submissionCount: number
}

export interface FormSummaryDto extends FormRecordDto {
  baseName: string | null
  tableName: string | null
  submissionCount: number
  publishedVersionNumber: number | null
}
export interface FormTableCatalogEntry {
  id: string
  name: string
  baseId: string
  fields: FormFieldOption[]
}

export interface BaseFormsCatalog {
  base: { id: string; name: string }
  tables: FormTableCatalogEntry[]
}

export interface FormSubmissionColumn {
  fieldId: string
  label: string
  type: FieldType
  config: FieldConfig
}

export interface FormSubmissionDto {
  id: string
  submittedAt: string
  recordId: string | null
  versionNumber: number | null
  answers: Record<string, unknown>
  record: {
    id: string
    values: Record<string, unknown>
    revision: number
  } | null
  displayValues: Record<string, string>
}

export interface FormSubmissionsDto {
  form: { id: string; name: string; slug: string }
  columns: FormSubmissionColumn[]
  submissions: FormSubmissionDto[]
  total: number
}

export interface FormAnalyticsPoint {
  day: string
  views: number
  starts: number
  submissions: number
}

export interface FormAnalyticsDto {
  form: { id: string; name: string; slug: string }
  fromDay: string
  toDay: string
  totals: {
    views: number
    starts: number
    submissions: number
  }
  completionRate: number
  series: FormAnalyticsPoint[]
}

export interface PublicFormDto {
  slug: string
  formId: string
  versionId: string
  version: number
  title: string
  description: string
  publishedAt: string
  theme: FormTheme
  thankYou: FormThankYou
  settings: FormSettings
  questions: FormQuestion[]
  form: FormDefinition
  fields: FieldDefinition[]
}

export interface PublicSubmissionResult {
  submissionId: string
  recordId: string
  thankYou: FormThankYou
}

/* -------------------------------------------------------------------------- */
/* Input normalization                                                         */
/* -------------------------------------------------------------------------- */

function inputObject(value: unknown, label = "request"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError("VALIDATION_ERROR", `Invalid ${label} payload.`)
  }
  return value as Record<string, unknown>
}

function requiredText(
  value: unknown,
  field: string,
  maxLength = 200,
): string {
  if (typeof value !== "string") {
    throw new AppError("VALIDATION_ERROR", `${field} is required.`)
  }
  const trimmed = value.trim()
  if (!trimmed) {
    throw new AppError("VALIDATION_ERROR", `${field} is required.`)
  }
  if (trimmed.length > maxLength) {
    throw new AppError(
      "VALIDATION_ERROR",
      `${field} must be ${maxLength} characters or fewer.`,
    )
  }
  return trimmed
}

function optionalText(
  value: unknown,
  field: string,
  maxLength = 20_000,
): string | undefined {
  if (value === undefined) return undefined
  if (value === null) return ""
  if (typeof value !== "string") {
    throw new AppError("VALIDATION_ERROR", `${field} must be text.`)
  }
  if (value.length > maxLength) {
    throw new AppError(
      "VALIDATION_ERROR",
      `${field} must be ${maxLength} characters or fewer.`,
    )
  }
  return value
}

function optionalBoolean(
  value: unknown,
  field: string,
): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "boolean") {
    throw new AppError("VALIDATION_ERROR", `${field} must be true or false.`)
  }
  return value
}

function stringList(value: unknown, field: string): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new AppError("VALIDATION_ERROR", `${field} must be a list of IDs.`)
  }
  return Array.from(new Set(value as string[]))
}

function formStatus(value: unknown): FormStatus {
  if (typeof value !== "string" || !FORM_STATUSES.includes(value as FormStatus)) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Status must be one of ${FORM_STATUSES.join(", ")}.`,
    )
  }
  return value as FormStatus
}

/* -------------------------------------------------------------------------- */
/* Presentation normalization                                                  */
/* -------------------------------------------------------------------------- */

function colorValue(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX_COLOR.test(value.trim())
    ? value.trim()
    : fallback
}

function optionalUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed
}

function safeRedirectUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed
  try {
    const url = new URL(trimmed)
    if (url.protocol === "http:" || url.protocol === "https:") return trimmed
  } catch {
    return undefined
  }
  return undefined
}

export function normalizeFormTheme(value: unknown): FormTheme {
  const raw =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {}
  const theme: FormTheme = {
    accent: colorValue(raw.accent ?? raw.accentColor, DEFAULT_THEME.accent),
    background: colorValue(
      raw.background ?? raw.backgroundColor,
      DEFAULT_THEME.background,
    ),
    layout: raw.layout === "plain" ? "plain" : "card",
    hideBranding:
      raw.hideBranding === true || raw.showPoweredBy === false,
  }
  const logoUrl = optionalUrl(raw.logoUrl)
  const coverUrl = optionalUrl(raw.coverUrl)
  if (logoUrl) theme.logoUrl = logoUrl
  if (coverUrl) theme.coverUrl = coverUrl
  return theme
}

export function normalizeFormThankYou(value: unknown): FormThankYou {
  const raw =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {}
  const thankYou: FormThankYou = {
    title:
      typeof raw.title === "string" && raw.title.trim()
        ? raw.title.trim()
        : DEFAULT_THANK_YOU.title,
    message:
      typeof raw.message === "string" && raw.message.trim()
        ? raw.message
        : DEFAULT_THANK_YOU.message,
  }
  const redirectUrl = safeRedirectUrl(raw.redirectUrl)
  if (redirectUrl) thankYou.redirectUrl = redirectUrl
  return thankYou
}

export function normalizeFormSettings(value: unknown): FormSettings {
  const raw =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {}
  return {
    allowMultipleSubmissions:
      typeof raw.allowMultipleSubmissions === "boolean"
        ? raw.allowMultipleSubmissions
        : DEFAULT_SETTINGS.allowMultipleSubmissions,
    submitLabel:
      typeof raw.submitLabel === "string" && raw.submitLabel.trim()
        ? raw.submitLabel.trim().slice(0, 60)
        : DEFAULT_SETTINGS.submitLabel,
    showPoweredBy:
      typeof raw.showPoweredBy === "boolean"
        ? raw.showPoweredBy
        : DEFAULT_SETTINGS.showPoweredBy,
  }
}

function timeZone(value: unknown, fallback = "UTC"): string {
  if (typeof value !== "string" || !value.trim()) return fallback
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value.trim() }).format()
    return value.trim()
  } catch {
    return fallback
  }
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function toFieldDefinition(row: typeof fields.$inferSelect): FieldDefinition {
  return {
    id: row.id,
    name: row.name,
    type: row.type as FieldType,
    config: (row.config ?? {}) as FieldConfig,
    rank: row.rank,
    width: row.width,
    isPrimary: row.isPrimary,
    frozen: row.frozen,
  }
}

function toFieldOption(row: typeof fields.$inferSelect): FormFieldOption {
  const type = row.type as FieldType
  return {
    id: row.id,
    name: row.name,
    type,
    config: (row.config ?? {}) as FieldConfig,
    rank: row.rank,
    isPrimary: row.isPrimary,
    eligible: isEligibleFormFieldType(type),
  }
}

function toFormDto(row: typeof forms.$inferSelect): FormRecordDto {
  return {
    id: row.id,
    orgId: row.orgId,
    baseId: row.baseId,
    tableId: row.tableId,
    name: row.name,
    description: row.description,
    slug: row.slug,
    status: row.status as FormStatus,
    settings: normalizeFormSettings(row.settings),
    theme: normalizeFormTheme(row.theme),
    thankYou: normalizeFormThankYou(row.thankYou),
    analyticsTimeZone: timeZone(row.analyticsTimeZone),
    publishedVersionId: row.publishedVersionId ?? null,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  }
}

function toDraftDto(row: typeof formDraftFields.$inferSelect): FormDraftFieldDto {
  return {
    id: row.id,
    formId: row.formId,
    targetFieldId: row.targetFieldId,
    label: row.label,
    helpText: row.helpText,
    placeholder: row.placeholder,
    required: row.required,
    hidden: row.hidden,
    rank: row.rank,
    mode: row.mode,
    visibilityRule: (row.visibilityRule ?? null) as FormVisibilityRule | null,
  }
}

const VALID_CONDITION_OPERATORS: ReadonlySet<string> = new Set(
  Object.keys(FORM_CONDITION_OPERATOR_LABELS),
)

function conditionValue(value: unknown): FormConditionValue | undefined {
  if (value === null || value === undefined) return null
  if (typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value as string[]
  }
  return undefined
}

/**
 * Validates and normalizes a stored/edited conditional visibility rule.
 * Invalid sources are dropped so a published form can never reference a
 * question that no longer exists.
 */
function visibilityRule(
  value: unknown,
  selfId: string,
  allowedSourceIds: ReadonlySet<string>,
  options: { strict?: boolean } = {},
): FormVisibilityRule | null {
  if (value === null || value === undefined) return null
  if (typeof value !== "object" || Array.isArray(value)) {
    if (options.strict) {
      throw new AppError("VALIDATION_ERROR", "Visibility rules must be an object.")
    }
    return null
  }
  const raw = value as Record<string, unknown>
  if (raw.conjunction !== "and" && raw.conjunction !== "or") {
    if (options.strict) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Visibility conjunction must be “and” or “or”.",
      )
    }
    return null
  }
  if (!Array.isArray(raw.conditions)) {
    if (options.strict) {
      throw new AppError("VALIDATION_ERROR", "Visibility conditions must be a list.")
    }
    return null
  }

  const conditions: FormVisibilityCondition[] = []
  raw.conditions.forEach((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      if (options.strict) {
        throw new AppError("VALIDATION_ERROR", "Each visibility condition must be an object.")
      }
      return
    }
    const condition = item as Record<string, unknown>
    const sourceQuestionId =
      typeof condition.sourceQuestionId === "string"
        ? condition.sourceQuestionId
        : undefined
    const operator =
      typeof condition.operator === "string" &&
      VALID_CONDITION_OPERATORS.has(condition.operator)
        ? (condition.operator as FormConditionOperator)
        : undefined
    if (!sourceQuestionId || !operator) {
      if (options.strict) {
        throw new AppError(
          "VALIDATION_ERROR",
          "Each visibility condition needs a source question and operator.",
        )
      }
      return
    }
    if (sourceQuestionId === selfId || !allowedSourceIds.has(sourceQuestionId)) {
      if (options.strict) {
        throw new AppError(
          "VALIDATION_ERROR",
          "A question can only depend on an earlier question in this form.",
        )
      }
      return
    }
    const normalized: FormVisibilityCondition = {
      id:
        typeof condition.id === "string" && condition.id
          ? condition.id
          : `${selfId}-condition-${index}`,
      sourceQuestionId,
      operator,
    }
    if (typeof condition.sourceFieldId === "string") {
      normalized.sourceFieldId = condition.sourceFieldId
    }
    const value = conditionValue(condition.value)
    if (value !== undefined) normalized.value = value
    conditions.push(normalized)
  })

  if (!conditions.length) return null
  return { conjunction: raw.conjunction, conditions }
}

/* -------------------------------------------------------------------------- */
/* Shared lookups                                                              */
/* -------------------------------------------------------------------------- */

async function requireBase(
  db: AppDb,
  orgId: string,
  baseId: string,
): Promise<typeof bases.$inferSelect> {
  const rows = await db
    .select()
    .from(bases)
    .where(and(eq(bases.orgId, orgId), eq(bases.id, baseId)))
    .limit(1)
  if (!rows[0]) throw new AppError("NOT_FOUND", "Base not found.")
  return rows[0]
}

async function requireTable(
  db: AppDb,
  orgId: string,
  tableId: string,
  baseId?: string,
): Promise<typeof tables.$inferSelect> {
  const rows = await db
    .select()
    .from(tables)
    .where(
      and(
        eq(tables.orgId, orgId),
        eq(tables.id, tableId),
        ...(baseId ? [eq(tables.baseId, baseId)] : []),
      ),
    )
    .limit(1)
  if (!rows[0]) throw new AppError("NOT_FOUND", "Table not found.")
  return rows[0]
}

/** Archived forms behave as if deleted: no detail, no publish, no public URL. */
async function requireForm(
  db: AppDb,
  orgId: string,
  formId: string,
): Promise<typeof forms.$inferSelect> {
  const rows = await db
    .select()
    .from(forms)
    .where(
      and(
        eq(forms.orgId, orgId),
        eq(forms.id, formId),
        isNull(forms.archivedAt),
      ),
    )
    .limit(1)
  if (!rows[0]) throw new AppError("NOT_FOUND", "Form not found.")
  return rows[0]
}

/**
 * Locks the form row for the duration of a transaction. Serialising writes per
 * form is what makes version numbering, draft replacement, and submission
 * de-duplication deterministic instead of racy.
 */
async function lockForm(
  db: AppDb,
  orgId: string,
  formId: string,
): Promise<typeof forms.$inferSelect> {
  const rows = await db
    .select()
    .from(forms)
    .where(
      and(
        eq(forms.orgId, orgId),
        eq(forms.id, formId),
        isNull(forms.archivedAt),
      ),
    )
    .for("update")
  if (!rows[0]) throw new AppError("NOT_FOUND", "Form not found.")
  return rows[0]
}

async function tableFieldRows(
  db: AppDb,
  orgId: string,
  tableId: string,
): Promise<Array<typeof fields.$inferSelect>> {
  return db
    .select()
    .from(fields)
    .where(
      and(
        eq(fields.orgId, orgId),
        eq(fields.tableId, tableId),
        eq(fields.status, "active"),
      ),
    )
    .orderBy(asc(fields.rank))
}

async function draftRows(
  db: AppDb,
  orgId: string,
  formId: string,
): Promise<Array<typeof formDraftFields.$inferSelect>> {
  return db
    .select()
    .from(formDraftFields)
    .where(
      and(
        eq(formDraftFields.orgId, orgId),
        eq(formDraftFields.formId, formId),
      ),
    )
    .orderBy(asc(formDraftFields.rank))
}

async function submissionCount(
  db: AppDb,
  orgId: string,
  formId: string,
): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(formSubmissions)
    .where(
      and(
        eq(formSubmissions.orgId, orgId),
        eq(formSubmissions.formId, formId),
      ),
    )
  return rows[0]?.count ?? 0
}

async function publishedVersionSummary(
  db: AppDb,
  orgId: string,
  versionId: string | null,
): Promise<PublishedVersionSummary | null> {
  if (!versionId) return null
  const rows = await db
    .select()
    .from(formVersions)
    .where(
      and(eq(formVersions.orgId, orgId), eq(formVersions.id, versionId)),
    )
    .limit(1)
  const version = rows[0]
  if (!version) return null
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    title: version.title,
    description: version.description,
    publishedAt: iso(version.publishedAt),
  }
}

/* -------------------------------------------------------------------------- */
/* Slugs                                                                       */
/* -------------------------------------------------------------------------- */

function slugBase(name: string): string {
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
  return normalized || "form"
}

const slugSuffix = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 6)

async function uniqueFormSlug(db: AppDb, name: string): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const slug = `${slugBase(name)}-${slugSuffix()}`
    const existing = await db
      .select({ id: forms.id })
      .from(forms)
      .where(eq(forms.slug, slug))
      .limit(1)
    if (!existing.length) return slug
  }
  throw new AppError(
    "VALIDATION_ERROR",
    "Could not create a unique share link. Try again.",
  )
}

/* -------------------------------------------------------------------------- */
/* List / detail                                                              */
/* -------------------------------------------------------------------------- */

export async function listForms(
  db: AppDb,
  orgId: string,
  options: { baseId?: string; tableId?: string } = {},
): Promise<FormSummaryDto[]> {
  const filters = [eq(forms.orgId, orgId), isNull(forms.archivedAt)]
  if (options.baseId) filters.push(eq(forms.baseId, options.baseId))
  if (options.tableId) filters.push(eq(forms.tableId, options.tableId))

  const rows = await db
    .select()
    .from(forms)
    .where(and(...filters))
    .orderBy(desc(forms.updatedAt))

  if (!rows.length) return []

  const formIds = rows.map((row) => row.id)
  const counts = await db
    .select({
      formId: formSubmissions.formId,
      count: sql<number>`count(*)::int`,
    })
    .from(formSubmissions)
    .where(
      and(
        eq(formSubmissions.orgId, orgId),
        inArray(formSubmissions.formId, formIds),
      ),
    )
    .groupBy(formSubmissions.formId)

  const versions = await db
    .select({
      formId: formVersions.formId,
      versionNumber: formVersions.versionNumber,
    })
    .from(formVersions)
    .where(
      and(eq(formVersions.orgId, orgId), inArray(formVersions.formId, formIds)),
    )
  const latestVersion = new Map<string, number>()
  for (const version of versions) {
    const current = latestVersion.get(version.formId) ?? 0
    if (version.versionNumber > current) {
      latestVersion.set(version.formId, version.versionNumber)
    }
  }

  const countByForm = new Map(counts.map((row) => [row.formId, row.count]))
  const baseRows = await db
    .select({ id: bases.id, name: bases.name })
    .from(bases)
    .where(eq(bases.orgId, orgId))
  const tableRows = await db
    .select({ id: tables.id, name: tables.name })
    .from(tables)
    .where(eq(tables.orgId, orgId))
  const baseNames = new Map(baseRows.map((row) => [row.id, row.name]))
  const tableNames = new Map(tableRows.map((row) => [row.id, row.name]))

  return rows.map((row) => ({
    ...toFormDto(row),
    baseName: baseNames.get(row.baseId) ?? null,
    tableName: tableNames.get(row.tableId) ?? null,
    submissionCount: countByForm.get(row.id) ?? 0,
    publishedVersionNumber: latestVersion.get(row.id) ?? null,
  }))
}
export async function getBaseFormsCatalog(
  db: AppDb,
  orgId: string,
  baseId: string,
): Promise<BaseFormsCatalog> {
  const base = await requireBase(db, orgId, baseId)
  const tableRows = await db
    .select()
    .from(tables)
    .where(
      and(
        eq(tables.orgId, orgId),
        eq(tables.baseId, baseId),
        eq(tables.status, "active"),
      ),
    )
    .orderBy(asc(tables.rank))

  if (!tableRows.length) {
    return { base: { id: base.id, name: base.name }, tables: [] }
  }

  const fieldRows = await db
    .select()
    .from(fields)
    .where(
      and(
        eq(fields.orgId, orgId),
        eq(fields.status, "active"),
        inArray(
          fields.tableId,
          tableRows.map((table) => table.id),
        ),
      ),
    )
    .orderBy(asc(fields.rank))

  const fieldsByTable = new Map<string, FormFieldOption[]>()
  for (const row of fieldRows) {
    const list = fieldsByTable.get(row.tableId) ?? []
    list.push(toFieldOption(row))
    fieldsByTable.set(row.tableId, list)
  }

  return {
    base: { id: base.id, name: base.name },
    tables: tableRows.map((table) => ({
      id: table.id,
      name: table.name,
      baseId: table.baseId,
      fields: fieldsByTable.get(table.id) ?? [],
    })),
  }
}

export async function getFormDetail(
  db: AppDb,
  orgId: string,
  formId: string,
): Promise<FormDetailDto> {
  const form = await requireForm(db, orgId, formId)
  const [fieldRows, draft, version, count] = await Promise.all([
    tableFieldRows(db, orgId, form.tableId),
    draftRows(db, orgId, formId),
    publishedVersionSummary(db, orgId, form.publishedVersionId),
    submissionCount(db, orgId, formId),
  ])

  const baseRows = await db
    .select({ id: bases.id, name: bases.name })
    .from(bases)
    .where(and(eq(bases.orgId, orgId), eq(bases.id, form.baseId)))
    .limit(1)
  const tableRows = await db
    .select({ id: tables.id, name: tables.name })
    .from(tables)
    .where(and(eq(tables.orgId, orgId), eq(tables.id, form.tableId)))
    .limit(1)

  return {
    form: toFormDto(form),
    base: baseRows[0] ?? null,
    table: tableRows[0] ?? null,
    draftFields: draft.map(toDraftDto),
    tableFields: fieldRows.map(toFieldOption),
    publishedVersion: version,
    submissionCount: count,
  }
}

/* -------------------------------------------------------------------------- */
/* Create / update / delete                                                    */
/* -------------------------------------------------------------------------- */

export async function createForm(
  db: AppDb,
  orgId: string,
  userId: string,
  input: unknown,
): Promise<FormDetailDto> {
  const body = inputObject(input)
  const baseId = requiredText(body.baseId, "Base", 120)
  const tableId = requiredText(body.tableId, "Table", 120)
  const name = requiredText(body.name, "Form name", 200)
  const description = optionalText(body.description, "Description", 5_000) ?? ""
  const selectedFieldIds = stringList(body.selectedFieldIds, "selectedFieldIds")

  await requireBase(db, orgId, baseId)
  await requireTable(db, orgId, tableId, baseId)

  const fieldRows = await tableFieldRows(db, orgId, tableId)
  const eligibleRows = fieldRows.filter((row) =>
    isEligibleFormFieldType(row.type as FieldType),
  )
  if (!eligibleRows.length) {
    throw new AppError(
      "VALIDATION_ERROR",
      "This table has no columns that a form can fill in.",
    )
  }

  let chosenIds: string[] | undefined
  if (selectedFieldIds && selectedFieldIds.length) {
    const eligibleIds = new Set(eligibleRows.map((row) => row.id))
    const unknown = selectedFieldIds.filter((id) => !eligibleIds.has(id))
    if (unknown.length) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Every selected column must exist in this table and accept form answers.",
      )
    }
    chosenIds = selectedFieldIds
  }

  const questions = draftQuestionsFromFields(
    fieldRows.map(toFieldDefinition),
    chosenIds,
  )
  if (!questions.length) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Select at least one column to build this form.",
    )
  }

  const formId = `frm_${nanoid(10)}`
  const slug = await uniqueFormSlug(db, name)

  await db.insert(forms).values({
    id: formId,
    orgId,
    baseId,
    tableId,
    name,
    description,
    slug,
    status: "draft",
    settings: { ...DEFAULT_SETTINGS },
    theme: { ...DEFAULT_THEME },
    thankYou: { ...DEFAULT_THANK_YOU },
    createdBy: userId,
  })

  await db.insert(formDraftFields).values(
    questions.map((question) => ({
      id: `fdf_${nanoid(10)}`,
      orgId,
      formId,
      targetFieldId: question.targetFieldId,
      label: question.label,
      helpText: question.helpText,
      placeholder: question.placeholder,
      required: question.required,
      hidden: question.mode === "hidden",
      rank: question.rank,
      mode: question.mode,
      visibilityRule: question.visibilityRule as unknown as Record<
        string,
        unknown
      > | null,
    })),
  )

  return getFormDetail(db, orgId, formId)
}

export async function updateForm(
  db: AppDb,
  orgId: string,
  formId: string,
  input: unknown,
): Promise<FormDetailDto> {
  const body = inputObject(input)
  const current = await requireForm(db, orgId, formId)
  const patch: Partial<typeof forms.$inferInsert> = { updatedAt: new Date() }

  if (body.name !== undefined) {
    patch.name = requiredText(body.name, "Form name", 200)
  }
  if (body.description !== undefined) {
    patch.description = optionalText(body.description, "Description", 5_000) ?? ""
  }
  if (body.status !== undefined) {
    const status = formStatus(body.status)
    if (status === "published" && !current.publishedVersionId) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Publish this form before making it live.",
      )
    }
    patch.status = status
  }
  if (body.theme !== undefined) {
    const raw =
      body.theme && typeof body.theme === "object"
        ? (body.theme as Record<string, unknown>)
        : {}
    patch.theme = normalizeFormTheme({
      ...normalizeFormTheme(current.theme),
      ...raw,
    }) as unknown as Record<string, unknown>
  }
  if (body.thankYou !== undefined) {
    patch.thankYou = normalizeFormThankYou(
      body.thankYou,
    ) as unknown as Record<string, unknown>
  }
  if (body.settings !== undefined) {
    patch.settings = normalizeFormSettings(
      body.settings,
    ) as unknown as Record<string, unknown>
  }
  if (body.analyticsTimeZone !== undefined) {
    patch.analyticsTimeZone = timeZone(
      body.analyticsTimeZone,
      current.analyticsTimeZone,
    )
  }

  await db.update(forms).set(patch).where(
    and(eq(forms.orgId, orgId), eq(forms.id, formId)),
  )

  return getFormDetail(db, orgId, formId)
}

/**
 * Archiving keeps the public URL dead (404) while versions, submissions, and
 * their records stay recoverable — a hard delete used to erase all three.
 */
export async function deleteForm(
  db: AppDb,
  orgId: string,
  formId: string,
): Promise<{ deleted: true }> {
  await requireForm(db, orgId, formId)
  const archived = await db
    .update(forms)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(forms.orgId, orgId),
        eq(forms.id, formId),
        isNull(forms.archivedAt),
      ),
    )
    .returning({ id: forms.id })
  if (!archived.length) throw new AppError("NOT_FOUND", "Form not found.")
  return { deleted: true }
}

/* -------------------------------------------------------------------------- */
/* Draft editing                                                               */
/* -------------------------------------------------------------------------- */

export async function getFormDraft(
  db: AppDb,
  orgId: string,
  formId: string,
): Promise<{ fields: FormDraftFieldDto[] }> {
  await requireForm(db, orgId, formId)
  return { fields: (await draftRows(db, orgId, formId)).map(toDraftDto) }
}

interface DraftFieldInput {
  id?: string
  targetFieldId: string
  label?: string
  helpText?: string
  placeholder?: string
  required?: boolean
  hidden?: boolean
  mode?: string
  visibilityRule?: unknown
}

function parseDraftFieldInput(value: unknown, index: number): DraftFieldInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Question ${index + 1} must be an object.`,
    )
  }
  const raw = value as Record<string, unknown>
  const targetFieldId = requiredText(
    raw.targetFieldId,
    `Question ${index + 1} column`,
    120,
  )
  const mode =
    raw.mode === "hidden" || raw.hidden === true ? "hidden" : "input"
  return {
    id: typeof raw.id === "string" ? raw.id : undefined,
    targetFieldId,
    label: optionalText(raw.label, "Question label", 200),
    helpText: optionalText(raw.helpText, "Helper text", 500),
    placeholder: optionalText(raw.placeholder, "Placeholder", 200),
    required: optionalBoolean(raw.required, "Required"),
    hidden: mode === "hidden",
    mode,
    visibilityRule: raw.visibilityRule,
  }
}

function draftFieldsFromInput(body: Record<string, unknown>): DraftFieldInput[] {
  const raw = body.fields ?? body.questions
  if (!Array.isArray(raw)) {
    throw new AppError("VALIDATION_ERROR", "fields must be a list of questions.")
  }
  return raw.map(parseDraftFieldInput)
}

export async function replaceFormDraft(
  db: AppDb,
  orgId: string,
  formId: string,
  input: unknown,
): Promise<{ fields: FormDraftFieldDto[] }> {
  const body = inputObject(input)
  const entries = draftFieldsFromInput(body)

  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as AppDb
    const form = await lockForm(tx, orgId, formId)

    const fieldRows = await tableFieldRows(tx, orgId, form.tableId)
    const fieldsById = new Map(fieldRows.map((row) => [row.id, row]))
    const existingRows = await draftRows(tx, orgId, formId)
    const existingIds = new Set(existingRows.map((row) => row.id))
    const usedIds = new Set<string>()
    const seenTargets = new Set<string>()

    const prepared = entries.map((entry, index) => {
      const field = fieldsById.get(entry.targetFieldId)
      if (!field) {
        throw new AppError(
          "VALIDATION_ERROR",
          `Question ${index + 1} points to a column that is not in this table.`,
        )
      }
      if (!isEligibleFormFieldType(field.type as FieldType)) {
        throw new AppError(
          "VALIDATION_ERROR",
          `“${field.name}” is a read-only column and cannot be a form question.`,
        )
      }
      if (seenTargets.has(entry.targetFieldId)) {
        throw new AppError(
          "VALIDATION_ERROR",
          `“${field.name}” is used by more than one question.`,
        )
      }
      seenTargets.add(entry.targetFieldId)

      let id = `fdf_${nanoid(10)}`
      if (entry.id && existingIds.has(entry.id) && !usedIds.has(entry.id)) {
        id = entry.id
      }
      usedIds.add(id)
      return {
        ...entry,
        id,
        fieldName: field.name,
        rank: "",
        index,
      }
    })

    const ids = new Set(prepared.map((entry) => entry.id))
    const ranks = draftRanks(prepared.length)
    const rows = prepared.map((entry) => ({
      id: entry.id,
      orgId,
      formId,
      targetFieldId: entry.targetFieldId,
      label: entry.label?.trim() || entry.fieldName,
      helpText: entry.helpText ?? "",
      placeholder: entry.placeholder ?? "",
      required: entry.required ?? false,
      hidden: entry.mode === "hidden",
      rank: ranks[entry.index],
      mode: entry.mode ?? "input",
      visibilityRule: visibilityRule(entry.visibilityRule, entry.id, ids, {
        strict: true,
      }) as unknown as Record<string, unknown> | null,
    }))

    await tx
      .delete(formDraftFields)
      .where(
        and(
          eq(formDraftFields.orgId, orgId),
          eq(formDraftFields.formId, formId),
        ),
      )
    if (rows.length) {
      await tx.insert(formDraftFields).values(rows)
    }

    return { fields: (await draftRows(tx, orgId, formId)).map(toDraftDto) }
  })
}

/**
 * Client-supplied draft IDs are only honored when they already belong to the
 * form being edited; everything else receives a fresh identifier.
 */

export async function generateFormDraft(
  db: AppDb,
  orgId: string,
  formId: string,
  input: unknown = {},
): Promise<{ fields: FormDraftFieldDto[]; mode: "replace" | "append" }> {
  const form = await requireForm(db, orgId, formId)
  const body = inputObject(input ?? {})
  const modeValue = body.mode === "append" ? "append" : "replace"
  const fieldIds = stringList(body.fieldIds, "fieldIds")

  const fieldRows = await tableFieldRows(db, orgId, form.tableId)
  const eligibleRows = fieldRows.filter((row) =>
    isEligibleFormFieldType(row.type as FieldType),
  )

  let pool = eligibleRows
  if (fieldIds && fieldIds.length) {
    const eligibleIds = new Set(eligibleRows.map((row) => row.id))
    const unknown = fieldIds.filter((id) => !eligibleIds.has(id))
    if (unknown.length) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Every chosen column must exist in this table and accept form answers.",
      )
    }
    const chosen = new Set(fieldIds)
    pool = eligibleRows.filter((row) => chosen.has(row.id))
  }

  if (modeValue === "replace") {
    const questions = draftQuestionsFromFields(pool.map(toFieldDefinition))
    if (!questions.length) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Choose at least one column to generate questions.",
      )
    }
    await db
      .delete(formDraftFields)
      .where(
        and(
          eq(formDraftFields.orgId, orgId),
          eq(formDraftFields.formId, formId),
        ),
      )
    await db.insert(formDraftFields).values(
      questions.map((question) => ({
        id: `fdf_${nanoid(10)}`,
        orgId,
        formId,
        targetFieldId: question.targetFieldId,
        label: question.label,
        helpText: question.helpText,
        placeholder: question.placeholder,
        required: question.required,
        hidden: false,
        rank: question.rank,
        mode: question.mode,
        visibilityRule: question.visibilityRule as unknown as Record<
          string,
          unknown
        > | null,
      })),
    )
  } else {
    const existing = await draftRows(db, orgId, formId)
    const used = new Set(existing.map((row) => row.targetFieldId))
    const additions = pool.filter((row) => !used.has(row.id))
    if (!additions.length) {
      return { fields: existing.map(toDraftDto), mode: "append" }
    }
    const questions = draftQuestionsFromFields(
      additions.map(toFieldDefinition),
    )
    const ranks = draftRanks(
      questions.length,
      existing.at(-1)?.rank ?? null,
    )
    await db.insert(formDraftFields).values(
      questions.map((question, index) => ({
        id: `fdf_${nanoid(10)}`,
        orgId,
        formId,
        targetFieldId: question.targetFieldId,
        label: question.label,
        helpText: question.helpText,
        placeholder: question.placeholder,
        required: question.required,
        hidden: false,
        rank: ranks[index],
        mode: question.mode,
        visibilityRule: question.visibilityRule as unknown as Record<
          string,
          unknown
        > | null,
      })),
    )
  }

  return {
    fields: (await draftRows(db, orgId, formId)).map(toDraftDto),
    mode: modeValue,
  }
}

/* -------------------------------------------------------------------------- */
/* Publishing                                                                  */
/* -------------------------------------------------------------------------- */

export interface PublishFormResult {
  form: FormRecordDto
  version: PublishedVersionSummary
  publicUrl: string
}

const MAX_PUBLISH_ATTEMPTS = 3

/** Postgres unique violation, however the driver surfaces it. */
function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  if ("code" in error && error.code === "23505") return true
  if ("message" in error && typeof error.message === "string") {
    return /duplicate key value|unique constraint/i.test(error.message)
  }
  return false
}

/**
 * Publishes the current draft as the next immutable version.
 *
 * The version row, its snapshot fields, and the form pointer are written in one
 * transaction under a form-row lock, so concurrent publishes serialise instead
 * of racing on `version_number`; the retry covers any writer that bypasses the
 * lock. A failure anywhere leaves no version row and no published pointer.
 */
export async function publishForm(
  db: AppDb,
  orgId: string,
  userId: string,
  formId: string,
): Promise<PublishFormResult> {
  for (let attempt = 1; attempt <= MAX_PUBLISH_ATTEMPTS; attempt += 1) {
    try {
      return await db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as AppDb
        const form = await lockForm(tx, orgId, formId)
        const draft = await draftRows(tx, orgId, formId)
        if (!draft.length) {
          throw new AppError(
            "VALIDATION_ERROR",
            "Add at least one question before publishing.",
          )
        }

        const fieldRows = await tableFieldRows(tx, orgId, form.tableId)
        const fieldsById = new Map(fieldRows.map((row) => [row.id, row]))

        const snapshot = draft.map((row) => {
          const field = fieldsById.get(row.targetFieldId)
          if (!field) {
            throw new AppError(
              "VALIDATION_ERROR",
              `“${row.label}” points to a column that was removed from this table.`,
            )
          }
          if (isReadOnlyFieldType(field.type as FieldType)) {
            throw new AppError(
              "VALIDATION_ERROR",
              `“${row.label}” is a read-only column and cannot accept answers.`,
            )
          }
          return { row, field }
        })

        const latest = await tx
          .select({ versionNumber: formVersions.versionNumber })
          .from(formVersions)
          .where(
            and(eq(formVersions.orgId, orgId), eq(formVersions.formId, formId)),
          )
          .orderBy(desc(formVersions.versionNumber))
          .limit(1)
        const versionNumber = (latest[0]?.versionNumber ?? 0) + 1
        const versionId = `fver_${nanoid(10)}`

        const theme = normalizeFormTheme(form.theme)
        const thankYou = normalizeFormThankYou(form.thankYou)
        const settings = normalizeFormSettings(form.settings)

        const [versionRow] = await tx
          .insert(formVersions)
          .values({
            id: versionId,
            orgId,
            formId,
            versionNumber,
            title: form.name,
            description: form.description,
            settings: { ...settings },
            theme: { ...theme },
            thankYou: { ...thankYou },
            publishedBy: userId,
          })
          .returning({ publishedAt: formVersions.publishedAt })

        const versionFieldIds = snapshot.map(() => `fvf_${nanoid(10)}`)
        const draftIdToVersionId = new Map(
          snapshot.map(({ row }, index) => [row.id, versionFieldIds[index]]),
        )
        const draftIds = new Set(draft.map((row) => row.id))

        await tx.insert(formVersionFields).values(
          snapshot.map(({ row, field }, index) => {
            const rule = visibilityRule(row.visibilityRule, row.id, draftIds)
            return {
              id: versionFieldIds[index],
              orgId,
              formVersionId: versionId,
              targetFieldId: row.targetFieldId,
              targetFieldType: field.type,
              label: row.label,
              helpText: row.helpText,
              placeholder: row.placeholder,
              required: row.required,
              hidden: row.mode === "hidden",
              rank: row.rank,
              mode: row.mode === "hidden" ? "hidden" : "visible",
              fieldConfig: { ...((field.config ?? {}) as Record<string, unknown>) },
              visibilityRule: rule
                ? ({
                    conjunction: rule.conjunction,
                    conditions: rule.conditions.map((condition) => {
                      const sourceQuestionId =
                        draftIdToVersionId.get(condition.sourceQuestionId) ??
                        condition.sourceQuestionId
                      return {
                        ...condition,
                        sourceQuestionId,
                        sourceFieldId: sourceQuestionId,
                      }
                    }),
                  } as unknown as Record<string, unknown>)
                : null,
            }
          }),
        )

        const [updated] = await tx
          .update(forms)
          .set({
            publishedVersionId: versionId,
            status: "published",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(forms.orgId, orgId),
              eq(forms.id, formId),
              isNull(forms.archivedAt),
            ),
          )
          .returning()
        if (!updated) throw new AppError("NOT_FOUND", "Form not found.")

        return {
          form: toFormDto(updated),
          version: {
            id: versionId,
            versionNumber,
            title: form.name,
            description: form.description,
            publishedAt: iso(versionRow.publishedAt),
          },
          publicUrl: `/f/${form.slug}`,
        }
      })
    } catch (error) {
      if (attempt < MAX_PUBLISH_ATTEMPTS && isUniqueViolation(error)) continue
      throw error
    }
  }

  throw new AppError(
    "REVISION_CONFLICT",
    "This form was published by someone else. Refresh and try again.",
  )
}

/* -------------------------------------------------------------------------- */
/* Submissions                                                                 */
/* -------------------------------------------------------------------------- */

function optionLabel(field: FieldDefinition, optionId: string): string {
  return (
    field.config.options?.find((option) => option.id === optionId)?.label ??
    optionId
  )
}

function displayCell(
  field: FieldDefinition | undefined,
  value: unknown,
): string {
  if (value === null || value === undefined) return ""
  if (Array.isArray(value)) {
    if (field?.type === "attachment" || field?.type === "image") {
      return value
        .map((item) =>
          item && typeof item === "object" && "name" in item
            ? String((item as { name: unknown }).name ?? "")
            : "",
        )
        .filter(Boolean)
        .join(", ")
    }
    if (field?.type === "multiSelect") {
      return value
        .map((item) =>
          typeof item === "string" ? optionLabel(field, item) : String(item),
        )
        .join(", ")
    }
    return value.map(String).join(", ")
  }
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (field?.type === "singleSelect" && typeof value === "string") {
    return optionLabel(field, value)
  }
  if (field?.type === "date" && typeof value === "number") {
    return new Date(value).toISOString().slice(0, 10)
  }
  return String(value)
}

async function submissionColumns(
  db: AppDb,
  orgId: string,
  form: typeof forms.$inferSelect,
): Promise<FormSubmissionColumn[]> {
  if (form.publishedVersionId) {
    const versionFieldRows = await db
      .select()
      .from(formVersionFields)
      .where(
        and(
          eq(formVersionFields.orgId, orgId),
          eq(formVersionFields.formVersionId, form.publishedVersionId),
        ),
      )
      .orderBy(asc(formVersionFields.rank))
    if (versionFieldRows.length) {
      return versionFieldRows.map((row) => ({
        fieldId: row.targetFieldId,
        label: row.label,
        type: row.targetFieldType as FieldType,
        config: (row.fieldConfig ?? {}) as FieldConfig,
      }))
    }
  }
  const draft = await draftRows(db, orgId, form.id)
  const fieldRows = await tableFieldRows(db, orgId, form.tableId)
  const fieldsById = new Map(fieldRows.map((row) => [row.id, row]))
  return draft.map((row) => {
    const field = fieldsById.get(row.targetFieldId)
    return {
      fieldId: row.targetFieldId,
      label: row.label,
      type: (field?.type ?? "singleLineText") as FieldType,
      config: (field?.config ?? {}) as FieldConfig,
    }
  })
}

export async function getFormSubmissions(
  db: AppDb,
  orgId: string,
  formId: string,
): Promise<FormSubmissionsDto> {
  const form = await requireForm(db, orgId, formId)
  const columns = await submissionColumns(db, orgId, form)

  const submissionRows = await db
    .select()
    .from(formSubmissions)
    .where(
      and(
        eq(formSubmissions.orgId, orgId),
        eq(formSubmissions.formId, formId),
      ),
    )
    .orderBy(desc(formSubmissions.submittedAt))
    .limit(2_000)

  const recordIds = submissionRows
    .map((row) => row.recordId)
    .filter((id): id is string => Boolean(id))
  const recordRows = recordIds.length
    ? await db
        .select()
        .from(records)
        .where(and(eq(records.orgId, orgId), inArray(records.id, recordIds)))
    : []
  const recordsById = new Map(recordRows.map((row) => [row.id, row]))

  const versionNumbers = new Map<string, number>()
  if (submissionRows.length) {
    const versionRows = await db
      .select({
        id: formVersions.id,
        versionNumber: formVersions.versionNumber,
      })
      .from(formVersions)
      .where(eq(formVersions.orgId, orgId))
    for (const version of versionRows) {
      versionNumbers.set(version.id, version.versionNumber)
    }
  }

  const fieldDefinitions: FieldDefinition[] = columns.map((column) => ({
    id: column.fieldId,
    name: column.label,
    type: column.type,
    config: column.config,
    rank: "",
    width: 180,
    isPrimary: false,
  }))

  const submissions: FormSubmissionDto[] = submissionRows.map((row) => {
    const record = row.recordId ? recordsById.get(row.recordId) : undefined
    const sourceValues = (record?.values ??
      row.answers ??
      {}) as Record<string, unknown>
    const displayValues: Record<string, string> = {}
    columns.forEach((column, index) => {
      displayValues[column.fieldId] = displayCell(
        fieldDefinitions[index],
        sourceValues[column.fieldId],
      )
    })
    return {
      id: row.id,
      submittedAt: iso(row.submittedAt),
      recordId: row.recordId ?? null,
      versionNumber: versionNumbers.get(row.formVersionId) ?? null,
      answers: (row.answers ?? {}) as Record<string, unknown>,
      record: record
        ? {
            id: record.id,
            values: (record.values ?? {}) as Record<string, unknown>,
            revision: record.revision,
          }
        : null,
      displayValues,
    }
  })

  return {
    form: { id: form.id, name: form.name, slug: form.slug },
    columns,
    submissions,
    total: submissions.length,
  }
}

export async function getFormSubmissionsCsv(
  db: AppDb,
  orgId: string,
  formId: string,
): Promise<{ csv: string; fileName: string }> {
  const report = await getFormSubmissions(db, orgId, formId)
  const csv = createFormSubmissionsCsv({
    formName: report.form.name,
    columns: report.columns.map((column) => column.label),
    rows: report.submissions.map((submission) => ({
      submittedAt: Date.parse(submission.submittedAt),
      version: submission.versionNumber ?? 0,
      responseLabel:
        submission.recordId ?? submission.id,
      answers: report.columns.map(
        (column) => submission.displayValues[column.fieldId] ?? "",
      ),
    })),
    truncated: report.total >= 2_000,
  })
  return {
    csv,
    fileName: formSubmissionsCsvFileName({ formName: report.form.name }),
  }
}

/* -------------------------------------------------------------------------- */
/* Analytics                                                                   */
/* -------------------------------------------------------------------------- */

export async function getFormAnalytics(
  db: AppDb,
  orgId: string,
  formId: string,
  options: { days?: number } = {},
): Promise<FormAnalyticsDto> {
  const form = await requireForm(db, orgId, formId)
  const zone = timeZone(form.analyticsTimeZone)
  const days = Math.min(90, Math.max(1, Math.floor(options.days ?? 30)))
  const range = analyticsRange(days, new Date(), zone)

  const bucketRows = await db
    .select()
    .from(formMetricBuckets)
    .where(
      and(
        eq(formMetricBuckets.orgId, orgId),
        eq(formMetricBuckets.formId, formId),
      ),
    )

  const byDay = new Map<string, FormAnalyticsPoint>()
  const totals = { views: 0, starts: 0, submissions: 0 }

  for (const bucket of bucketRows) {
    if (bucket.day < range.fromDay || bucket.day > range.toDay) continue
    if (!PUBLIC_FORM_METRICS.has(bucket.metric)) continue
    const point =
      byDay.get(bucket.day) ??
      ({
        day: bucket.day,
        views: 0,
        starts: 0,
        submissions: 0,
      } satisfies FormAnalyticsPoint)
    if (bucket.metric === "view") point.views += bucket.count
    if (bucket.metric === "start") point.starts += bucket.count
    if (bucket.metric === "submission") point.submissions += bucket.count
    byDay.set(bucket.day, point)
  }

  const series: FormAnalyticsPoint[] = []
  const start = Date.parse(`${range.fromDay}T00:00:00.000Z`)
  const end = Date.parse(`${range.toDay}T00:00:00.000Z`)
  for (let cursor = start; cursor <= end; cursor += 86_400_000) {
    const day = new Date(cursor).toISOString().slice(0, 10)
    const point = byDay.get(day) ?? {
      day,
      views: 0,
      starts: 0,
      submissions: 0,
    }
    series.push(point)
    totals.views += point.views
    totals.starts += point.starts
    totals.submissions += point.submissions
  }

  // Completion is measured against people who started the form; views are the
  // fallback for older forms that never recorded a start event.
  const started = totals.starts > 0 ? totals.starts : totals.views
  return {
    form: { id: form.id, name: form.name, slug: form.slug },
    fromDay: range.fromDay,
    toDay: range.toDay,
    totals,
    completionRate:
      started > 0 ? Math.min(1, totals.submissions / started) : 0,
    series,
  }
}

/* -------------------------------------------------------------------------- */
/* Metrics                                                                     */
/* -------------------------------------------------------------------------- */

function safeDay(zone: string): string {
  try {
    return analyticsDay(new Date(), zone)
  } catch {
    return analyticsDay(new Date(), "UTC")
  }
}

async function incrementBucket(
  db: AppDb,
  orgId: string,
  formId: string,
  day: string,
  metric: string,
  breakdownKind = "total",
  breakdownKey = "all",
): Promise<void> {
  // One statement: concurrent increments either create the bucket or add to it,
  // never both (the read-then-write version lost updates under contention).
  await db
    .insert(formMetricBuckets)
    .values({
      id: `fmb_${nanoid(10)}`,
      orgId,
      formId,
      day,
      metric,
      breakdownKind,
      breakdownKey,
      count: 1,
    })
    .onConflictDoUpdate({
      target: [
        formMetricBuckets.formId,
        formMetricBuckets.day,
        formMetricBuckets.metric,
        formMetricBuckets.breakdownKind,
        formMetricBuckets.breakdownKey,
      ],
      set: { count: sql`${formMetricBuckets.count} + 1` },
    })
}

/* -------------------------------------------------------------------------- */
/* Public form                                                                 */
/* -------------------------------------------------------------------------- */

async function formBySlug(
  db: AppDb,
  slug: string,
): Promise<typeof forms.$inferSelect> {
  const rows = await db
    .select()
    .from(forms)
    .where(eq(forms.slug, slug))
    .limit(1)
  if (!rows[0]) throw new AppError("NOT_FOUND", "Form not found.")
  return rows[0]
}

function assertPublished(form: typeof forms.$inferSelect): void {
  if (form.archivedAt) {
    throw new AppError("NOT_FOUND", "Form not found.")
  }
  if (form.status === "closed") {
    throw new AppError("FORM_CLOSED", "This form is closed.")
  }
  if (form.status !== "published" || !form.publishedVersionId) {
    throw new AppError("NOT_FOUND", "Form not found.")
  }
}

async function publishedVersionFields(
  db: AppDb,
  orgId: string,
  versionId: string,
): Promise<Array<typeof formVersionFields.$inferSelect>> {
  return db
    .select()
    .from(formVersionFields)
    .where(
      and(
        eq(formVersionFields.orgId, orgId),
        eq(formVersionFields.formVersionId, versionId),
      ),
    )
    .orderBy(asc(formVersionFields.rank))
}

function publicQuestions(
  versionFields: Array<typeof formVersionFields.$inferSelect>,
): FormQuestion[] {
  const ids = new Set(versionFields.map((row) => row.id))
  return versionFields.map((row) => {
    const question: FormQuestion = {
      id: row.id,
      fieldId: row.id,
      label: row.label,
      helpText: row.helpText,
      required: row.required,
      rank: row.rank,
      mode: row.mode === "hidden" ? "hidden" : "visible",
    }
    if (row.placeholder) question.placeholder = row.placeholder
    const rule = visibilityRule(row.visibilityRule, row.id, ids)
    if (rule) question.visibility = rule
    return question
  })
}

function publicFieldDefinitions(
  versionFields: Array<typeof formVersionFields.$inferSelect>,
): FieldDefinition[] {
  return versionFields.map((row) => ({
    id: row.id,
    name: row.label,
    type: row.targetFieldType as FieldType,
    config: (row.fieldConfig ?? {}) as FieldConfig,
    rank: row.rank,
    width: 180,
    isPrimary: false,
  }))
}

export async function getPublicForm(
  db: AppDb,
  slug: string,
): Promise<PublicFormDto> {
  const form = await formBySlug(db, slug)
  assertPublished(form)

  const versionRows = await db
    .select()
    .from(formVersions)
    .where(
      and(
        eq(formVersions.orgId, form.orgId),
        eq(formVersions.id, form.publishedVersionId!),
      ),
    )
    .limit(1)
  const version = versionRows[0]
  if (!version) throw new AppError("NOT_FOUND", "Form not found.")

  const versionFields = await publishedVersionFields(
    db,
    form.orgId,
    version.id,
  )
  if (!versionFields.length) throw new AppError("NOT_FOUND", "Form not found.")

  const theme = normalizeFormTheme(version.theme ?? form.theme)
  const thankYou = normalizeFormThankYou(version.thankYou ?? form.thankYou)
  const settings = normalizeFormSettings(version.settings ?? form.settings)
  const questions = publicQuestions(versionFields)
  const formFields = publicFieldDefinitions(versionFields)

  const definition: FormDefinition = {
    id: form.id,
    baseId: form.baseId,
    tableId: form.tableId,
    name: form.name,
    title: version.title || form.name,
    description: version.description || form.description,
    submitLabel: settings.submitLabel,
    thankYouTitle: thankYou.title,
    thankYouMessage: thankYou.message,
    publicSlug: form.slug,
    status: "published",
    theme,
    questions,
    version: version.versionNumber,
  }
  if (thankYou.redirectUrl) definition.redirectUrl = thankYou.redirectUrl

  return {
    slug: form.slug,
    formId: form.id,
    versionId: version.id,
    version: version.versionNumber,
    title: definition.title,
    description: definition.description,
    publishedAt: iso(version.publishedAt),
    theme,
    thankYou,
    settings,
    questions,
    form: definition,
    fields: formFields,
  }
}

function isBlankAnswer(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  )
}

function normalizeAnswers(raw: unknown): Map<string, unknown> {
  if (!raw || typeof raw !== "object") {
    throw new AppError("VALIDATION_ERROR", "answers must be submitted.")
  }
  const entries: Array<[string, unknown]> = Array.isArray(raw)
    ? raw.flatMap((item) => {
        if (!item || typeof item !== "object") return []
        const row = item as Record<string, unknown>
        const key = row.questionId ?? row.fieldId ?? row.id
        return typeof key === "string" ? [[key, row.value] as [string, unknown]] : []
      })
    : Object.entries(raw as Record<string, unknown>)
  return new Map(entries)
}

async function allocateAutoNumbers(
  db: AppDb,
  orgId: string,
  tableId: string,
): Promise<Record<string, number>> {
  const autoFields = await db
    .select()
    .from(fields)
    .where(
      and(
        eq(fields.orgId, orgId),
        eq(fields.tableId, tableId),
        eq(fields.type, "autoNumber"),
        eq(fields.status, "active"),
      ),
    )
  const values: Record<string, number> = {}

  for (const field of autoFields) {
    const bumped = await db
      .update(fieldSequences)
      .set({ nextValue: sql`${fieldSequences.nextValue} + 1` })
      .where(eq(fieldSequences.fieldId, field.id))
      .returning({ nextValue: fieldSequences.nextValue })

    if (bumped[0]) {
      values[field.id] = bumped[0].nextValue - 1
      continue
    }

    await db
      .insert(fieldSequences)
      .values({ fieldId: field.id, tableId, nextValue: 2 })
      .onConflictDoNothing()

    const afterInsert = await db
      .update(fieldSequences)
      .set({ nextValue: sql`${fieldSequences.nextValue} + 1` })
      .where(eq(fieldSequences.fieldId, field.id))
      .returning({ nextValue: fieldSequences.nextValue })

    if (!afterInsert[0]) {
      throw new Error("Could not allocate the next record number.")
    }
    values[field.id] = afterInsert[0].nextValue - 1
  }

  return values
}

/** Respondent facts the transport knows and the service needs. */
export interface PublicSubmissionContext {
  /** `Idempotency-Key` header, when the caller sends one. */
  idempotencyKey?: string
  ip?: string
  userAgent?: string
}

const ANONYMOUS_RESPONDENT = "anonymous"

/**
 * Stable per-person key. IP plus user agent is weak evidence, but it is all a
 * public form has; forms that allow one response per person rely on it.
 */
function respondentKeyFor(
  formId: string,
  context: PublicSubmissionContext,
): string {
  const ip = context.ip?.trim() ?? ""
  const userAgent = context.userAgent?.trim() ?? ""
  if (!ip && !userAgent) return ANONYMOUS_RESPONDENT
  return createHash("sha256")
    .update(`${formId}\u0000${ip}\u0000${userAgent}`)
    .digest("hex")
}

function submissionKeyFor(
  body: Record<string, unknown>,
  context: PublicSubmissionContext,
): string | undefined {
  for (const candidate of [context.idempotencyKey, body.submissionKey]) {
    if (candidate === undefined) continue
    if (typeof candidate !== "string") {
      throw new AppError("VALIDATION_ERROR", "submissionKey must be a string.")
    }
    const trimmed = candidate.trim()
    if (!trimmed) continue
    if (trimmed.length > 200) {
      throw new AppError(
        "VALIDATION_ERROR",
        "submissionKey must be 200 characters or fewer.",
      )
    }
    return trimmed
  }
  return undefined
}

async function lockFormBySlug(
  db: AppDb,
  slug: string,
): Promise<typeof forms.$inferSelect> {
  const rows = await db
    .select()
    .from(forms)
    .where(eq(forms.slug, slug))
    .for("update")
  if (!rows[0]) throw new AppError("NOT_FOUND", "Form not found.")
  return rows[0]
}

type SubmissionKeyKind = "idempotencyKey" | "respondentKey"

async function findSubmissionByKey(
  db: AppDb,
  orgId: string,
  formId: string,
  kind: SubmissionKeyKind,
  value: string,
): Promise<{ id: string; recordId: string | null } | undefined> {
  const rows = await db
    .select({ id: formSubmissions.id, recordId: formSubmissions.recordId })
    .from(formSubmissions)
    .where(
      and(
        eq(formSubmissions.orgId, orgId),
        eq(formSubmissions.formId, formId),
        sql`${formSubmissions.metadata} ->> ${kind} = ${value}`,
      ),
    )
    .limit(1)
  return rows[0]
}

/**
 * Stores one public response and its linked record atomically.
 *
 * Everything runs in a single transaction under a form-row lock: idempotency
 * and duplicate-respondent checks, auto-number allocation, the record insert,
 * the submission row, and the analytics bucket. A failure at any point rolls
 * all of it back, so a rejected submission never burns a sequence number or
 * leaves an orphan record behind.
 */
export async function submitPublicForm(
  db: AppDb,
  slug: string,
  input: unknown,
  context: PublicSubmissionContext = {},
): Promise<PublicSubmissionResult> {
  const body = inputObject(input, "submission")
  const requestedKey = submissionKeyFor(body, context)

  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as AppDb
    const form = await lockFormBySlug(tx, slug)
    assertPublished(form)

    const versionRows = await tx
      .select()
      .from(formVersions)
      .where(
        and(
          eq(formVersions.orgId, form.orgId),
          eq(formVersions.id, form.publishedVersionId!),
        ),
      )
      .limit(1)
    const version = versionRows[0]
    if (!version) throw new AppError("NOT_FOUND", "Form not found.")

    const thankYou = normalizeFormThankYou(version.thankYou ?? form.thankYou)
    const settings = normalizeFormSettings(version.settings ?? form.settings)
    const respondentKey = respondentKeyFor(form.id, context)

    // A retry with the same key is the same submission, whatever changed since.
    if (requestedKey) {
      const existing = await findSubmissionByKey(
        tx,
        form.orgId,
        form.id,
        "idempotencyKey",
        requestedKey,
      )
      if (existing) {
        return {
          submissionId: existing.id,
          recordId: existing.recordId ?? "",
          thankYou,
        }
      }
    }

    if (!settings.allowMultipleSubmissions) {
      const existing = await findSubmissionByKey(
        tx,
        form.orgId,
        form.id,
        "respondentKey",
        respondentKey,
      )
      if (existing) {
        throw new HttpStatusError(
          "DUPLICATE_SUBMISSION",
          "You have already submitted this form.",
          409,
          { submissionId: existing.id },
        )
      }
    }

    const versionFields = await publishedVersionFields(
      tx,
      form.orgId,
      version.id,
    )
    if (!versionFields.length) throw new AppError("NOT_FOUND", "Form not found.")

    const questions = publicQuestions(versionFields)
    const questionsById = new Map(
      questions.map((question) => [question.id, question]),
    )
    const questionByTarget = new Map(
      versionFields.map((row) => [row.targetFieldId, row.id]),
    )

    const submitted = normalizeAnswers(body.answers)
    const answers = new Map<string, unknown>()
    for (const [key, value] of submitted) {
      const questionId = questionsById.has(key)
        ? key
        : questionByTarget.get(key)
      if (!questionId) {
        throw new AppError(
          "FORM_UPDATED",
          "This form changed while you were submitting. Refresh and send your response again.",
          { questions: [{ id: key, label: null }] },
        )
      }
      answers.set(questionId, value)
    }

    const visible = new Set(
      visibleFormQuestions(
        questions,
        answers as ReadonlyMap<string, FormAnswerValue>,
      ).map((question) => question.id),
    )

    const submittedValues: Record<string, unknown> = {}
    const snapshotFields: FieldDefinition[] = versionFields.map((row) => ({
      id: row.targetFieldId,
      name: row.label,
      type: row.targetFieldType as FieldType,
      config: (row.fieldConfig ?? {}) as FieldConfig,
      rank: row.rank,
      width: 180,
      isPrimary: false,
    }))

    for (const row of versionFields) {
      if (!visible.has(row.id) || row.mode === "hidden") continue
      const raw = answers.get(row.id)
      if (isBlankAnswer(raw)) {
        if (row.required) {
          throw new AppError("VALIDATION_ERROR", `“${row.label}” is required.`)
        }
        continue
      }
      submittedValues[row.targetFieldId] = raw
    }

    // Columns archived after publishing are refused instead of silently
    // storing values in a field nobody can see any more.
    const tableFields = await tableFieldRows(tx, form.orgId, form.tableId)
    const activeFieldIds = new Set(tableFields.map((row) => row.id))
    const changedQuestions = versionFields
      .filter(
        (row) =>
          row.targetFieldId in submittedValues &&
          !activeFieldIds.has(row.targetFieldId),
      )
      .map((row) => ({ id: row.id, label: row.label }))
    if (changedQuestions.length) {
      throw new AppError(
        "FORM_UPDATED",
        `This form changed while you were submitting: ${changedQuestions
          .map((question) => `“${question.label}”`)
          .join(", ")} no longer accepts answers. Refresh and send your response again.`,
        { questions: changedQuestions },
      )
    }

    const recordValues: Record<string, unknown> = validateRecordValues(
      submittedValues,
      snapshotFields,
    )

    const autoNumbers = await allocateAutoNumbers(tx, form.orgId, form.tableId)
    Object.assign(recordValues, autoNumbers)

    const searchText = buildRecordSearchText(
      recordValues,
      tableFields.map(toFieldDefinition),
    )

    const lastRecord = await tx
      .select({ rank: records.rank })
      .from(records)
      .where(
        and(eq(records.orgId, form.orgId), eq(records.tableId, form.tableId)),
      )
      .orderBy(desc(records.rank))
      .limit(1)
    const rank = generateKeyBetween(lastRecord[0]?.rank ?? null, null)

    const recordId = `rec_${nanoid(12)}`
    await tx.insert(records).values({
      id: recordId,
      orgId: form.orgId,
      tableId: form.tableId,
      rank,
      values: recordValues,
      searchText,
      revision: 1,
      status: "active",
      createdBy: PUBLIC_ACTOR,
      updatedBy: PUBLIC_ACTOR,
    })

    const submissionId = `sub_${nanoid(12)}`
    await tx.insert(formSubmissions).values({
      id: submissionId,
      orgId: form.orgId,
      formId: form.id,
      formVersionId: version.id,
      recordId,
      answers: recordValues,
      metadata: {
        source: "public-form",
        slug: form.slug,
        respondentKey,
        ...(requestedKey ? { idempotencyKey: requestedKey } : {}),
      },
    })

    await incrementBucket(
      tx,
      form.orgId,
      form.id,
      safeDay(timeZone(form.analyticsTimeZone)),
      "submission",
    )

    return { submissionId, recordId, thankYou }
  })
}

export async function recordPublicFormMetric(
  db: AppDb,
  slug: string,
  input: unknown,
): Promise<{ ok: true; metric: string; day: string }> {
  const body = inputObject(input, "metric")
  const metric = body.metric
  if (typeof metric !== "string" || !DRAFT_METRICS.has(metric)) {
    throw new AppError(
      "VALIDATION_ERROR",
      "metric must be “view” or “start”.",
    )
  }

  const form = await formBySlug(db, slug)
  assertPublished(form)

  const day = safeDay(timeZone(form.analyticsTimeZone))
  const breakdownKind =
    typeof body.breakdownKind === "string" && body.breakdownKind
      ? body.breakdownKind.slice(0, 40)
      : "total"
  const breakdownKey =
    typeof body.breakdownKey === "string" && body.breakdownKey
      ? body.breakdownKey.slice(0, 120)
      : "all"

  await incrementBucket(
    db,
    form.orgId,
    form.id,
    day,
    metric,
    breakdownKind,
    breakdownKey,
  )
  return { ok: true, metric, day }
}
