import {
  AppError,
  type AttachmentValue,
  type CellValue,
  type FieldConfig,
  type FieldDefinition,
  type FieldType,
} from "@/lib/domain"
import { fieldConfigIssue, textLengthLimit } from "@/lib/field-config-validation"

export const MAX_RECORD_VALUE_BYTES = 256 * 1024

export const READ_ONLY_FIELD_TYPES: ReadonlySet<FieldType> = new Set([
  "autoNumber",
  "createdTime",
  "createdBy",
])

export function isReadOnlyFieldType(type: FieldType): boolean {
  return READ_ONLY_FIELD_TYPES.has(type)
}

export function validateFieldConfiguration(
  type: FieldType,
  config: FieldConfig = {},
): FieldConfig {
  const issue = fieldConfigIssue(type, config)
  if (issue) {
    throw new AppError("VALIDATION_ERROR", issue)
  }

  const normalized: FieldConfig = { ...config }
  if (type === "image") {
    normalized.attachmentKind = "image"
  }
  if (type === "rating") {
    const maxRating = normalized.maxRating ?? 5
    if (!Number.isInteger(maxRating) || maxRating < 1 || maxRating > 10) {
      throw new AppError("VALIDATION_ERROR", "Rating scale must be an integer between 1 and 10.")
    }
    normalized.maxRating = maxRating
  }
  return normalized
}

function isAttachmentValue(item: unknown): item is AttachmentValue {
  if (typeof item !== "object" || item === null) return false
  const candidate = item as Record<string, unknown>
  return (
    typeof candidate.attachmentId === "string" &&
    candidate.attachmentId.length > 0 &&
    typeof candidate.name === "string" &&
    typeof candidate.mimeType === "string" &&
    typeof candidate.size === "number" &&
    Number.isFinite(candidate.size) &&
    candidate.size >= 0
  )
}

