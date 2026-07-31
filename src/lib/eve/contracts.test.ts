import { describe, expect, it } from "vitest";

import {
  deleteFieldInputSchema,
  deleteRecordInputSchema,
  fieldTypeSchema,
  recordSnapshotSchema,
  updateFormSettingsInputSchema,
  updateRecordInputSchema,
} from "./contracts";
import { assertSafeToolInput, sanitizeAgentResult } from "./security";

const recordChange = {
  baseId: "base_1",
  tableId: "table_1",
  recordId: "record_1",
  changes: [
    {
      fieldId: "field_1",
      fieldName: "Name",
      before: "Before",
      after: "After",
    },
  ],
};

describe("EVE record concurrency contracts", () => {
  it("requires an expected version for every update proposal", () => {
    expect(updateRecordInputSchema.safeParse(recordChange).success).toBe(false);
    expect(
      updateRecordInputSchema.safeParse({
        ...recordChange,
        expectedVersion: 4,
      }).success,
    ).toBe(true);
  });

  it("requires an expected version for every delete proposal", () => {
    const proposal = {
      baseId: "base_1",
      tableId: "table_1",
      recordId: "record_1",
      expectedPrimaryValue: "Ada",
      deletionSummary: ["Deletes the selected record."],
    };

    expect(deleteRecordInputSchema.safeParse(proposal).success).toBe(false);
    expect(
      deleteRecordInputSchema.safeParse({
        ...proposal,
        expectedVersion: 4,
      }).success,
    ).toBe(true);
  });

  it("requires the described field revision for a field deletion", () => {
    const proposal = {
      baseId: "base_1",
      tableId: "table_1",
      fieldId: "field_1",
      expectedName: "Status",
      expectedType: "singleSelect",
      dataLossSummary: "Deletes the status field and every stored value.",
    };

    expect(deleteFieldInputSchema.safeParse(proposal).success).toBe(false);
    expect(
      deleteFieldInputSchema.safeParse({
        ...proposal,
        expectedVersion: 3,
      }).success,
    ).toBe(true);
  });

  it("requires the inspected form revision for every settings proposal", () => {
    const proposal = {
      baseId: "base_1",
      formId: "form_1",
      changes: [
        {
          property: "title",
          before: "Before",
          after: "After",
        },
      ],
    };

    expect(updateFormSettingsInputSchema.safeParse(proposal).success).toBe(
      false,
    );
    expect(
      updateFormSettingsInputSchema.safeParse({
        ...proposal,
        expectedVersion: 5,
      }).success,
    ).toBe(true);
  });
});

describe("EVE field type contract", () => {
  it("matches the field types persisted by the application schema", () => {
    const implemented = [
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
    ];

    for (const type of implemented) {
      expect(fieldTypeSchema.safeParse(type).success).toBe(true);
    }
    for (const unsupported of ["dateTime", "formula"]) {
      expect(fieldTypeSchema.safeParse(unsupported).success).toBe(false);
    }
  });
});

describe("EVE attachment minimization", () => {
  it("accepts Convex creation timestamps with fractional milliseconds", () => {
    expect(
      recordSnapshotSchema.safeParse({
        id: "record_1",
        version: 2,
        createdAt: 1_785_430_524_000.125,
        updatedAt: 1_785_430_524_001.5,
        values: { field_name: "Ada" },
      }).success,
    ).toBe(true);
  });

  it("accepts counts but rejects attachment metadata on record reads", () => {
    const baseRecord = {
      id: "record_1",
      version: 2,
      values: { field_name: "Ada" },
    };

    expect(
      recordSnapshotSchema.safeParse({
        ...baseRecord,
        attachmentCounts: { field_files: 2 },
      }).success,
    ).toBe(true);
    expect(
      recordSnapshotSchema.safeParse({
        ...baseRecord,
        attachments: [
          {
            storageId: "storage_1",
            filename: "private.pdf",
            mediaType: "application/pdf",
            size: 120,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects internal attachment identifiers in tool inputs", () => {
    expect(() =>
      assertSafeToolInput({ storageId: "storage_1" }),
    ).toThrow(/internal attachment identifier/i);
    expect(() =>
      assertSafeToolInput({ attachmentIds: ["attachment_1"] }),
    ).toThrow(/attachmentIds/);
  });

  it("redacts internal attachment identifiers from defense-in-depth output", () => {
    expect(
      sanitizeAgentResult({
        attachmentId: "attachment_1",
        nested: { storageId: "storage_1" },
      }),
    ).toEqual({
      attachmentId: "[redacted attachment content]",
      nested: { storageId: "[redacted attachment content]" },
    });
  });
});
