import { describe, expect, it } from "vitest"

import {
  fieldConfigIssue,
  MAX_SAFE_NUMERIC_BOUND,
  optionalNumberInput,
  textLengthLimit,
} from "@/lib/field-config-validation"

describe("field configuration validation", () => {
  it("uses the real friendly maximum for each text-like column", () => {
    expect(textLengthLimit("singleLineText")).toBe(10_000)
    expect(textLengthLimit("longText")).toBe(100_000)
    expect(textLengthLimit("email")).toBe(320)
    expect(textLengthLimit("phone")).toBe(64)
    expect(textLengthLimit("url")).toBe(2_048)
    expect(
      fieldConfigIssue("email", { maxLength: 321 }),
    ).toBe(
      "Maximum characters must be a whole number from 1 to 320.",
    )
    expect(fieldConfigIssue("email", { maxLength: 320 })).toBeNull()
  })

  it("keeps optional numeric boundaries ordered and safely bounded", () => {
    expect(
      fieldConfigIssue("number", { min: 20, max: 10 }),
    ).toBe("Minimum cannot be greater than maximum.")
    expect(
      fieldConfigIssue("currency", {
        min: -(MAX_SAFE_NUMERIC_BOUND + 1),
      }),
    ).toBe("Minimum must be within the supported number range.")
    expect(
      fieldConfigIssue("percent", { min: 0, max: 100 }),
    ).toBeNull()
  })

  it("turns blank number inputs into an omitted boundary", () => {
    expect(optionalNumberInput("")).toBeUndefined()
    expect(optionalNumberInput("  ")).toBeUndefined()
    expect(optionalNumberInput("-12.5")).toBe(-12.5)
  })
})
