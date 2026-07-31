import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
  requireOrgIdentity,
  type OrgIdentity,
} from "./lib/auth";

const resourceTypeValidator = v.union(
  v.literal("base"),
  v.literal("table"),
  v.literal("form"),
);

const resourcePreferenceResultValidator = v.object({
  resourceType: resourceTypeValidator,
  resourceId: v.string(),
  name: v.string(),
  context: v.string(),
  href: v.string(),
  isFavorite: v.boolean(),
  lastOpenedAt: v.union(v.number(), v.null()),
});

const navigationPreferencesValidator = v.object({
  favorites: v.array(resourcePreferenceResultValidator),
  recent: v.array(resourcePreferenceResultValidator),
});

const MAX_NAVIGATION_PREFERENCES = 12;
const MAX_PREFERENCE_SCAN = 48;

type ReadCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;
type ResourceType = "base" | "table" | "form";
type ResourcePreference = Doc<"resourcePreferences">;
type ResolvedResource = {
  resourceType: ResourceType;
  resourceId: string;
  baseId: string;
  name: string;
  context: string;
  href: string;
};

function preferenceUserIdentityKey(identity: OrgIdentity): string {
  return identity.raw.tokenIdentifier;
}

function unavailableResource(): never {
  throw new ConvexError({
    code: "RESOURCE_NOT_AVAILABLE",
    message: "That workspace item is no longer available.",
  });
}

async function requireActiveBase(
  ctx: ReadCtx,
  identity: OrgIdentity,
  baseId: Id<"bases">,
) {
  const base = await ctx.db.get(baseId);
  if (
    !base ||
    base.orgId !== identity.orgId ||
    base.status !== "active"
  ) {
    unavailableResource();
  }
  return base;
}

async function resolveResource(
  ctx: ReadCtx,
  identity: OrgIdentity,
  resourceType: ResourceType,
  resourceId: string,
): Promise<ResolvedResource> {
  if (resourceType === "base") {
    const base = await requireActiveBase(
      ctx,
      identity,
      resourceId as Id<"bases">,
    );
    return {
      resourceType,
      resourceId: base._id,
      baseId: base._id,
      name: base.name,
      context: "Base",
      href: `/bases/${base._id}`,
    };
  }

  if (resourceType === "table") {
    const table = await ctx.db.get(resourceId as Id<"tables">);
    if (
      !table ||
      table.orgId !== identity.orgId ||
      table.status !== "active"
    ) {
      unavailableResource();
    }
    const base = await requireActiveBase(ctx, identity, table.baseId);
    return {
      resourceType,
      resourceId: table._id,
      baseId: base._id,
      name: table.name,
      context: base.name,
      href: `/bases/${base._id}/tables/${table._id}`,
    };
  }

  const form = await ctx.db.get(resourceId as Id<"forms">);
  if (
    !form ||
    form.orgId !== identity.orgId ||
    form.status === "deleted"
  ) {
    unavailableResource();
  }
  const [base, table] = await Promise.all([
    requireActiveBase(ctx, identity, form.baseId),
    ctx.db.get(form.tableId),
  ]);
  if (
    !table ||
    table.orgId !== identity.orgId ||
    table.status !== "active" ||
    table.baseId !== base._id
  ) {
    unavailableResource();
  }
  return {
    resourceType,
    resourceId: form._id,
    baseId: base._id,
    name: form.name,
    context: `${base.name} · Form`,
    href: `/bases/${base._id}/forms/${form._id}`,
  };
}

async function findPreference(
  ctx: ReadCtx,
  identity: OrgIdentity,
  resourceType: ResourceType,
  resourceId: string,
) {
  return await ctx.db
    .query("resourcePreferences")
    .withIndex("by_org_user_resource", (q) =>
      q
        .eq("orgId", identity.orgId)
        .eq(
          "userIdentityKey",
          preferenceUserIdentityKey(identity),
        )
        .eq("resourceType", resourceType)
        .eq("resourceId", resourceId),
    )
    .unique();
}

async function recordOpened(
  ctx: MutationCtx,
  identity: OrgIdentity,
  resource: ResolvedResource,
  lastOpenedAt: number,
) {
  const existing = await findPreference(
    ctx,
    identity,
    resource.resourceType,
    resource.resourceId,
  );
  if (existing) {
    await ctx.db.patch(existing._id, {
      lastOpenedAt,
      updatedAt: lastOpenedAt,
    });
    return;
  }
  await ctx.db.insert("resourcePreferences", {
    orgId: identity.orgId,
    userIdentityKey: preferenceUserIdentityKey(identity),
    resourceType: resource.resourceType,
    resourceId: resource.resourceId,
    isFavorite: false,
    lastOpenedAt,
    updatedAt: lastOpenedAt,
  });
}

function toResult(
  resource: ResolvedResource,
  preference: ResourcePreference,
) {
  return toPreferenceResult(
    resource,
    preference.isFavorite,
    preference.lastOpenedAt,
  );
}

function toPreferenceResult(
  resource: ResolvedResource,
  isFavorite: boolean,
  lastOpenedAt: number | null,
) {
  return {
    resourceType: resource.resourceType,
    resourceId: resource.resourceId,
    name: resource.name,
    context: resource.context,
    href: resource.href,
    isFavorite,
    lastOpenedAt,
  };
}

