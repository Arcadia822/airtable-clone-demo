import { describe, expect, it } from "vitest"

import {
  hexContrastRatio,
  readableForegroundColor,
} from "@/lib/color-contrast"

describe("readableForegroundColor", () => {
  it.each([
    ["#ffffff", "#000000"],
    ["#fef08a", "#000000"],
    ["#777777", "#000000"],
    ["#1d4ed8", "#ffffff"],
    ["#000", "#ffffff"],
    ["  #FFF  ", "#000000"],
  ])("chooses the highest-contrast foreground for %s", (background, expected) => {
    expect(readableForegroundColor(background)).toBe(expected)
  })

  it("always produces WCAG AA contrast for valid opaque hex accents", () => {
    for (const background of [
      "#000000",
      "#2563eb",
      "#6d5dfc",
      "#777777",
      "#22c55e",
      "#fef08a",
      "#ffffff",
    ]) {
      const foreground = readableForegroundColor(background)
      expect(hexContrastRatio(background, foreground)).toBeGreaterThanOrEqual(
        4.5,
      )
    }
  })

  it("falls back to white for invalid or transient color input", () => {
    expect(readableForegroundColor("not-a-color")).toBe("#ffffff")
    expect(hexContrastRatio("#fff", "not-a-color")).toBeUndefined()
  })
})
