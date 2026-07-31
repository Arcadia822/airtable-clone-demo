import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  RecordsPageFooter,
  type RecordLayout,
} from "@/components/connected/records-page-footer"

afterEach(cleanup)

describe.each([
  "kanban",
  "calendar",
  "gallery",
] satisfies RecordLayout[])("%s pagination", (layout) => {
  it("loads the next bounded page into the current view", () => {
    const onLoadMore = vi.fn()
    render(
      <RecordsPageFooter
        layout={layout}
        onLoadMore={onLoadMore}
        status="CanLoadMore"
      />,
    )

    fireEvent.click(
      screen.getByRole("button", {
        name: `Load 100 more records into the ${layout} view`,
      }),
    )
    expect(onLoadMore).toHaveBeenCalledTimes(1)
    expect(onLoadMore).toHaveBeenCalledWith(100)
  })

  it("announces that the next page is loading", () => {
    render(
      <RecordsPageFooter
        layout={layout}
        onLoadMore={vi.fn()}
        status="LoadingMore"
      />,
    )
    expect(
      screen.getByRole("status", {
        name: `Loading more records into the ${layout} view`,
      }),
    ).toHaveTextContent("Loading more records…")
  })
})

it("stays out of the way after the final page", () => {
  const { container } = render(
    <RecordsPageFooter
      layout="calendar"
      onLoadMore={vi.fn()}
      status="Exhausted"
    />,
  )
  expect(container).toBeEmptyDOMElement()
})
