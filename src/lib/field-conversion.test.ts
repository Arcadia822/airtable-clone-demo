import { describe, expect, it } from "vitest"

import type { FieldDefinition } from "@/lib/domain"
import {
  conversionConfigForTarget,
  fieldConversionApplyDisabled,
  fieldConversionConfigIssue,
  isConvertibleFieldType,
  type FieldConversionPreview,
} from "@/lib/field-conversion"

const source: FieldDefinition = {
  id: "field_internal",
  name: "Status",
  type: "singleSelect",
  config: {
    options: [
      { id: "choice_internal", label: "Ready", color: "#2563eb" },
    ],
  },
  rank: "a",
  width: 180,
  isPrimary: false,
}

const safePreview: FieldConversionPreview = {
  columnName: "Status",
  currentType: "Single choice",
  newType: "Short text",
  expectedFieldRevision: 4,
  previewVersion: "hidden-handshake",
  canApply: true,
  blockingReason: null,
  requiresDataLossAcknowledgement: false,
  counts: {
    reviewedRows: 2,
    filledCells: 1,
    keptAsIs: 0,
    changed: 1,
    cleared: 0,
    losingSomeInformation: 0,
  },
  examples: [],
  dependencies: [],
  warnings: [],
}

describe("field conversion helpers", () => {
  it("keeps named choices while changing between choice types", () => {
    expect(conversionConfigForTarget(source, "multiSelect")).toEqual({
      options: [
        { id: "choice_internal", label: "Ready", color: "#2563eb" },
      ],
    })
    expect(
      conversionConfigForTarget(
        { ...source, type: "singleLineText", config: {} },
        "singleSelect",
      ),
    ).toEqual({ options: [] })
  })

  it("uses whole-number rating settings and excludes file/computed types", () => {
    expect(conversionConfigForTarget(source, "rating")).toEqual({
      min: 1,
      max: 5,
      precision: 0,
    })
    expect(isConvertibleFieldType("rating")).toBe(true)
    expect(isConvertibleFieldType("attachment")).toBe(false)
    expect(isConvertibleFieldType("createdBy")).toBe(false)
  })

  it("requires the preview, permission to apply, and any loss acknowledgement", () => {
    expect(fieldConversionApplyDisabled(undefined, false, false)).toBe(true)
    expect(fieldConversionApplyDisabled(safePreview, false, false)).toBe(false)
    expect(
      fieldConversionApplyDisabled(
        {
          ...safePreview,
          requiresDataLossAcknowledgement: true,
        },
        false,
        false,
      ),
    ).toBe(true)
    expect(
      fieldConversionApplyDisabled(
        {
          ...safePreview,
          requiresDataLossAcknowledgement: true,
        },
        true,
        false,
      ),
    ).toBe(false)
    expect(
      fieldConversionApplyDisabled(
        { ...safePreview, canApply: false },
        true,
        false,
      ),
    ).toBe(true)
  })

  it("keeps choice conversion inputs name-based and preview-safe", () => {
    expect(fieldConversionConfigIssue("singleSelect", { options: [] })).toBe(
      "Add at least one named choice before reviewing this change.",
    )
    expect(
      fieldConversionConfigIssue("multiSelect", {
        options: [
          { id: "one", label: "Ready", color: "#2563eb" },
          { id: "two", label: " ready ", color: "#0d9488" },
        ],
      }),
    ).toBe("Use a different name for each choice.")
    expect(
      fieldConversionConfigIssue("singleSelect", {
        options: [
          { id: "one", label: "Ready", color: "#2563eb" },
          { id: "two", label: "Blocked", color: "#0d9488" },
        ],
      }),
    ).toBeNull()
  })
})
