import { ConvexError, v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { fieldCount, tableCount } from "./lib/aggregates";
import { requireOrgAdmin, requireOrgIdentity } from "./lib/auth";
import { userActor, writeAudit } from "./lib/audit";
import { createRank, requireBase, requireTable } from "./lib/data";
import { assertBelowQuota, PLAN_LIMITS } from "./lib/quotas";
import { createDefaultViewForTable } from "./lib/viewData";

export const list = query({
  args: { baseId: v.id("bases") },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    await requireBase(ctx, identity.orgId, args.baseId);
    return await ctx.db
      .query("tables")
      .withIndex("by_base_and_status_and_rank", (q) =>
        q.eq("baseId", args.baseId).eq("status", "active"),
      )
      .take(PLAN_LIMITS.pro.tablesPerBase);
  },
});

export const create = mutation({
  args: {
    baseId: v.id("bases"),
    name: v.string(),
    afterRank: v.optional(v.string()),
  },
  returns: v.object({
    tableId: v.id("tables"),
    primaryFieldId: v.id("fields"),
  }),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    await requireBase(ctx, identity.orgId, args.baseId);
    const name = args.name.trim();
    if (!name || name.length > 120) {
      throw new ConvexError({ code: "INVALID_TABLE_NAME" });
    }

    const count = await tableCount.count(ctx, { namespace: args.baseId });
    assertBelowQuota(
      count,
      PLAN_LIMITS[identity.plan].tablesPerBase,
      "tables_per_base",
    );

    const now = Date.now();
    const tableId = await ctx.db.insert("tables", {
      orgId: identity.orgId,
      baseId: args.baseId,
      name,
      rank: createRank(args.afterRank),
      status: "active",
      createdByUserId: identity.userId,
      updatedAt: now,
    });
    const primaryFieldId = await ctx.db.insert("fields", {
      orgId: identity.orgId,
      baseId: args.baseId,
      tableId,
      name: "Name",
      type: "singleLineText",
      config: { maxLength: 10_000 },
      rank: createRank(),
      width: 240,
      isPrimary: true,
      status: "active",
      revision: 1,
      createdByUserId: identity.userId,
      updatedAt: now,
    });
    await ctx.db.patch(tableId, { primaryFieldId });

    const table = await ctx.db.get(tableId);
    const primaryField = await ctx.db.get(primaryFieldId);
    await tableCount.insert(ctx, table!);
    await fieldCount.insert(ctx, primaryField!);
    await createDefaultViewForTable(ctx, {
      table: table!,
      createdByUserId: identity.userId,
    });

    await writeAudit(ctx, {
      orgId: identity.orgId,
      actor: userActor(identity),
      action: "table.created",
      resourceType: "table",
      resourceId: tableId,
      baseId: args.baseId,
      tableId,
    });
    await writeAudit(ctx, {
      orgId: identity.orgId,
      actor: userActor(identity),
      action: "field.created",
      resourceType: "field",
      resourceId: primaryFieldId,
      baseId: args.baseId,
      tableId,
      revisionAfter: 1,
    });
    return { tableId, primaryFieldId };
  },
});

export const update = mutation({
  args: {
    tableId: v.id("tables"),
    name: v.optional(v.string()),
    rank: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const table = await requireTable(ctx, identity.orgId, args.tableId);
    const patch: { name?: string; rank?: string; updatedAt: number } = {
      updatedAt: Date.now(),
    };
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (!name || name.length > 120) {
        throw new ConvexError({ code: "INVALID_TABLE_NAME" });
      }
      patch.name = name;
    }
    if (args.rank !== undefined) patch.rank = args.rank;
    await ctx.db.patch(args.tableId, patch);
    await writeAudit(ctx, {
      orgId: identity.orgId,
      actor: userActor(identity),
      action: "table.updated",
      resourceType: "table",
      resourceId: args.tableId,
      baseId: table.baseId,
      tableId: args.tableId,
    });
    return null;
  },
});

export const remove = mutation({
  args: { tableId: v.id("tables") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const table = await requireTable(ctx, identity.orgId, args.tableId);
    const publishedForm = await ctx.db
      .query("forms")
      .withIndex("by_table_and_status", (q) =>
        q.eq("tableId", args.tableId).eq("status", "published"),
      )
      .first();
    if (publishedForm) {
      throw new ConvexError({
        code: "TABLE_HAS_PUBLISHED_FORMS",
        formId: publishedForm._id,
      });
    }
    await ctx.db.patch(args.tableId, {
      status: "deleted",
      deletedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await tableCount.delete(ctx, table);
    await writeAudit(ctx, {
      orgId: identity.orgId,
      actor: userActor(identity),
      action: "table.deleted",
      resourceType: "table",
      resourceId: args.tableId,
      baseId: table.baseId,
      tableId: args.tableId,
    });
    return null;
  },
});

export const restore = mutation({
  args: { tableId: v.id("tables") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const table = await requireTable(ctx, identity.orgId, args.tableId, true);
    await requireBase(ctx, identity.orgId, table.baseId);
    if (table.status === "active") return null;
    const count = await tableCount.count(ctx, { namespace: table.baseId });
    assertBelowQuota(
      count,
      PLAN_LIMITS[identity.plan].tablesPerBase,
      "tables_per_base",
    );
    await ctx.db.patch(args.tableId, {
      status: "active",
      deletedAt: undefined,
      updatedAt: Date.now(),
    });
    const restored = await ctx.db.get(args.tableId);
    await tableCount.insert(ctx, restored!);
    await createDefaultViewForTable(ctx, {
      table: restored!,
      createdByUserId: restored!.createdByUserId,
    });
    await writeAudit(ctx, {
      orgId: identity.orgId,
      actor: userActor(identity),
      action: "table.restored",
      resourceType: "table",
      resourceId: args.tableId,
      baseId: table.baseId,
      tableId: args.tableId,
    });
    return null;
  },
});
