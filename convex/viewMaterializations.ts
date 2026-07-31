import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireOrgIdentity, type OrgIdentity } from "./lib/auth";
import { requireTable } from "./lib/data";
import {
  viewEntryForRecord,
  viewMaterializationHasGroupCounts,
  viewNeedsMaterialization,
} from "./lib/viewIndex";

const BUILD_BATCH_SIZE = 50;
const CLEANUP_BATCH_SIZE = 50;
const MAX_FIELDS_PER_TABLE = 500;
const MAX_VIEWS_PER_TABLE = 100;

type ReadCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;

function canAccessView(view: Doc<"views">, identity: OrgIdentity) {
  return (
    view.orgId === identity.orgId &&
    view.status === "active" &&
    (view.visibility !== "personal" ||
      view.ownerUserId === identity.userId)
  );
}

async function requireAccessibleView(
  ctx: ReadCtx,
  identity: OrgIdentity,
  viewId: Id<"views">,
) {
  const view = await ctx.db.get(viewId);
  if (!view || !canAccessView(view, identity)) {
    throw new ConvexError({
      code: "VIEW_NOT_AVAILABLE",
      message: "That saved view is no longer available.",
    });
  }
  await requireTable(ctx, identity.orgId, view.tableId);
  return view;
}

async function tableDataRevision(
  ctx: ReadCtx,
  tableId: Id<"tables">,
) {
  return (
    (
      await ctx.db
        .query("tableViewDataStates")
        .withIndex("by_table", (q) => q.eq("tableId", tableId))
        .unique()
    )?.revision ?? 0
  );
}

async function activeMaterialization(
  ctx: ReadCtx,
  viewId: Id<"views">,
) {
  return await ctx.db
    .query("viewMaterializations")
    .withIndex("by_view_and_status", (q) =>
      q.eq("viewId", viewId).eq("status", "active"),
    )
    .unique();
}

async function buildingMaterialization(
  ctx: ReadCtx,
  viewId: Id<"views">,
) {
  return await ctx.db
    .query("viewMaterializations")
    .withIndex("by_view_and_status", (q) =>
      q.eq("viewId", viewId).eq("status", "building"),
    )
    .unique();
}

function materializationStatus(
  view: Doc<"views">,
  active: Doc<"viewMaterializations"> | null,
  building: Doc<"viewMaterializations"> | null,
  currentDataRevision: number,
) {
  if (!viewNeedsMaterialization(view)) {
    return {
      mode: "direct" as const,
      materializationId: null,
      matchedCount: null,
      message: null,
    };
  }
  if (
    active &&
    active.viewRevision === view.revision &&
    active.indexedDataRevision >= currentDataRevision &&
    viewMaterializationHasGroupCounts(view, active)
  ) {
    return {
      mode: "ready" as const,
      materializationId: active._id,
      matchedCount: active.matchedCount,
      message: null,
    };
  }
  return {
    mode: "building" as const,
    materializationId: null,
    matchedCount:
      active?.viewRevision === view.revision
        ? active.matchedCount
        : null,
    message: building
      ? "Updating this saved view with the latest records…"
      : "Preparing this saved view…",
  };
}

