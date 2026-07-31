"use node";

import { createClerkClient } from "@clerk/backend";
import { ConvexError, v } from "convex/values";

import { internalAction } from "./_generated/server";
import { normalizePlanTier } from "./lib/quotas";
import { planTierValidator } from "./lib/validators";

async function resolveEntitlements(orgId: string) {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new ConvexError({ code: "BILLING_UNAVAILABLE" });
  }

  try {
    const clerk = createClerkClient({ secretKey });
    const subscription =
      await clerk.billing.getOrganizationBillingSubscription(orgId);
    const activeItem =
      subscription.subscriptionItems.find(
        (item) => item.status === "active" && item.plan,
      ) ??
      subscription.subscriptionItems.find(
        (item) => item.isFreeTrial && item.plan,
      ) ??
      subscription.subscriptionItems.find((item) => item.plan?.isDefault);
    return {
      plan: normalizePlanTier(activeItem?.plan?.slug),
      features: (activeItem?.plan?.features ?? []).map((feature) =>
        feature.slug.toLowerCase(),
      ),
    };
  } catch (error) {
    console.error(
      "Unable to resolve the Clerk organization subscription.",
      error instanceof Error ? error.message : "Unknown error",
    );
    throw new ConvexError({ code: "BILLING_UNAVAILABLE" });
  }
}

export const getCurrentOrganizationPlan = internalAction({
  args: { orgId: v.string() },
  returns: planTierValidator,
  handler: async (_ctx, args) => {
    return (await resolveEntitlements(args.orgId)).plan;
  },
});

export const getCurrentOrganizationEntitlements = internalAction({
  args: { orgId: v.string() },
  returns: v.object({
    plan: planTierValidator,
    features: v.array(v.string()),
  }),
  handler: async (_ctx, args) => {
    return await resolveEntitlements(args.orgId);
  },
});
