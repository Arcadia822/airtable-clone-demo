import { describe, expect, it } from "vitest"

import {
  summarizeFormPublication,
  type FormPublishSnapshot,
} from "@/lib/form-publish-summary"

const live: FormPublishSnapshot = {
  title: "Campaign intake",
  description: "Tell us about the campaign.",
  appearance: {
    primaryColor: "#2563eb",
    backgroundColor: "#ffffff",
    submitLabel: "Submit",
    showPoweredBy: true,
    layout: "card",
  },
  thankYou: {
    title: "Thank you",
    message: "Response received.",
  },
  questions: [
    {
      identity: "internal_email_column",
      label: "Work email",
      required: true,
      mode: "visible",
    },
    {
      identity: "internal_source_column",
      label: "Campaign source",
      required: false,
      mode: "visible",
    },
  ],
}

describe("form publish summary", () => {
  it("describes first publication with question names", () => {
    const summary = summarizeFormPublication(live, null)

    expect(summary.firstPublication).toBe(true)
    expect(summary.addedQuestions).toEqual([
      "Work email",
      "Campaign source",
    ])
    expect(JSON.stringify(summary)).not.toContain("internal_")
  })

  it("reports named additions, edits, removals, order, and page changes", () => {
    const summary = summarizeFormPublication(
      {
        ...live,
        title: "Partner campaign intake",
        questions: [
          {
            identity: "internal_source_column",
            label: "How did you hear about us?",
            required: true,
            mode: "visible",
          },
          {
            identity: "internal_budget_column",
            label: "Campaign budget",
            required: false,
            mode: "visible",
          },
        ],
      },
      live,
    )

    expect(summary).toMatchObject({
      hasChanges: true,
      addedQuestions: ["Campaign budget"],
      removedQuestions: ["Work email"],
      updatedQuestions: ["How did you hear about us?"],
      reorderedQuestions: false,
      changedSections: ["Public heading and description"],
    })
    expect(JSON.stringify(summary)).not.toContain("internal_")
  })

  it("recognizes reordered questions and a matching live version", () => {
    expect(
      summarizeFormPublication(
        { ...live, questions: [...live.questions].reverse() },
        live,
      ).reorderedQuestions,
    ).toBe(true)
    expect(summarizeFormPublication(live, live).hasChanges).toBe(false)
  })

  it("recognizes a layout or uploaded image change as a named design change", () => {
    const summary = summarizeFormPublication(
      {
        ...live,
        appearance: {
          ...live.appearance,
          layout: "plain",
          logoFingerprint: "new-logo-content",
        },
      },
      live,
    )

    expect(summary.changedSections).toEqual(["Form design"])
    expect(JSON.stringify(summary)).not.toContain("storage")
  })
})
