import { describe, expect, it, vi } from "vitest"

import {
  clerkPlanSlugMatches,
  getActiveOrganizationPlan,
  guardOrganizationFeature,
  type ClerkHas,
} from "@/lib/clerk/entitlements"
import { FEATURE_SLUGS } from "@/lib/plans"

function clerkHas(
  plans: readonly string[] = [],
  features: readonly string[] = [],
): ClerkHas {
  return vi.fn((input: { plan?: string; feature?: string }) => {
    if (input.plan) return plans.includes(input.plan)
    if (input.feature) return features.includes(input.feature)
    return false
  }) as unknown as ClerkHas
}

describe("Clerk organization entitlements", () => {
  it("resolves the highest plan directly from Clerk has()", () => {
    expect(getActiveOrganizationPlan(clerkHas(["pro"]))).toBe("pro")
    expect(getActiveOrganizationPlan(clerkHas(["starter"]))).toBe("starter")
    expect(getActiveOrganizationPlan(clerkHas())).toBe("free")
  })

  it("matches the bare Clerk Billing plan slugs", () => {
    expect(clerkPlanSlugMatches("pro", "pro")).toBe(true)
    expect(clerkPlanSlugMatches("pro", "org:pro")).toBe(false)
    expect(clerkPlanSlugMatches("starter", "pro")).toBe(false)
  })

  it("fails closed when there is no organization or feature", () => {
    expect(
      guardOrganizationFeature(
        { orgId: null, has: clerkHas([], [FEATURE_SLUGS.aiAssistant]) },
        FEATURE_SLUGS.aiAssistant,
      ),
    ).toEqual({ allowed: false, reason: "organization_required" })

    expect(
      guardOrganizationFeature(
        { orgId: "org_123", has: clerkHas() },
        FEATURE_SLUGS.aiAssistant,
      ),
    ).toEqual({ allowed: false, reason: "upgrade_required" })
  })

  it("allows features granted to the active organization", () => {
    expect(
      guardOrganizationFeature(
        {
          orgId: "org_123",
          has: clerkHas([], [FEATURE_SLUGS.analytics]),
        },
        FEATURE_SLUGS.analytics,
      ),
    ).toEqual({ allowed: true })
  })
})
