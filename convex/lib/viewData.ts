import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { ConvexError } from "convex/values";
import { generateKeyBetween } from "jittered-fractional-indexing";

import { createRank, requireField, requireTable } from "./data";

type ReadCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;
type WriteCtx = Pick<MutationCtx, "db">;

export const DEFAULT_VIEW_NAME = "Grid view";

export async function requireView(
  ctx: ReadCtx,
  orgId: string,
  viewId: Id<"views">,
  allowArchived = false,
) {
  const view = await ctx.db.get(viewId);
  if (
    !view ||
    view.orgId !== orgId ||
    view.status === "deleted" ||
    (!allowArchived && view.status !== "active")
  ) {
    throw new ConvexError({ code: "VIEW_NOT_FOUND" });
  }
  await requireTable(ctx, orgId, view.tableId);
  return view;
}

export async function ensureViewFieldConfigs(
  ctx: WriteCtx,
  view: Doc<"views">,
) {
  const [fields, existingConfigs] = await Promise.all([
    ctx.db
      .query("fields")
      .withIndex("by_table_and_status_and_rank", (q) =>
        q.eq("tableId", view.tableId).eq("status", "active"),
      )
      .take(500),
    ctx.db
      .query("viewFieldConfigs")
      .withIndex("by_view_and_rank", (q) => q.eq("viewId", view._id))
      .take(500),
  ]);
  const configuredFieldIds = new Set(
    existingConfigs.map((config) => config.fieldId),
  );
  const now = Date.now();
  for (const field of fields) {
    if (configuredFieldIds.has(field._id)) continue;
    await ctx.db.insert("viewFieldConfigs", {
      orgId: view.orgId,
      baseId: view.baseId,
      tableId: view.tableId,
      viewId: view._id,
      fieldId: field._id,
      rank: field.rank,
      width: field.width,
      hidden: false,
      frozen: field.isPrimary,
      formatting: {},
      updatedAt: now,
    });
  }
}

export async function createDefaultViewForTable(
  ctx: WriteCtx,
  args: {
    table: Doc<"tables">;
    createdByUserId: string;
  },
) {
  const existingViews = await ctx.db
    .query("views")
    .withIndex("by_table_and_status_and_rank", (q) =>
      q.eq("tableId", args.table._id).eq("status", "active"),
    )
    .take(100);
  const existingDefault = existingViews.find((view) => view.isDefault);
  if (existingDefault) {
    if (args.table.defaultViewId !== existingDefault._id) {
      await ctx.db.patch(args.table._id, {
        defaultViewId: existingDefault._id,
        updatedAt: Date.now(),
      });
    }
    await ensureViewFieldConfigs(ctx, existingDefault);
    return existingDefault._id;
  }

  const now = Date.now();
  const viewId = await ctx.db.insert("views", {
    orgId: args.table.orgId,
    baseId: args.table.baseId,
    tableId: args.table._id,
    name: DEFAULT_VIEW_NAME,
    type: "grid",
    rank: createRank(),
    status: "active",
    visibility: "collaborators",
    isDefault: true,
    filterConjunction: "and",
    filters: [],
    sorts: [],
    groups: [],
    configuration: { rowHeight: "medium" },
    revision: 1,
    createdByUserId: args.createdByUserId,
    updatedAt: now,
  });
  await ctx.db.patch(args.table._id, {
    defaultViewId: viewId,
    updatedAt: now,
  });
  const view = await ctx.db.get(viewId);
  await ensureViewFieldConfigs(ctx, view!);
  return viewId;
}

export async function addFieldToActiveViews(
  ctx: WriteCtx,
  field: Doc<"fields">,
  afterFieldId?: Id<"fields">,
) {
  const views = await ctx.db
    .query("views")
    .withIndex("by_table_and_status_and_rank", (q) =>
      q.eq("tableId", field.tableId).eq("status", "active"),
    )
    .take(100);
  const now = Date.now();
  for (const view of views) {
    const existing = await ctx.db
      .query("viewFieldConfigs")
      .withIndex("by_view_and_field", (q) =>
        q.eq("viewId", view._id).eq("fieldId", field._id),
      )
      .first();
    if (existing) continue;
    const configs = await ctx.db
      .query("viewFieldConfigs")
      .withIndex("by_view_and_rank", (q) => q.eq("viewId", view._id))
      .take(500);
    const afterIndex =
      afterFieldId === undefined
        ? -1
        : configs.findIndex(
            (config) => config.fieldId === afterFieldId,
          );
    const lowerRank =
      afterIndex >= 0
        ? configs[afterIndex]?.rank
        : configs.at(-1)?.rank;
    const upperRank =
      afterIndex >= 0 ? configs[afterIndex + 1]?.rank : undefined;
    const rank = generateKeyBetween(
      lowerRank ?? null,
      upperRank ?? null,
      {
        jitterBits: 48,
        getRandomBit: () => {
          const random = new Uint8Array(1);
          crypto.getRandomValues(random);
          return (random[0] & 1) === 1;
        },
      },
    );
    await ctx.db.insert("viewFieldConfigs", {
      orgId: field.orgId,
      baseId: field.baseId,
      tableId: field.tableId,
      viewId: view._id,
      fieldId: field._id,
      rank,
      width: field.width,
      hidden: false,
      frozen: field.isPrimary,
      formatting: {},
      updatedAt: now,
    });
  }
}

export async function requireViewField(
  ctx: ReadCtx,
  orgId: string,
  viewId: Id<"views">,
  fieldId: Id<"fields">,
) {
  const [view, field] = await Promise.all([
    requireView(ctx, orgId, viewId),
    requireField(ctx, orgId, fieldId),
  ]);
  if (view.tableId !== field.tableId) {
    throw new ConvexError({ code: "VIEW_FIELD_MISMATCH" });
  }
  return { view, field };
}
