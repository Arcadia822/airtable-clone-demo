import type { AttachmentValue, FieldDefinition } from "@/lib/domain"

export function buildRecordSearchText(
  values: Record<string, unknown>,
  fields: readonly Pick<FieldDefinition, "id" | "type" | "config">[],
  attachmentNamesById?: ReadonlyMap<string, string>,
): string {
  const parts: string[] = []

  for (const field of fields) {
    const value = values[field.id]
    if (value === null || value === undefined || value === "") continue

    if (field.type === "singleSelect" && typeof value === "string") {
      const option = (field.config.options ?? []).find((item) => item.id === value)
      parts.push(option?.label ?? value)
      continue
    }

    if (field.type === "multiSelect" && Array.isArray(value)) {
      const optionsById = new Map(
        (field.config.options ?? []).map((item) => [item.id, item.label]),
      )
      for (const item of value) {
        if (typeof item === "string") {
          parts.push(optionsById.get(item) ?? item)
        }
      }
      continue
    }

    if (field.type === "attachment" || field.type === "image") {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "object" && item !== null) {
            const att = item as Partial<AttachmentValue> & { attachmentId?: string }
            if (typeof att.name === "string" && att.name.trim()) {
              parts.push(att.name)
            } else if (
              typeof att.attachmentId === "string" &&
              attachmentNamesById?.has(att.attachmentId)
            ) {
              parts.push(attachmentNamesById.get(att.attachmentId)!)
            }
          }
        }
      }
      continue
    }

    if (field.type === "currency" && typeof value === "number") {
      const currency = field.config.currency ?? "USD"
      parts.push(String(value))
      try {
        parts.push(
          new Intl.NumberFormat("en-US", {
            style: "currency",
            currency,
            maximumFractionDigits: field.config.precision ?? 2,
          }).format(value),
        )
      } catch {
        parts.push(`${currency} ${value}`)
      }
      continue
    }

    if (field.type === "checkbox") {
      if (value === true) parts.push("true checked yes")
      continue
    }

    if (Array.isArray(value)) {
      parts.push(value.map(String).join(" "))
      continue
    }

    parts.push(String(value))
  }

  return parts
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}