export function validateCellValue(
  field: Pick<FieldDefinition, "id" | "name" | "type" | "config">,
  value: unknown,
  options?: { allowReadOnly?: boolean },
): CellValue {
  if (value === null || value === undefined || value === "") {
    if (isReadOnlyFieldType(field.type) && !options?.allowReadOnly) {
      throw new AppError("VALIDATION_ERROR", `${field.name} is read-only and cannot be edited.`)
    }
    return null
  }

  if (isReadOnlyFieldType(field.type)) {
    if (!options?.allowReadOnly) {
      throw new AppError("VALIDATION_ERROR", `${field.name} is read-only and cannot be edited.`)
    }
    if (field.type === "autoNumber") {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
        throw new AppError("VALIDATION_ERROR", `${field.name} must be a positive integer.`)
      }
      return value
    }
    if (field.type === "createdTime") {
      if (typeof value !== "number" && typeof value !== "string") {
        throw new AppError("VALIDATION_ERROR", `${field.name} must be a timestamp or date string.`)
      }
      return value
    }
    if (typeof value !== "string") {
      throw new AppError("VALIDATION_ERROR", `${field.name} must be a string.`)
    }
    return value
  }

  switch (field.type) {
    case "singleLineText":
    case "longText":
    case "email":
    case "phone":
    case "url": {
      if (typeof value !== "string") {
        throw new AppError("VALIDATION_ERROR", `${field.name} must be text.`)
      }
      const maxLen = field.config.maxLength ?? textLengthLimit(field.type)
      if (maxLen !== undefined && value.length > maxLen) {
        throw new AppError(
          "VALIDATION_ERROR",
          `${field.name} must be at most ${maxLen.toLocaleString()} characters.`,
        )
      }
      if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        throw new AppError("VALIDATION_ERROR", `${field.name} must be a valid email address.`)
      }
      if (field.type === "url") {
        try {
          const parsed = new URL(value)
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            throw new Error("invalid protocol")
          }
        } catch {
          throw new AppError("VALIDATION_ERROR", `${field.name} must be a valid http(s) URL.`)
        }
      }
      return value
    }

    case "number":
    case "currency":
    case "percent": {
      const numeric = typeof value === "number" ? value : Number(value)
      if (!Number.isFinite(numeric)) {
        throw new AppError("VALIDATION_ERROR", `${field.name} must be a valid number.`)
      }
      if (field.config.min !== undefined && numeric < field.config.min) {
        throw new AppError(
          "VALIDATION_ERROR",
          `${field.name} must be at least ${field.config.min}.`,
        )
      }
      if (field.config.max !== undefined && numeric > field.config.max) {
        throw new AppError(
          "VALIDATION_ERROR",
          `${field.name} must be at most ${field.config.max}.`,
        )
      }
      return numeric
    }

    case "rating": {
      const numeric = typeof value === "number" ? value : Number(value)
      const maxRating = field.config.maxRating ?? 5
      if (!Number.isInteger(numeric) || numeric < 0 || numeric > maxRating) {
        throw new AppError(
          "VALIDATION_ERROR",
          `${field.name} must be a whole number from 0 to ${maxRating}.`,
        )
      }
      return numeric
    }

    case "checkbox": {
      if (typeof value !== "boolean") {
        throw new AppError("VALIDATION_ERROR", `${field.name} must be true or false.`)
      }
      return value
    }

    case "date": {
      if (typeof value === "number") {
        if (!Number.isFinite(value)) {
          throw new AppError("VALIDATION_ERROR", `${field.name} must be a valid date.`)
        }
        return value
      }
      if (typeof value !== "string") {
        throw new AppError("VALIDATION_ERROR", `${field.name} must be a date string or timestamp.`)
      }
      const parsed = Date.parse(value)
      if (Number.isNaN(parsed)) {
        throw new AppError("VALIDATION_ERROR", `${field.name} must be a valid date.`)
      }
      return value
    }

    case "singleSelect": {
      if (typeof value !== "string") {
        throw new AppError("VALIDATION_ERROR", `${field.name} must be a choice ID.`)
      }
      const allowed = new Set((field.config.options ?? []).map((opt) => opt.id))
      if (allowed.size > 0 && !allowed.has(value)) {
        throw new AppError("VALIDATION_ERROR", `${field.name} contains an unknown choice.`)
      }
      return value
    }

    case "multiSelect": {
      if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
        throw new AppError("VALIDATION_ERROR", `${field.name} must be an array of choice IDs.`)
      }
      const allowed = new Set((field.config.options ?? []).map((opt) => opt.id))
      if (allowed.size > 0 && value.some((item) => !allowed.has(item))) {
        throw new AppError("VALIDATION_ERROR", `${field.name} contains an unknown choice.`)
      }
      return value
    }

    case "attachment":
    case "image": {
      if (!Array.isArray(value) || !value.every(isAttachmentValue)) {
        throw new AppError("VALIDATION_ERROR", `${field.name} must be a list of attachments.`)
      }
      if (field.type === "image" && value.length > 1) {
        throw new AppError("VALIDATION_ERROR", `${field.name} accepts at most 1 image.`)
      }
      const requireImage =
        field.type === "image" || field.config.attachmentKind === "image"
      if (
        requireImage &&
        value.some((item) => !item.mimeType.toLowerCase().startsWith("image/"))
      ) {
        throw new AppError("VALIDATION_ERROR", `${field.name} only accepts image files.`)
      }
      return value
    }
  }
}

export function validateRecordValues(
  values: Record<string, unknown>,
  fields: readonly Pick<FieldDefinition, "id" | "name" | "type" | "config">[],
  options?: { allowReadOnly?: boolean },
): Record<string, CellValue> {
  const fieldsById = new Map(fields.map((field) => [field.id, field]))
  const validated: Record<string, CellValue> = {}

  for (const [fieldId, rawValue] of Object.entries(values)) {
    const field = fieldsById.get(fieldId)
    if (!field) continue
    validated[fieldId] = validateCellValue(field, rawValue, options)
  }

  const serializedSize = JSON.stringify(validated).length
  if (serializedSize > MAX_RECORD_VALUE_BYTES) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Record payload exceeds the ${MAX_RECORD_VALUE_BYTES.toLocaleString()} byte limit.`,
    )
  }

  return validated
}