export const status = query({
  args: { viewId: v.id("views") },
  returns: v.object({
    mode: v.union(
      v.literal("direct"),
      v.literal("building"),
      v.literal("ready"),
    ),
    materializationId: v.union(
      v.id("viewMaterializations"),
      v.null(),
    ),
    matchedCount: v.union(v.number(), v.null()),
    message: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    const view = await requireAccessibleView(
      ctx,
      identity,
      args.viewId,
    );
    const [active, building, currentDataRevision] = await Promise.all([
      activeMaterialization(ctx, view._id),
      buildingMaterialization(ctx, view._id),
      tableDataRevision(ctx, view.tableId),
    ]);
    return materializationStatus(
      view,
      active,
      building,
      currentDataRevision,
    );
  },
});

export const ensure = mutation({
  args: { viewId: v.id("views") },
  returns: v.object({
    mode: v.union(
      v.literal("direct"),
      v.literal("building"),
      v.literal("ready"),
    ),
    materializationId: v.union(
      v.id("viewMaterializations"),
      v.null(),
    ),
    matchedCount: v.union(v.number(), v.null()),
    message: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    const view = await requireAccessibleView(
      ctx,
      identity,
      args.viewId,
    );
    const [active, existingBuilding, currentDataRevision] =
      await Promise.all([
        activeMaterialization(ctx, view._id),
        buildingMaterialization(ctx, view._id),
        tableDataRevision(ctx, view.tableId),
      ]);
    if (!viewNeedsMaterialization(view)) {
      return materializationStatus(
        view,
        active,
        existingBuilding,
        currentDataRevision,
      );
    }
    if (
      active?.viewRevision === view.revision &&
      active.indexedDataRevision >= currentDataRevision &&
      viewMaterializationHasGroupCounts(view, active)
    ) {
      return materializationStatus(
        view,
        active,
        existingBuilding,
        currentDataRevision,
      );
    }

    let building = existingBuilding;
    if (building && building.viewRevision !== view.revision) {
      await ctx.db.patch(building._id, {
        status: "retired",
        updatedAt: Date.now(),
      });
      await ctx.scheduler.runAfter(
        0,
        internal.viewMaterializations.cleanupRetired,
        { materializationId: building._id },
      );
      building = null;
    }
    if (
      !building &&
      active?.viewRevision === view.revision &&
      viewMaterializationHasGroupCounts(view, active)
    ) {
      await ctx.scheduler.runAfter(
        0,
        internal.viewMaterializations.process,
        { materializationId: active._id },
      );
      return materializationStatus(
        view,
        active,
        null,
        currentDataRevision,
      );
    }
    if (!building) {
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
          indexedDataRevision: currentDataRevision,
          matchedCount: 0,
          groupCountsReady: false,
          createdAt: now,
          updatedAt: now,
        },
      );
      building = (await ctx.db.get(materializationId))!;
    }
    await ctx.scheduler.runAfter(
      0,
      internal.viewMaterializations.process,
      { materializationId: building._id },
    );
    return materializationStatus(
      view,
      active,
      building,
      currentDataRevision,
    );
  },
});

async function tableFields(
  ctx: ReadCtx,
  tableId: Id<"tables">,
) {
  return await ctx.db
    .query("fields")
    .withIndex("by_table_and_status_and_rank", (q) =>
      q.eq("tableId", tableId).eq("status", "active"),
    )
    .take(MAX_FIELDS_PER_TABLE);
}

type EntryUpdateDelta = {
  matchedCount: number;
  addedGroupLabel?: string;
  removedGroupLabel?: string;
};

function addGroupDelta(
  deltas: Map<string, number>,
  label: string | undefined,
  amount: number,
) {
  if (!label || amount === 0) return;
  const next = (deltas.get(label) ?? 0) + amount;
  if (next === 0) deltas.delete(label);
  else deltas.set(label, next);
}

async function applyGroupDeltas(
  ctx: MutationCtx,
  materialization: Doc<"viewMaterializations">,
  deltas: ReadonlyMap<string, number>,
) {
  const now = Date.now();
  for (const [groupLabel, delta] of deltas) {
    const existing = await ctx.db
      .query("viewGroupCounts")
      .withIndex("by_materialization_and_label", (q) =>
        q
          .eq("materializationId", materialization._id)
          .eq("groupLabel", groupLabel),
      )
      .unique();
    const nextCount = (existing?.count ?? 0) + delta;
    if (nextCount < 0) {
      throw new ConvexError({
        code: "VIEW_GROUP_COUNT_CONFLICT",
        message:
          "This saved view changed while its groups were updating.",
      });
    }
    if (nextCount === 0) {
      if (existing) await ctx.db.delete(existing._id);
      continue;
    }
    if (existing) {
      await ctx.db.patch(existing._id, {
        count: nextCount,
        updatedAt: now,
      });
      continue;
    }
    await ctx.db.insert("viewGroupCounts", {
      orgId: materialization.orgId,
      baseId: materialization.baseId,
      tableId: materialization.tableId,
      viewId: materialization.viewId,
      materializationId: materialization._id,
      groupLabel,
      count: nextCount,
      updatedAt: now,
    });
  }
}

