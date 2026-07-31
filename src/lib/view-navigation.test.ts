import { describe, expect, it } from "vitest"

import { viewSelectionHref } from "@/lib/view-navigation"

describe("viewSelectionHref", () => {
  it("closes the create-view action while selecting the newly created view", () => {
    expect(
      viewSelectionHref({
        pathname: "/bases/example/tables/requests",
        searchParams: new URLSearchParams(
          "action=new-view&record=selected-request",
        ),
        viewId: "approved-requests",
      }),
    ).toBe(
      "/bases/example/tables/requests?record=selected-request&view=approved-requests",
    )
  })

  it("preserves unrelated URL actions when a user changes views", () => {
    expect(
      viewSelectionHref({
        pathname: "/bases/example/tables/requests",
        searchParams: new URLSearchParams("action=new-record"),
        viewId: "requests-by-stage",
      }),
    ).toBe(
      "/bases/example/tables/requests?action=new-record&view=requests-by-stage",
    )
  })
})
