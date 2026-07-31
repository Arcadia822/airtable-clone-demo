import { describe, expect, it } from "vitest"

import {
  createFormSubmissionsCsv,
  formSubmissionsCsvFileName,
} from "@/lib/form-submissions"

describe("form response CSV", () => {
  it("exports named questions and readable response details without IDs", () => {
    const csv = createFormSubmissionsCsv({
      formName: "Customer feedback",
      columns: ["How can we help?", "Priority"],
      rows: [
        {
          submittedAt: Date.UTC(2026, 6, 30, 12),
          version: 4,
          responseLabel: "Acme rollout",
          answers: ["Please call me", "High"],
        },
      ],
      truncated: false,
    })

    expect(csv).toContain(
      '"Submitted at","Created record","Form version","How can we help?","Priority"',
    )
    expect(csv).toContain('"Acme rollout","4","Please call me","High"')
    expect(csv).not.toMatch(/jx[0-9a-z]{8,}/)
  })

  it("neutralizes spreadsheet formulas and creates a friendly filename", () => {
    const csv = createFormSubmissionsCsv({
      formName: "  Product / Launch Requests ",
      columns: ["Notes"],
      rows: [
        {
          submittedAt: 0,
          version: 1,
          responseLabel: "=IMPORTXML(A1)",
          answers: ["  +SUM(1,2)"],
        },
      ],
      truncated: false,
    })

    expect(csv).toContain(`"'=IMPORTXML(A1)"`)
    expect(csv).toContain(`"'  +SUM(1,2)"`)
    expect(
      formSubmissionsCsvFileName({
        formName: "  Product / Launch Requests ",
      }),
    ).toBe("product-launch-requests-responses.csv")
  })
})