async function updateEntry(
  ctx: MutationCtx,
  materialization: Doc<"viewMaterializations">,
  view: Doc<"views">,
  fields: Doc<"fields">[],
  recordId: Id<"records">,
) {
  const [record, existing] = await Promise.all([
    ctx.db.get(recordId),
    ctx.db
      .query("viewRecordEntries")
      .withIndex("by_materialization_and_record", (q) =>
        q
          .eq("materializationId", materialization._id)
          .eq("recordId", recordId),
      )
      .unique(),
  ]);
  const computed = record
    ? viewEntryForRecord(view, fields, record)
    : null;
  if (!computed) {
    if (existing) {
      await ctx.db.delete(existing._id);
      return {
        matchedCount: -1,
        removedGroupLabel: existing.groupLabel,
      } satisfies EntryUpdateDelta;
    }
    return { matchedCount: 0 } satisfies EntryUpdateDelta;
  }
  const now = Date.now();
  if (existing) {
    await ctx.db.patch(existing._id, {
      orderKey: computed.orderKey,
      groupLabel: computed.groupLabel,
      recordRevision: record!.revision,
      updatedAt: now,
    });
    return {
      matchedCount: 0,
      ...(existing.groupLabel !== computed.groupLabel
        ? {
            removedGroupLabel: existing.groupLabel,
            addedGroupLabel: computed.groupLabel,
          }
        : {}),
    } satisfies EntryUpdateDelta;
  }
  await ctx.db.insert("viewRecordEntries", {
    orgId: materialization.orgId,
    baseId: materialization.baseId,
    tableId: materialization.tableId,
    viewId: materialization.viewId,
    materializationId: materialization._id,
    recordId,
    orderKey: computed.orderKey,
    groupLabel: computed.groupLabel,
    recordRevision: record!.revision,
    updatedAt: now,
  });
  return {
    matchedCount: 1,
    addedGroupLabel: computed.groupLabel,
  } satisfies EntryUpdateDelta;
}

async function scheduleNext(
  ctx: MutationCtx,
  materializationId: Id<"viewMaterializations">,
) {
  await ctx.scheduler.runAfter(
    0,
    internal.viewMaterializations.process,
    { materializationId },
  );
}

