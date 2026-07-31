import { describe, expect, it } from "vitest"

import {
  friendlyAssistantError,
  presentAssistantError,
  presentAssistantTool,
  sanitizeAssistantText,
} from "./tool-presentation"

describe("assistant tool presentation", () => {
  it("turns record proposals into a readable change list without exposing IDs", () => {
    const presentation = presentAssistantTool(
      "update_record",
      {
        baseId: "base_123",
        tableId: "table_123",
        recordId: "record_123",
        expectedVersion: 7,
        changes: [
          {
            fieldId: "field_123",
            fieldName: "Status",
            before: "Planned",
            after: "Shipped",
          },
        ],
      },
      {
        status: "applied",
        operationId: "operation_123",
        summary: "Updated one column on one record.",
        entityIds: { recordId: "record_123" },
      },
    )

    expect(presentation).toEqual({
      title: "Update a record",
      details: [
        { label: "Status before", value: "Planned" },
        { label: "Status after", value: "Shipped" },
      ],
      result: "Updated one column on one record.",
    })
    expect(JSON.stringify(presentation)).not.toMatch(
      /baseId|tableId|recordId|fieldId|expectedVersion|operationId|entityIds/,
    )
    expect(JSON.stringify(presentation)).not.toContain("_123")
  })

  it("uses customer-facing column type names", () => {
    expect(
      presentAssistantTool(
        "create_field",
        {
          field: {
            name: "Customer notes",
            type: "longText",
            config: { maxLength: 500 },
          },
          insertAfterFieldId: "field_123",
        },
        undefined,
      ),
    ).toMatchObject({
      title: "Add a column",
      details: [
        { label: "Before", value: "No new column" },
        { label: "After", value: "Customer notes · Long text" },
        { label: "Column", value: "Customer notes" },
        { label: "Type", value: "Long text" },
      ],
    })
  })

  it("summarizes analytics instead of printing the tool response", () => {
    const presentation = presentAssistantTool(
      "form_analytics",
      { formId: "form_123", days: 30 },
      {
        totals: {
          views: 200,
          starts: 120,
          submissions: 80,
          completionRate: 0.4,
        },
        series: [{ date: "2026-07-30", views: 10 }],
      },
    )

    expect(presentation.details).toEqual([
      { label: "Views", value: "200" },
      { label: "Started", value: "120" },
      { label: "Submitted", value: "80" },
      { label: "Completion", value: "40%" },
    ])
    expect(presentation.result).toBe("Workspace data reviewed.")
    expect(JSON.stringify(presentation)).not.toContain("form_123")
    expect(JSON.stringify(presentation)).not.toContain("series")
  })

  it("shows both sides when a form setting was previously unset", () => {
    const presentation = presentAssistantTool(
      "update_form_settings",
      {
        changes: [
          {
            property: "successMessage",
            before: undefined,
            after: "Thanks — we received your response.",
          },
        ],
      },
      undefined,
    )

    expect(presentation.details).toEqual([
      { label: "Thank-you message before", value: "Not set" },
      {
        label: "Thank-you message after",
        value: "Thanks — we received your response.",
      },
    ])
  })
})

describe("assistant display safety", () => {
  it("hides internal references and translates implementation-style types", () => {
    const visible = sanitizeAssistantText(
      'Use {"baseId": "base_123", "tableId": "table_123", "status": "applied", "entityIds": {"recordId": "record_123"}} with expectedVersion 7 and type singleLineText.',
    )

    expect(visible).not.toMatch(
      /baseId|tableId|recordId|entityIds|expectedVersion|base_123|table_123|record_123/,
    )
    expect(visible).not.toMatch(/"status":\s*"applied"/)
    expect(visible).not.toContain("singleLineText")
    expect(visible).toContain("short text")
  })

  it("redacts credentials, raw maps, and internal field-mapping names", () => {
    const visible = sanitizeAssistantText(
      [
        "targetFieldId=field_123 fieldMapping=private_map prefillParameter=customer",
        "requestId=request_123 slug=customer-intake",
        '```json\n{"fieldId":"field_123","fixedValue":"secret"}\n```',
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature_value",
        "900173c3-74a3-470e-af82-aa9e4e61958d",
      ].join("\n"),
    )

    expect(visible).not.toMatch(
      /targetFieldId|fieldMapping|prefillParameter|requestId|slug|field_123|private_map|customer-intake|fixedValue|eyJ|900173c3/,
    )
    expect(visible).toContain("Technical details hidden.")
  })

  it("never passes backend diagnostics through to customers", () => {
    const raw =
      "FatalError USER_ERROR operationId=operation_secret: database stack trace"

    expect(friendlyAssistantError(raw)).toBe(
      "The assistant could not complete that request. Try again.",
    )
    expect(friendlyAssistantError(raw)).not.toContain("operation_secret")
    expect(friendlyAssistantError("Server returned 431.")).toBe(
      "The assistant connection needs a clean refresh. Reload the page, then try your request again.",
    )
  })

  it("maps session, retry, timeout, and cancellation failures to recovery actions", () => {
    expect(presentAssistantError("ownership mismatch")).toMatchObject({
      action: "new-session",
    })
    expect(presentAssistantError("Server returned 431.")).toMatchObject({
      action: "reload",
    })
    expect(presentAssistantError("Max retries reached")).toMatchObject({
      action: "retry",
    })
    expect(presentAssistantError("Request cancelled")).toEqual({
      action: "retry",
      message: "The request was stopped. No changes were made. You can try again.",
    })
  })
})
