import { describe, expect, it } from "vitest"

import { compareRanks } from "@/lib/rank"

describe("compareRanks", () => {
  it("uses ordinal ordering for fractional index keys", () => {
    const items = [
      { rank: "aZ" },
      { rank: "aa" },
      { rank: "aA" },
      { rank: "a0" },
    ]
    expect(items.sort(compareRanks).map((item) => item.rank)).toEqual([
      "a0",
      "aA",
      "aZ",
      "aa",
    ])
  })
})
