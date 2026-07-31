import type { UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";

import { normalizePlanTier, type PlanTier } from "./quotas";

type AuthContext = {
  auth: {
    getUserIdentity(): Promise<UserIdentity | null>;
  };
};

export type OrgIdentity = {
  orgId: string;
  userId: string;
  orgRole: string | null;
  plan: PlanTier;
  features: ReadonlySet<string>;
  raw: UserIdentity;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}

function claimEntries(value: unknown): string[] {
  const raw =
    Array.isArray(value) && value.every((item) => typeof item === "string")
      ? value
      : typeof value === "string"
        ? value.split(",")
        : [];
  return raw.map((entry) => entry.trim().toLowerCase()).filter(Boolean);
}

function parseOrganizationFeatures(value: unknown): Set<string> {
  const features = new Set<string>();
  for (const entry of claimEntries(value)) {
    if (entry.startsWith("o:") && entry.length > 2) {
      features.add(entry.slice(2));
    }
  }
  return features;
}

function parseOrganizationPlan(value: unknown): PlanTier {
  const organizationPlan = claimEntries(value).find((entry) =>
    entry.startsWith("o:"),
  );
  return organizationPlan
    ? normalizePlanTier(organizationPlan.slice(2))
    : "free";
}

export async function requireOrgIdentity(
  ctx: AuthContext,
): Promise<OrgIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({ code: "UNAUTHENTICATED" });
  }

  const claims = identity as UserIdentity & Record<string, unknown>;
  const orgClaim = asRecord(claims.o);
  const orgId = firstString(
    claims.org_id,
    claims.orgId,
    claims["o.id"],
    orgClaim?.id,
  );

  if (!orgId) {
    throw new ConvexError({
      code: "ACTIVE_ORGANIZATION_REQUIRED",
      message: "Select an active Clerk organization before using the app.",
    });
  }

  return {
    orgId,
    userId: identity.subject,
    orgRole: firstString(
      claims.org_role,
      claims.orgRole,
      claims["o.rol"],
      orgClaim?.rol,
    ),
    plan: parseOrganizationPlan(claims.pla),
    features: parseOrganizationFeatures(claims.fea),
    raw: identity,
  };
}

export function requireFeature(identity: OrgIdentity, feature: string): void {
  if (!identity.features.has(feature.toLowerCase())) {
    throw new ConvexError({
      code: "FEATURE_REQUIRED",
      feature,
    });
  }
}

export function requireOrgAdmin(identity: OrgIdentity): void {
  const role = identity.orgRole?.replace(/^org:/, "");
  if (role !== "admin") {
    throw new ConvexError({ code: "ORG_ADMIN_REQUIRED" });
  }
}
