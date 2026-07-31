import { Migrations } from "@convex-dev/migrations";

import { components, internal } from "./_generated/api";
import schema from "./schema";
import {
  createDefaultViewForTable,
  ensureViewFieldConfigs,
} from "./lib/viewData";
import { migrateOpaqueFormSlug } from "./lib/formSlugs";
import {
  viewMaterializationHasGroupCounts,
  viewNeedsMaterialization,
} from "./lib/viewIndex";

export const migrations = new Migrations(components.migrations, {
  schema,
  migrationsLocationPrefix: "migrations:",
});

/**
 * Widen/migrate phase for normalized table views.
 *
 * New table writers create their view during the same mutation. This migration
 * handles tables created before that dual-write path existed. The helper is
 * deliberately idempotent, so resetting the migration cannot duplicate views.
 */
export const backfillDefaultViews = migrations.define({
  table: "tables",
  batchSize: 5,
  migrateOne: async (ctx, table) => {
    if (table.status !== "active") return;
    await createDefaultViewForTable(ctx, {
      table,
      createdByUserId: table.createdByUserId,
    });
  },
});

/**
 * Ensures every active view has one configuration row per active field.
 *
 * This separate pass covers views created during staged rollouts and safely
 * fills gaps without overwriting any existing per-view preferences.
 */
export const backfillViewFieldConfigs = migrations.define({
  table: "views",
  batchSize: 10,
  migrateOne: async (ctx, view) => {
    if (view.status !== "active") return;
    await ensureViewFieldConfigs(ctx, view);
  },
});

/**
 * Starts bounded materialization jobs for saved views whose filtering,
 * sorting, or grouping must be authoritative across the full table.
 *
 * The public workspace also lazily ensures this state, so this migration is
 * safe to pause, reset, or run again during a staged rollout.
 */
export const backfillViewMaterializations = migrations.define({
  table: "views",
  batchSize: 5,
  migrateOne: async (ctx, view) => {
    if (
      view.status !== "active" ||
      !viewNeedsMaterialization(view)
    ) {
      return;
    }
    const [active, building, dataState] = await Promise.all([
      ctx.db
        .query("viewMaterializations")
        .withIndex("by_view_and_status", (q) =>
          q.eq("viewId", view._id).eq("status", "active"),
        )
        .first(),
      ctx.db
        .query("viewMaterializations")
        .withIndex("by_view_and_status", (q) =>
          q.eq("viewId", view._id).eq("status", "building"),
        )
        .first(),
      ctx.db
        .query("tableViewDataStates")
        .withIndex("by_table", (q) => q.eq("tableId", view.tableId))
        .unique(),
    ]);
    if (
      (active?.viewRevision === view.revision &&
        viewMaterializationHasGroupCounts(view, active)) ||
      building?.viewRevision === view.revision
    ) {
      return;
    }
    const now = Date.now();
    const materializationId = await ctx.db.insert(
      "viewMaterializations",
      {
        orgId: view.orgId,
        baseId: view.baseId,
        tableId: view.tableId,
        viewId: view._id,
        viewRevision: view.revision,
        generation: crypto.randomUUID(),
        status: "building",
        phase: "scan",
        scanCursor: null,
        indexedDataRevision: dataState?.revision ?? 0,
        matchedCount: 0,
        groupCountsReady: false,
        createdAt: now,
        updatedAt: now,
      },
    );
    await ctx.scheduler.runAfter(
      0,
      internal.viewMaterializations.process,
      { materializationId },
    );
  },
});

/**
 * Replaces legacy public links that exposed an internal key or random token.
 *
 * The previous link is kept as an alias so links that have already been shared
 * continue to work. The public page then replaces the browser address with the
 * new readable link.
 */
export const backfillFriendlyFormSlugs = migrations.define({
  table: "forms",
  batchSize: 10,
  migrateOne: async (ctx, form) => {
    await migrateOpaqueFormSlug(ctx, form);
  },
});

export const run = migrations.runner();

export const runAll = migrations.runner([
  internal.migrations.backfillDefaultViews,
  internal.migrations.backfillViewFieldConfigs,
  internal.migrations.backfillViewMaterializations,
  internal.migrations.backfillFriendlyFormSlugs,
]);
