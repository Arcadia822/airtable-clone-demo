import { describe, expect, it } from "vitest"

import { publicErrorMessage } from "@/lib/public-errors"

describe("publicErrorMessage", () => {
  it("maps typed errors to customer-friendly recovery copy", () => {
    expect(
      publicErrorMessage({
        code: "REVISION_CONFLICT",
        message: "record rec_123 expectedVersion 9",
      }),
    ).toContain("Someone else updated")
  })

  it("recognizes common authentication and connection failures", () => {
    expect(publicErrorMessage(new Error("Unauthenticated"))).toContain(
      "Sign in again",
    )
    expect(publicErrorMessage(new Error("TypeError: Failed to fetch"))).toContain(
      "Check your connection",
    )
  })

  it("never echoes internal exception details", () => {
    const message = publicErrorMessage(
      new Error(
        "Mutation fields:update failed for fieldId jx7_abc NEXT_PUBLIC_SECRET",
      ),
    )

    expect(message).not.toMatch(/fieldId|jx7_abc|NEXT_PUBLIC|Mutation/)
  })

  it("turns column conversion failures into actionable customer copy", () => {
    expect(
      publicErrorMessage({
        code: "FIELD_CONVERSION_PREVIEW_STALE",
        message: "previewVersion 2c30 does not match revision 8",
      }),
    ).toContain("Open the preview again")
    expect(
      publicErrorMessage({
        code: "FIELD_CONVERSION_REQUIRES_ACKNOWLEDGEMENT",
      }),
    ).toContain("saved values")
  })

  it("keeps saved-view refresh details customer friendly", () => {
    expect(
      publicErrorMessage({
        code: "VIEW_RESULTS_UPDATING",
        message: "materialization mat_internal_alpha is behind revision 23",
      }),
    ).toBe("This saved view is updating. It will be ready in a moment.")
  })
})
