import { describe, expect, it } from "vitest"

import {
  createGridColumnLayout,
  getGridColumnWindow,
  scrollLeftForGridColumn,
} from "@/lib/grid-column-window"

describe("wide grid column window", () => {
  const layout = createGridColumnLayout(
    Array.from({ length: 50 }, (_, index) => ({
      frozen: index === 0,
      width: 140,
    })),
    64,
  )

  it("keeps the required column and a bounded nearby window", () => {
    const window = getGridColumnWindow(layout, 0, 800)

    expect(window.indexes).toContain(0)
    expect(window.indexes).toContain(1)
    expect(window.indexes).not.toContain(49)
    expect(window.indexes.length).toBeLessThan(12)
  })

  it("moves the window to the logical columns near the far edge", () => {
    const window = getGridColumnWindow(layout, 6_200, 800)

    expect(window.indexes).toContain(0)
    expect(window.indexes).toContain(49)
    expect(window.indexes).not.toContain(10)
    expect(window.indexes.length).toBeLessThan(12)
  })

  it("calculates scrolling around the frozen area without overshooting", () => {
    const farRight = scrollLeftForGridColumn(layout, 49, 0, 800, 48)
    const backNearStart = scrollLeftForGridColumn(
      layout,
      1,
      farRight,
      800,
      48,
    )

    expect(farRight).toBe(6_264)
    expect(backNearStart).toBe(0)
    expect(scrollLeftForGridColumn(layout, 0, farRight, 800, 48)).toBe(
      farRight,
    )
  })

  it("pins a required column without overlapping earlier movable columns", () => {
    const reorderedLayout = createGridColumnLayout(
      [
        { width: 120 },
        { frozen: true, width: 200 },
        { width: 150 },
      ],
      64,
    )

    expect(reorderedLayout.columns[1]).toMatchObject({
      frozenLeft: 64,
      start: 64,
    })
    expect(reorderedLayout.columns[0]).toMatchObject({ start: 264 })
    expect(reorderedLayout.columns[2]).toMatchObject({ start: 384 })
  })
})
