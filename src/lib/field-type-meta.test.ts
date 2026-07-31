import { describe, expect, it } from "vitest"

import { FIELD_TYPES } from "@/lib/domain"
import {
  FIELD_TYPE_LABELS,
  getFieldTypeLabel,
} from "@/lib/field-type-meta"

describe("friendly field type labels", () => {
  it("covers every supported field type", () => {
    expect(Object.keys(FIELD_TYPE_LABELS)).toEqual(FIELD_TYPES)
  })

  it("never exposes implementation-style field type keys", () => {
    expect(getFieldTypeLabel("singleLineText")).toBe("Short text")
    expect(getFieldTypeLabel("multiSelect")).toBe("Multiple choice")
    expect(getFieldTypeLabel(undefined)).toBe("Unavailable column")
  })
})
