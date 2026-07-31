import { describe, expect, it } from "vitest"

import { parseAssistantAnalysis } from "./analysis-presentation"

describe("assistant analysis presentation", () => {
  it("separates facts, interpretation, and limitations into readable sections", () => {
    expect(
      parseAssistantAnalysis(`## Facts
Seven records were reviewed.

**Interpretation**
Delivery looks healthy.

Limitations:
Two records have no owner.`),
    ).toEqual([
      {
        body: "Seven records were reviewed.",
        kind: "facts",
        label: "Facts from workspace data",
      },
      {
        body: "Delivery looks healthy.",
        kind: "interpretation",
        label: "Interpretation",
      },
      {
        body: "Two records have no owner.",
        kind: "limitations",
        label: "Limitations",
      },
    ])
  })

  it("does not mislabel an unstructured response as workspace fact", () => {
    expect(
      parseAssistantAnalysis("Seven records look healthy."),
    ).toBeUndefined()
  })
})