export const process = internalMutation({
  args: { materializationId: v.id("viewMaterializations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const materialization = await ctx.db.get(args.materializationId);
    if (
      !materialization ||
      (materialization.status !== "building" &&
        materialization.status !== "active")
    ) {
      return null;
    }
    const view = await ctx.db.get(materialization.viewId);
    if (
      !view ||
      view.orgId !== materialization.orgId ||
      view.tableId !== materialization.tableId ||
      view.status !== "active"
    ) {
      await ctx.db.patch(materialization._id, {
        status: "retired",
        updatedAt: Date.now(),
      });
      await ctx.scheduler.runAfter(
        0,
        internal.viewMaterializations.cleanupRetired,
        { materializationId: materialization._id },
      );
      return null;
    }
    if (
      materialization.status === "building" &&
      view.revision !== materialization.viewRevision
    ) {
      await ctx.db.patch(materialization._id, {
        status: "retired",
        updatedAt: Date.now(),
      });
      await ctx.scheduler.runAfter(
        0,
        internal.viewMaterializations.cleanupRetired,
        { materializationId: materialization._id },
      );
      return null;
    }

    const fields = await tableFields(ctx, materialization.tableId);
    if (
      materialization.status === "building" &&
      materialization.phase === "scan"
    ) {
      const page = await ctx.db
        .query("records")
        .withIndex("by_table_and_status_and_rank", (q) =>
          q
            .eq("tableId", materialization.tableId)
            .eq("status", "active"),
        )
        .paginate({
          cursor: materialization.scanCursor,
          numItems: BUILD_BATCH_SIZE,
        });
      let matchedCount = materialization.matchedCount;
      const groupDeltas = new Map<string, number>();
      for (const record of page.page) {
        const delta = await updateEntry(
          ctx,
          materialization,
          view,
          fields,
          record._id,
        );
        matchedCount += delta.matchedCount;
        addGroupDelta(
          groupDeltas,
          delta.removedGroupLabel,
          -1,
        );
        addGroupDelta(groupDeltas, delta.addedGroupLabel, 1);
      }
      await applyGroupDeltas(ctx, materialization, groupDeltas);
      await ctx.db.patch(materialization._id, {
        phase: page.isDone ? "catchup" : "scan",
        scanCursor: page.isDone ? null : page.continueCursor,
        matchedCount,
        updatedAt: Date.now(),
      });
      await scheduleNext(ctx, materialization._id);
      return null;
    }

    const currentDataRevision = await tableDataRevision(
      ctx,
      materialization.tableId,
    );
    const change = await ctx.db
      .query("tableViewChanges")
      .withIndex("by_table_and_revision", (q) =>
        q
          .eq("tableId", materialization.tableId)
          .gt("revision", materialization.indexedDataRevision),
      )
      .first();
    if (change) {
      let matchedCount = materialization.matchedCount;
      const groupDeltas = new Map<string, number>();
      for (const recordId of new Set(change.recordIds)) {
        const delta = await updateEntry(
          ctx,
          materialization,
          view,
          fields,
          recordId,
        );
        matchedCount += delta.matchedCount;
        addGroupDelta(
          groupDeltas,
          delta.removedGroupLabel,
          -1,
        );
        addGroupDelta(groupDeltas, delta.addedGroupLabel, 1);
      }
      await applyGroupDeltas(ctx, materialization, groupDeltas);
      await ctx.db.patch(materialization._id, {
        indexedDataRevision: change.revision,
        matchedCount,
        updatedAt: Date.now(),
      });
      await scheduleNext(ctx, materialization._id);
      return null;
    }
    if (
      materialization.indexedDataRevision < currentDataRevision
    ) {
      await scheduleNext(ctx, materialization._id);
      return null;
    }

    if (materialization.status === "building") {
      const previous = await activeMaterialization(
        ctx,
        materialization.viewId,
      );
      const now = Date.now();
      if (previous && previous._id !== materialization._id) {
        await ctx.db.patch(previous._id, {
          status: "retired",
          updatedAt: now,
        });
        await ctx.scheduler.runAfter(
          0,
          internal.viewMaterializations.cleanupRetired,
          { materializationId: previous._id },
        );
      }
      await ctx.db.patch(materialization._id, {
        status: "active",
        groupCountsReady: true,
        completedAt: now,
        updatedAt: now,
      });
    }
    await ctx.scheduler.runAfter(
      0,
      internal.viewMaterializations.cleanupChanges,
      { tableId: materialization.tableId },
    );
    return null;
  },
});

export const processTable = internalMutation({
  args: { tableId: v.id("tables") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const [active, building] = await Promise.all([
      ctx.db
        .query("viewMaterializations")
        .withIndex("by_table_and_status", (q) =>
          q.eq("tableId", args.tableId).eq("status", "active"),
        )
        .take(MAX_VIEWS_PER_TABLE),
      ctx.db
        .query("viewMaterializations")
        .withIndex("by_table_and_status", (q) =>
          q.eq("tableId", args.tableId).eq("status", "building"),
        )
        .take(MAX_VIEWS_PER_TABLE),
    ]);
    for (const materialization of [...active, ...building]) {
      await scheduleNext(ctx, materialization._id);
    }
    return null;
  },
});

export const cleanupRetired = internalMutation({
  args: { materializationId: v.id("viewMaterializations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const materialization = await ctx.db.get(args.materializationId);
    if (!materialization || materialization.status !== "retired") {
      return null;
    }
    const entries = await ctx.db
      .query("viewRecordEntries")
      .withIndex("by_materialization_and_order", (q) =>
        q.eq("materializationId", args.materializationId),
      )
      .take(CLEANUP_BATCH_SIZE);
    for (const entry of entries) await ctx.db.delete(entry._id);
    if (entries.length > 0) {
      await ctx.scheduler.runAfter(
        0,
        internal.viewMaterializations.cleanupRetired,
        { materializationId: materialization._id },
      );
      return null;
    }
    const groupCounts = await ctx.db
      .query("viewGroupCounts")
      .withIndex("by_materialization", (q) =>
        q.eq("materializationId", materialization._id),
      )
      .take(CLEANUP_BATCH_SIZE);
    for (const groupCount of groupCounts) {
      await ctx.db.delete(groupCount._id);
    }
    if (groupCounts.length > 0) {
      await ctx.scheduler.runAfter(
        0,
        internal.viewMaterializations.cleanupRetired,
        { materializationId: materialization._id },
      );
      return null;
    }
    await ctx.db.delete(materialization._id);
    return null;
  },
});

export const cleanupChanges = internalMutation({
  args: { tableId: v.id("tables") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const [active, building] = await Promise.all([
      ctx.db
        .query("viewMaterializations")
        .withIndex("by_table_and_status", (q) =>
          q.eq("tableId", args.tableId).eq("status", "active"),
        )
        .take(MAX_VIEWS_PER_TABLE),
      ctx.db
        .query("viewMaterializations")
        .withIndex("by_table_and_status", (q) =>
          q.eq("tableId", args.tableId).eq("status", "building"),
        )
        .take(MAX_VIEWS_PER_TABLE),
    ]);
    const materializations = [...active, ...building];
    if (!materializations.length) return null;
    const minimumRevision = Math.min(
      ...materializations.map(
        (materialization) => materialization.indexedDataRevision,
      ),
    );
    const changes = await ctx.db
      .query("tableViewChanges")
      .withIndex("by_table_and_revision", (q) =>
        q
          .eq("tableId", args.tableId)
          .lte("revision", minimumRevision),
      )
      .take(CLEANUP_BATCH_SIZE);
    for (const change of changes) await ctx.db.delete(change._id);
    if (changes.length === CLEANUP_BATCH_SIZE) {
      await ctx.scheduler.runAfter(
        0,
        internal.viewMaterializations.cleanupChanges,
        { tableId: args.tableId },
      );
    }
    return null;
  },
});

export const listPage = query({
  args: {
    viewId: v.id("views"),
    materializationId: v.id("viewMaterializations"),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    const view = await requireAccessibleView(
      ctx,
      identity,
      args.viewId,
    );
    const materialization = await ctx.db.get(args.materializationId);
    if (
      materialization &&
      (materialization.orgId !== identity.orgId ||
        materialization.viewId !== view._id ||
        materialization.tableId !== view.tableId)
    ) {
      throw new ConvexError({
        code: "VIEW_NOT_AVAILABLE",
        message: "That saved view is no longer available.",
      });
    }

    // `status` is the authoritative gate that swaps the workspace between its
    // loading state and a current generation. Convex subscriptions can
    // invalidate this older paginated query a moment before the status query
    // reaches the client. Serving the same-view snapshot (including a retired
    // or already-cleaned generation) keeps that harmless ordering race from
    // tripping the component error boundary. The loading state hides this
    // snapshot until the current generation is ready.
    const page = await ctx.db
      .query("viewRecordEntries")
      .withIndex("by_materialization_and_order", (q) =>
        q.eq("materializationId", args.materializationId),
      )
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(args.paginationOpts.numItems, 100),
        maximumRowsRead: Math.min(
          args.paginationOpts.maximumRowsRead ?? 100,
          100,
        ),
      });
    const groupLabels = [
      ...new Set(
        page.page.flatMap((entry) =>
          entry.groupLabel ? [entry.groupLabel] : [],
        ),
      ),
    ];
    const [records, groupCountDocs] = await Promise.all([
      Promise.all(
        page.page.map((entry) => ctx.db.get(entry.recordId)),
      ),
      Promise.all(
        groupLabels.map((groupLabel) =>
          ctx.db
            .query("viewGroupCounts")
            .withIndex("by_materialization_and_label", (q) =>
              q
                .eq("materializationId", args.materializationId)
                .eq("groupLabel", groupLabel),
            )
            .unique(),
        ),
      ),
    ]);
    const groupCounts = new Map(
      groupCountDocs.flatMap((groupCount) =>
        groupCount
          ? [[groupCount.groupLabel, groupCount.count] as const]
          : [],
      ),
    );
    return {
      ...page,
      page: records.flatMap((record, index) => {
        const entry = page.page[index]!;
        return record &&
          record.orgId === identity.orgId &&
          record.status === "active"
          ? [
              {
                ...record,
                viewGroupLabel: entry.groupLabel,
                viewGroupCount: entry.groupLabel
                  ? groupCounts.get(entry.groupLabel)
                  : undefined,
              },
            ]
          : [];
      }),
    };
  },
});
