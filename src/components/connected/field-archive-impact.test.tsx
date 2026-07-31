import { render, screen } from "@testing-library/react"
import { expect, it } from "vitest"

import {
  FieldArchiveImpact,
  fieldArchiveDescription,
  fieldArchiveSuccessMessage,
} from "@/components/connected/field-archive-impact"

const savedViewDependency = {
  category: "Saved view" as const,
  name: "Launch readiness",
  effect:
    "The filter, sorting, and grouping in “Launch readiness” pause while “Target date” is archived and return when it is restored.",
}

it("explains named saved-view effects without exposing storage keys", () => {
  const { container } = render(
    <FieldArchiveImpact
      impact={{
        columnName: "Target date",
        canArchive: true,
        blockingReason: null,
        dependencies: [savedViewDependency],
      }}
    />,
  )

  expect(screen.getByText("Launch readiness")).toBeInTheDocument()
  expect(screen.getByText(savedViewDependency.effect)).toBeInTheDocument()
  expect(container).not.toHaveTextContent(
    /fieldId|viewId|internal|document key/i,
  )
})

it("uses explicit confirmation and result language", () => {
  expect(fieldArchiveDescription("Target date")).toContain(
    "filters, sorting, grouping, or layouts",
  )
  expect(
    fieldArchiveSuccessMessage("Target date", [savedViewDependency]),
  ).toContain(
    "Saved-view filters, sorting, grouping, and layouts",
  )
})
