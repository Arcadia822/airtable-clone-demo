import type { FieldType } from "@/lib/domain"

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  singleLineText: "Short text",
  longText: "Long text",
  number: "Number",
  currency: "Currency",
  percent: "Percentage",
  rating: "Rating",
  checkbox: "Checkbox",
  date: "Date",
  email: "Email address",
  phone: "Phone number",
  url: "Web link",
  singleSelect: "Single choice",
  multiSelect: "Multiple choice",
  attachment: "File or image",
  createdTime: "Created time",
  createdBy: "Created by",
}

export function getFieldTypeLabel(type: FieldType | undefined): string {
  return type ? FIELD_TYPE_LABELS[type] : "Unavailable column"
}