async function hydratePreferences(
  ctx: QueryCtx,
  identity: OrgIdentity,
  preferences: ResourcePreference[],
  limit: number,
) {
  const results = [];
  for (const preference of preferences) {
    if (results.length >= limit) break;
    try {
      const resource = await resolveResource(
        ctx,
        identity,
        preference.resourceType,
        preference.resourceId,
      );
      results.push(toResult(resource, preference));
    } catch (error) {
      if (
        error instanceof ConvexError &&
        error.data &&
        typeof error.data === "object" &&
        "code" in error.data &&
        error.data.code === "RESOURCE_NOT_AVAILABLE"
      ) {
        continue;
      }
      throw error;
    }
  }
  return results;
}

export const listNavigation = query({
  args: {
    favoriteLimit: v.optional(v.number()),
    recentLimit: v.optional(v.number()),
  },
  returns: navigationPreferencesValidator,
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    const favoriteLimit = args.favoriteLimit ?? 6;
    const recentLimit = args.recentLimit ?? 8;
    if (
      !Number.isInteger(favoriteLimit) ||
      favoriteLimit < 1 ||
      favoriteLimit > MAX_NAVIGATION_PREFERENCES ||
      !Number.isInteger(recentLimit) ||
      recentLimit < 1 ||
      recentLimit > MAX_NAVIGATION_PREFERENCES
    ) {
      throw new ConvexError({ code: "INVALID_PREFERENCE_LIMIT" });
    }
    const userIdentityKey = preferenceUserIdentityKey(identity);
    const [favoritePreferences, recentPreferences] = await Promise.all([
      ctx.db
        .query("resourcePreferences")
        .withIndex("by_org_user_favorite_updated", (q) =>
          q
            .eq("orgId", identity.orgId)
            .eq("userIdentityKey", userIdentityKey)
            .eq("isFavorite", true),
        )
        .order("desc")
        .take(MAX_PREFERENCE_SCAN),
      ctx.db
        .query("resourcePreferences")
        .withIndex("by_org_user_last_opened", (q) =>
          q
            .eq("orgId", identity.orgId)
            .eq("userIdentityKey", userIdentityKey),
        )
        .order("desc")
        .take(MAX_PREFERENCE_SCAN),
    ]);

    return {
      favorites: await hydratePreferences(
        ctx,
        identity,
        favoritePreferences,
        favoriteLimit,
      ),
      recent: await hydratePreferences(
        ctx,
        identity,
        recentPreferences.filter(
          (preference) => preference.lastOpenedAt !== null,
        ),
        recentLimit,
      ),
    };
  },
});

export const trackRouteOpen = mutation({
  args: {
    baseId: v.id("bases"),
    tableId: v.optional(v.id("tables")),
    formId: v.optional(v.id("forms")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    if (args.tableId && args.formId) {
      throw new ConvexError({ code: "INVALID_RESOURCE_ROUTE" });
    }
    const base = await resolveResource(
      ctx,
      identity,
      "base",
      args.baseId,
    );
    const child = args.tableId
      ? await resolveResource(ctx, identity, "table", args.tableId)
      : args.formId
        ? await resolveResource(ctx, identity, "form", args.formId)
        : undefined;
    if (child && child.baseId !== base.baseId) unavailableResource();

    const latest = await ctx.db
      .query("resourcePreferences")
      .withIndex("by_org_user_last_opened", (q) =>
        q
          .eq("orgId", identity.orgId)
          .eq(
            "userIdentityKey",
            preferenceUserIdentityKey(identity),
          ),
      )
      .order("desc")
      .first();
    let lastOpenedAt = Math.max(
      Date.now(),
      (latest?.lastOpenedAt ?? 0) + 1,
    );
    await recordOpened(ctx, identity, base, lastOpenedAt);
    if (child) {
      lastOpenedAt += 1;
      await recordOpened(ctx, identity, child, lastOpenedAt);
    }
    return null;
  },
});

export const setFavorite = mutation({
  args: {
    resourceType: resourceTypeValidator,
    resourceId: v.string(),
    favorite: v.boolean(),
  },
  returns: resourcePreferenceResultValidator,
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    const resource = await resolveResource(
      ctx,
      identity,
      args.resourceType,
      args.resourceId,
    );
    const existing = await findPreference(
      ctx,
      identity,
      args.resourceType,
      args.resourceId,
    );

    if (!args.favorite && !existing) {
      return toPreferenceResult(resource, false, null);
    }
    if (!args.favorite && existing?.lastOpenedAt === null) {
      await ctx.db.delete(existing._id);
      return toPreferenceResult(resource, false, null);
    }

    const updatedAt = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        isFavorite: args.favorite,
        updatedAt,
      });
      return toPreferenceResult(
        resource,
        args.favorite,
        existing.lastOpenedAt,
      );
    }

    const preferenceId = await ctx.db.insert("resourcePreferences", {
      orgId: identity.orgId,
      userIdentityKey: preferenceUserIdentityKey(identity),
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      isFavorite: true,
      lastOpenedAt: null,
      updatedAt,
    });
    const preference = (await ctx.db.get(preferenceId))!;
    return toResult(resource, preference);
  },
});
