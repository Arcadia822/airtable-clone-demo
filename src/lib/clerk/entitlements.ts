import type { SessionAuthObject } from "@clerk/backend"

import {
  FEATURE_SLUGS,
  type PlanSlug,
} from "@/lib/plans"

export type ClerkHas = SessionAuthObject["has"]
export type FeatureSlug = (typeof FEATURE_SLUGS)[keyof typeof FEATURE_SLUGS]

const CLERK_PLAN_SLUGS: Record<PlanSlug, readonly string[]> = {
  free: ["free"],
  starter: ["starter"],
  pro: ["pro"],
}

export type EntitlementGuardResult =
  | { allowed: true }
  | {
      allowed: false
      reason: "organization_required" | "upgrade_required"
    }

export function hasPlanEntitlement(has: ClerkHas, plan: PlanSlug) {
  return CLERK_PLAN_SLUGS[plan].some((slug) => has({ plan: slug }))
}

export function getActiveOrganizationPlan(has: ClerkHas): PlanSlug {
  if (hasPlanEntitlement(has, "pro")) return "pro"
  if (hasPlanEntitlement(has, "starter")) return "starter"
  return "free"
}

export function hasFeatureEntitlement(
  has: ClerkHas,
  feature: FeatureSlug,
) {
  return has({ feature })
}

export function guardOrganizationFeature(
  {
    orgId,
    has,
  }: {
    orgId: string | null | undefined
    has: ClerkHas
  },
  feature: FeatureSlug,
): EntitlementGuardResult {
  if (!orgId) {
    return { allowed: false, reason: "organization_required" }
  }

  if (!hasFeatureEntitlement(has, feature)) {
    return { allowed: false, reason: "upgrade_required" }
  }

  return { allowed: true }
}

export function clerkPlanSlugMatches(
  plan: PlanSlug,
  clerkPlanSlug: string,
) {
  return CLERK_PLAN_SLUGS[plan].includes(clerkPlanSlug)
}
