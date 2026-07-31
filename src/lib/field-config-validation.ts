import type { FieldConfig, FieldType } from "@/lib/domain"

export const MAX_SAFE_NUMERIC_BOUND = Number.MAX_SAFE_INTEGER

const TEXT_LENGTH_LIMITS = {
  singleLineText: 10_000,
  longText: 100_000,
  email: 320,
  phone: 64,
  url: 2_048,
} as const satisfies Partial<Record<FieldType, number>>

export function textLengthLimit(type: FieldType): number | undefined {
  return TEXT_LENGTH_LIMITS[type as keyof typeof TEXT_LENGTH_LIMITS]
}

export function supportsNumericBounds(type: FieldType): boolean {
  return type === "number" || type === "currency" || type === "percent"
}

export function optionalNumberInput(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function fieldConfigIssue(
  type: FieldType,
  config: FieldConfig,
): string | null {
  const maximumTextLength = textLengthLimit(type)
  if (
    maximumTextLength !== undefined &&
    config.maxLength !== undefined &&
    (!Number.isInteger(config.maxLength) ||
      config.maxLength < 1 ||
      config.maxLength > maximumTextLength)
  ) {
    return `Maximum characters must be a whole number from 1 to ${maximumTextLength.toLocaleString()}.`
  }

  if (supportsNumericBounds(type)) {
    if (
      config.min !== undefined &&
      (!Number.isFinite(config.min) ||
        Math.abs(config.min) > MAX_SAFE_NUMERIC_BOUND)
    ) {
      return "Minimum must be within the supported number range."
    }
    if (
      config.max !== undefined &&
      (!Number.isFinite(config.max) ||
        Math.abs(config.max) > MAX_SAFE_NUMERIC_BOUND)
    ) {
      return "Maximum must be within the supported number range."
    }
    if (
      config.min !== undefined &&
      config.max !== undefined &&
      config.min > config.max
    ) {
      return "Minimum cannot be greater than maximum."
    }
  }

  if (
    config.precision !== undefined &&
    (!Number.isInteger(config.precision) ||
      config.precision < 0 ||
      config.precision > 12)
  ) {
    return "Decimal places must be a whole number from 0 to 12."
  }

  return null
}
