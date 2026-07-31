import { describe, expect, it } from "vitest"

import { FIELD_TYPES } from "@/lib/domain"

describe("field types", () => {
  it("supports the v1 editable and computed field families", () => {
    expect(FIELD_TYPES).toEqual(
      expect.arrayContaining([
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
      ]),
    )
  })
})
