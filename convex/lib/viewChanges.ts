import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

const MAX_CHANGED_RECORDS = 100;
const MAX_VIEWS_PER_TABLE = 100;

export async function invalidateTableViewMaterializations(
  ctx: MutationCtx,
  tableId: Id<"tables">,
) {
  const [active, building] = await Promise.all([
    ctx.db
      .query("viewMaterializations")
      .withIndex("by_table_and_status", (q) =>
        q.eq("tableId", tableId).eq("status", "active"),
      )
      .take(MAX_VIEWS_PER_TABLE),
    ctx.db
      .query("viewMaterializations")
      .withIndex("by_table_and_status", (q) =>
        q.eq("tableId", tableId).eq("status", "building"),
      )
      .take(MAX_VIEWS_PER_TABLE),
  ]);
  const now = Date.now();
  for (const materialization of [...active, ...building]) {
    await ctx.db.patch(materialization._id, {
      status: "retired",
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.viewMaterializations.cleanupRetired,
      { materializationId: materialization._id },
    );
  }
}

export async function retireViewMaterializations(
  ctx: MutationCtx,
  viewId: Id<"views">,
) {
  const [active, building] = await Promise.all([
    ctx.db
      .query("viewMaterializations")
      .withIndex("by_view_and_status", (q) =>
        q.eq("viewId", viewId).eq("status", "active"),
      )
      .first(),
    ctx.db
      .query("viewMaterializations")
      .withIndex("by_view_and_status", (q) =>
        q.eq("viewId", viewId).eq("status", "building"),
      )
      .first(),
  ]);
  const now = Date.now();
  for (const materialization of [active, building]) {
    if (!materialization) continue;
    await ctx.db.patch(materialization._id, {
      status: "retired",
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.viewMaterializations.cleanupRetired,
      { materializationId: materialization._id },
    );
  }
}

export async function recordTableViewChange(
  ctx: MutationCtx,
  args: {
    orgId: string;
    baseId: Id<"bases">;
    tableId: Id<"tables">;
    recordIds: readonly Id<"records">[];
  },
) {
  const recordIds = [...new Set(args.recordIds)];
  if (!recordIds.length) return;
  const [active, building] = await Promise.all([
    ctx.db
      .query("viewMaterializations")
      .withIndex("by_table_and_status", (q) =>
        q.eq("tableId", args.tableId).eq("status", "active"),
      )
      .first(),
    ctx.db
      .query("viewMaterializations")
      .withIndex("by_table_and_status", (q) =>
        q.eq("tableId", args.tableId).eq("status", "building"),
      )
      .first(),
  ]);
  if (!active && !building) return;

  const chunks: Id<"records">[][] = [];
  for (let index = 0; index < recordIds.length; index += MAX_CHANGED_RECORDS) {
    chunks.push(recordIds.slice(index, index + MAX_CHANGED_RECORDS));
  }
  const state = await ctx.db
    .query("tableViewDataStates")
    .withIndex("by_table", (q) => q.eq("tableId", args.tableId))
    .unique();
  const now = Date.now();
  const startingRevision = state?.revision ?? 0;
  const revision = startingRevision + chunks.length;
  if (state) {
    await ctx.db.patch(state._id, { revision, updatedAt: now });
  } else {
    await ctx.db.insert("tableViewDataStates", {
      orgId: args.orgId,
      baseId: args.baseId,
      tableId: args.tableId,
      revision,
      updatedAt: now,
    });
  }
  for (let index = 0; index < chunks.length; index += 1) {
    await ctx.db.insert("tableViewChanges", {
      orgId: args.orgId,
      baseId: args.baseId,
      tableId: args.tableId,
      revision: startingRevision + index + 1,
      recordIds: chunks[index]!,
      updatedAt: now,
    });
  }
  await ctx.scheduler.runAfter(
    0,
    internal.viewMaterializations.processTable,
    { tableId: args.tableId },
  );
}
