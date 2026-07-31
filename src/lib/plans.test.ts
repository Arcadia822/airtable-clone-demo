import { describe, expect, it } from "vitest"

import {
  FEATURE_SLUGS,
  MAX_ATTACHMENTS_PER_CELL,
  MAX_FILE_BYTES,
  PLAN_DEFINITIONS,
  planFromClaims,
} from "@/lib/plans"

describe("plan definitions", () => {
  it("keeps quotas strictly ordered from Free to Pro", () => {
    const free = PLAN_DEFINITIONS.free.limits
    const starter = PLAN_DEFINITIONS.starter.limits
    const pro = PLAN_DEFINITIONS.pro.limits

    expect(free.bases).toBeLessThan(starter.bases)
    expect(starter.bases).toBeLessThan(pro.bases)
    expect(free.records).toBeLessThan(starter.records)
    expect(starter.records).toBeLessThan(pro.records)
    expect(free.storageBytes).toBeLessThan(starter.storageBytes)
    expect(starter.storageBytes).toBeLessThan(pro.storageBytes)
  })

  it("gates AI to Pro while Starter includes analytics and branding", () => {
    expect(PLAN_DEFINITIONS.free.features).toEqual([])
    expect(PLAN_DEFINITIONS.starter.features).toEqual([
      FEATURE_SLUGS.analytics,
      FEATURE_SLUGS.customBranding,
    ])
    expect(PLAN_DEFINITIONS.pro.features).toContain(FEATURE_SLUGS.aiAssistant)
    expect(PLAN_DEFINITIONS.pro.limits.aiTurnsPerMonth).toBe(500)
  })

  it("uses the highest plan claim and defaults to Free", () => {
    expect(planFromClaims(undefined)).toBe("free")
    expect(planFromClaims(["starter"])).toBe("starter")
    expect(planFromClaims(["starter", "pro"])).toBe("pro")
  })

  it("locks attachment safety limits", () => {
    expect(MAX_FILE_BYTES).toBe(25 * 1024 * 1024)
    expect(MAX_ATTACHMENTS_PER_CELL).toBe(10)
  })
})
