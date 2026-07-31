import type { Doc } from "../../../convex/_generated/dataModel"

import type {
  AttachmentValue,
  CellValue,
  FieldConfig,
  FieldDefinition,
  GridRecord,
} from "@/lib/domain"

function toFieldConfig(field: Doc<"fields">): FieldConfig {
  return {
    maxLength: field.config.maxLength,
    min: field.config.min,
    max: field.config.max,
    precision: field.config.precision,
    currency: field.config.currency,
    dateStyle: field.config.dateStyle,
    includeTime: field.config.includeTime,
    attachmentKind: field.config.attachmentKind,
    options: field.config.options
      ?.filter((option) => !option.archived)
      .sort((left, right) => {
        const leftRank = left.rank ?? left.id
        const rightRank = right.rank ?? right.id
        return leftRank < rightRank ? -1 : leftRank > rightRank ? 1 : 0
      })
      .map((option) => ({
        id: option.id,
        label: option.label,
        color: option.color,
      })),
    archivedOptions: field.config.options
      ?.filter((option) => option.archived)
      .sort((left, right) => {
        const leftRank = left.rank ?? left.id
        const rightRank = right.rank ?? right.id
        return leftRank < rightRank ? -1 : leftRank > rightRank ? 1 : 0
      })
      .map((option) => ({
        id: option.id,
        label: option.label,
        color: option.color,
      })),
  }
}

export function toGridField(field: Doc<"fields">): FieldDefinition {
  return {
    id: field._id,
    name: field.name,
    type: field.type,
    config: toFieldConfig(field),
    rank: field.rank,
    width: field.width,
    isPrimary: field.isPrimary,
  }
}

export type AttachmentMetadata = {
  id: string
  name: string
  mimeType: string
  size: number
  url: string | null
}

function storedAttachments(
  value: unknown,
  metadataById: ReadonlyMap<string, AttachmentMetadata>,
): AttachmentValue[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === "string")
    .map((id) => {
      const metadata = metadataById.get(id)
      return metadata
        ? {
            id: metadata.id,
            name: metadata.name,
            mimeType: metadata.mimeType,
            size: metadata.size,
            url: metadata.url ?? undefined,
          }
        : {
            id,
            name: "Loading attachment…",
            mimeType: "application/octet-stream",
            size: 0,
          }
    })
}

function toCellValue(value: unknown): CellValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value
  }
  if (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string")
  ) {
    return value
  }
  return null
}

export function toGridRecord(
  record: Doc<"records">,
  fields: readonly Doc<"fields">[],
  attachmentMetadataById: ReadonlyMap<string, AttachmentMetadata> = new Map(),
): GridRecord {
  const values: Record<string, CellValue> = {}

  for (const field of fields) {
    if (field.type === "createdTime") {
      values[field._id] = record._creationTime
      continue
    }
    if (field.type === "createdBy") {
      values[field._id] = record.createdById
      continue
    }

    const value = record.values[field._id]
    values[field._id] =
      field.type === "attachment"
        ? storedAttachments(value, attachmentMetadataById)
        : toCellValue(value)
  }

  return {
    id: record._id,
    rank: record.rank,
    values,
    revision: record.revision,
    createdAt: record._creationTime,
    createdBy: record.createdById,
    updatedAt: record.updatedAt,
    updatedBy: record.updatedById,
  }
}

export function fieldConfigForMutation(
  config: FieldConfig,
  archivedOptions: ReadonlyArray<{
    id: string
    label: string
    color: string
    rank?: string
  }> = [],
) {
  const result: {
    maxLength?: number
    min?: number
    max?: number
    precision?: number
    currency?: string
    dateStyle?: "date" | "dateTime"
    includeTime?: boolean
    attachmentKind?: "image" | "file" | "any"
    options?: Array<{
      id: string
      label: string
      color: string
      rank: string
      archived?: boolean
    }>
  } = {}

  if (config.maxLength !== undefined) result.maxLength = config.maxLength
  if (config.min !== undefined) result.min = config.min
  if (config.max !== undefined) result.max = config.max
  if (config.precision !== undefined) result.precision = config.precision
  if (config.currency !== undefined) result.currency = config.currency
  if (config.dateStyle !== undefined) result.dateStyle = config.dateStyle
  if (config.includeTime !== undefined) result.includeTime = config.includeTime
  if (config.attachmentKind !== undefined) {
    result.attachmentKind = config.attachmentKind
  }
  if (config.options !== undefined) {
    result.options = [
      ...config.options.map((option, index) => ({
        ...option,
        rank: index.toString().padStart(4, "0"),
      })),
      ...archivedOptions.map((option, index) => ({
        id: option.id,
        label: option.label,
        color: option.color,
        rank:
          option.rank ??
          `archived-${index.toString().padStart(4, "0")}`,
        archived: true,
      })),
    ]
  }

  return result
}
