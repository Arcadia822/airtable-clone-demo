import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import {
  baseCount,
  formCount,
  tableCount,
} from "./lib/aggregates";
import { requireOrgAdmin, requireOrgIdentity } from "./lib/auth";
import { userActor, writeAudit } from "./lib/audit";
import { createRank, requireBase } from "./lib/data";
import { assertBelowQuota, PLAN_LIMITS } from "./lib/quotas";

const dashboardBaseSummaryValidator = v.object({
  baseId: v.id("bases"),
  name: v.string(),
  description: v.union(v.string(), v.null()),
  color: v.union(v.string(), v.null()),
  rank: v.string(),
  tableCount: v.number(),
  formCount: v.number(),
  isFavorite: v.boolean(),
  lastOpenedAt: v.union(v.number(), v.null()),
  updatedAt: v.number(),
});

export const list = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    const identity = await requireOrgIdentity(ctx);
    return await ctx.db
      .query("bases")
      .withIndex("by_org_and_status_and_rank", (q) =>
        q.eq("orgId", identity.orgId).eq("status", "active"),
      )
      .take(PLAN_LIMITS.pro.bases);
  },
});

export const listDashboardSummaries = query({
  args: {},
  returns: v.array(dashboardBaseSummaryValidator),
  handler: async (ctx) => {
    const identity = await requireOrgIdentity(ctx);
    const bases = await ctx.db
      .query("bases")
      .withIndex("by_org_and_status_and_rank", (q) =>
        q.eq("orgId", identity.orgId).eq("status", "active"),
      )
      .take(PLAN_LIMITS.pro.bases);

    return await Promise.all(
      bases.map(async (base) => {
        const [tables, forms, preference] = await Promise.all([
          tableCount.count(ctx, { namespace: base._id }),
          formCount.count(ctx, { namespace: base._id }),
          ctx.db
            .query("resourcePreferences")
            .withIndex("by_org_user_resource", (q) =>
              q
                .eq("orgId", identity.orgId)
                .eq(
                  "userIdentityKey",
                  identity.raw.tokenIdentifier,
                )
                .eq("resourceType", "base")
                .eq("resourceId", base._id),
            )
            .unique(),
        ]);

        return {
          baseId: base._id,
          name: base.name,
          description: base.description ?? null,
          color: base.color ?? null,
          rank: base.rank,
          tableCount: tables,
          formCount: forms,
          isFavorite: preference?.isFavorite ?? false,
          lastOpenedAt: preference?.lastOpenedAt ?? null,
          updatedAt: base.updatedAt,
        };
      }),
    );
  },
});

export const get = query({
  args: { baseId: v.id("bases") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    return await requireBase(ctx, identity.orgId, args.baseId);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    afterRank: v.optional(v.string()),
  },
  returns: v.id("bases"),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const name = args.name.trim();
    if (!name || name.length > 120) {
      throw new Error("Base name must be between 1 and 120 characters.");
    }

    const count = await baseCount.count(ctx, { namespace: identity.orgId });
    assertBelowQuota(count, PLAN_LIMITS[identity.plan].bases, "bases");

    const baseId = await ctx.db.insert("bases", {
      orgId: identity.orgId,
      name,
      description: args.description?.trim() || undefined,
      color: args.color,
      rank: createRank(args.afterRank),
      status: "active",
      createdByUserId: identity.userId,
      updatedAt: Date.now(),
    });
    const base = await ctx.db.get(baseId);
    await baseCount.insert(ctx, base!);
    await writeAudit(ctx, {
      orgId: identity.orgId,
      actor: userActor(identity),
      action: "base.created",
      resourceType: "base",
      resourceId: baseId,
      baseId,
    });
    return baseId;
  },
});

export const update = mutation({
  args: {
    baseId: v.id("bases"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    rank: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    await requireBase(ctx, identity.orgId, args.baseId);
    const patch: {
      name?: string;
      description?: string;
      color?: string;
      rank?: string;
      updatedAt: number;
    } = { updatedAt: Date.now() };
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (!name || name.length > 120) {
        throw new Error("Base name must be between 1 and 120 characters.");
      }
      patch.name = name;
    }
    if (args.description !== undefined) {
      patch.description = args.description.trim();
    }
    if (args.color !== undefined) patch.color = args.color;
    if (args.rank !== undefined) patch.rank = args.rank;
    await ctx.db.patch(args.baseId, patch);
    await writeAudit(ctx, {
      orgId: identity.orgId,
      actor: userActor(identity),
      action: "base.updated",
      resourceType: "base",
      resourceId: args.baseId,
      baseId: args.baseId,
    });
    return null;
  },
});

export const remove = mutation({
  args: { baseId: v.id("bases") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const base = await requireBase(ctx, identity.orgId, args.baseId);
    await ctx.db.patch(args.baseId, {
      status: "deleted",
      deletedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await baseCount.delete(ctx, base);
    await writeAudit(ctx, {
      orgId: identity.orgId,
      actor: userActor(identity),
      action: "base.deleted",
      resourceType: "base",
      resourceId: args.baseId,
      baseId: args.baseId,
    });
    return null;
  },
});

export const restore = mutation({
  args: { baseId: v.id("bases") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const base = await requireBase(ctx, identity.orgId, args.baseId, true);
    if (base.status === "active") return null;
    const count = await baseCount.count(ctx, { namespace: identity.orgId });
    assertBelowQuota(count, PLAN_LIMITS[identity.plan].bases, "bases");
    await ctx.db.patch(args.baseId, {
      status: "active",
      deletedAt: undefined,
      updatedAt: Date.now(),
    });
    const restored = await ctx.db.get(args.baseId);
    await baseCount.insert(ctx, restored!);
    await writeAudit(ctx, {
      orgId: identity.orgId,
      actor: userActor(identity),
      action: "base.restored",
      resourceType: "base",
      resourceId: args.baseId,
      baseId: args.baseId,
    });
    return null;
  },
});
