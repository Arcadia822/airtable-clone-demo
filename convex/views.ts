import { ConvexError, v } from "convex/values";
import { generateKeyBetween } from "jittered-fractional-indexing";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
  requireOrgAdmin,
  requireOrgIdentity,
  type OrgIdentity,
} from "./lib/auth";
import { compareRanks, requireTable } from "./lib/data";
import {
  ensureViewFieldConfigs,
  requireView,
  requireViewField,
} from "./lib/viewData";
import {
  viewConfigurationValidator,
  viewFieldFormattingValidator,
  viewFilterValidator,
  viewGroupValidator,
  viewSortValidator,
  viewTypeValidator,
  viewVisibilityValidator,
} from "./lib/validators";
import { retireViewMaterializations } from "./lib/viewChanges";

const MAX_VIEWS_PER_TABLE = 100;
const MAX_FIELDS_PER_VIEW = 500;
const MAX_FILTERS = 50;
const MAX_SORTS = 10;
const MAX_GROUPS = 3;
const MIN_FIELD_WIDTH = 100;
const MAX_FIELD_WIDTH = 600;
const MAX_RECENT_VIEWS = 20;
const MAX_RECENT_PREFERENCE_SCAN = 100;
const MAX_KANBAN_SUMMARY_FIELDS = 3;
const MAX_GALLERY_SUMMARY_FIELDS = 4;

const viewPreferenceResultValidator = v.object({
  viewId: v.id("views"),
  isFavorite: v.boolean(),
  lastOpenedAt: v.union(v.number(), v.null()),
});

const recentViewResultValidator = viewPreferenceResultValidator.extend({
  baseId: v.id("bases"),
  tableId: v.id("tables"),
  name: v.string(),
  type: viewTypeValidator,
  visibility: viewVisibilityValidator,
});

type ReadCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;

type ViewDefinition = Pick<
  Doc<"views">,
  | "tableId"
  | "type"
  | "filters"
  | "sorts"
  | "groups"
  | "configuration"
>;

function assertValidName(name: string): string {
  const normalized = name.trim();
  if (!normalized || normalized.length > 120) {
    throw new ConvexError({ code: "INVALID_VIEW_NAME" });
  }
  return normalized;
}

function assertExpectedRevision(
  view: Doc<"views">,
  expectedRevision: number,
) {
  if (
    !Number.isInteger(expectedRevision) ||
    expectedRevision < 1 ||
    view.revision !== expectedRevision
  ) {
    throw new ConvexError({
      code: "VIEW_REVISION_CONFLICT",
      expectedRevision,
      actualRevision: view.revision,
    });
  }
}

function canAccessView(view: Doc<"views">, identity: OrgIdentity) {
  return (
    view.orgId === identity.orgId &&
    (view.visibility !== "personal" ||
      view.ownerUserId === identity.userId)
  );
}

function preferenceUserIdentityKey(identity: OrgIdentity): string {
  return identity.raw.tokenIdentifier;
}

async function findViewPreference(
  ctx: ReadCtx,
  identity: OrgIdentity,
  viewId: Id<"views">,
) {
  return await ctx.db
    .query("viewPreferences")
    .withIndex(
      "by_org_id_and_user_identity_key_and_view_id",
      (q) =>
        q
          .eq("orgId", identity.orgId)
          .eq(
            "userIdentityKey",
            preferenceUserIdentityKey(identity),
          )
          .eq("viewId", viewId),
    )
    .unique();
}

async function hasActiveViewParents(
  ctx: ReadCtx,
  view: Doc<"views">,
): Promise<boolean> {
  const [base, table] = await Promise.all([
    ctx.db.get(view.baseId),
    ctx.db.get(view.tableId),
  ]);
  return (
    base?.orgId === view.orgId &&
    base.status === "active" &&
    table?.orgId === view.orgId &&
    table.baseId === view.baseId &&
    table.status === "active"
  );
}

async function requireAccessibleView(
  ctx: ReadCtx,
  identity: OrgIdentity,
  viewId: Id<"views">,
  allowArchived = false,
) {
  const view = await requireView(
    ctx,
    identity.orgId,
    viewId,
    allowArchived,
  );
  if (!canAccessView(view, identity)) {
    throw new ConvexError({ code: "VIEW_NOT_FOUND" });
  }
  return view;
}

function assertUniqueIds(
  items: ReadonlyArray<{ id: string }>,
  code: string,
) {
  const ids = new Set<string>();
  for (const item of items) {
    const id = item.id.trim();
    if (!id || ids.has(id)) {
      throw new ConvexError({ code });
    }
    ids.add(id);
  }
}

function randomRankBetween(lower?: string, upper?: string) {
  return generateKeyBetween(lower ?? null, upper ?? null, {
    jitterBits: 48,
    getRandomBit: () => {
      const random = new Uint8Array(1);
      crypto.getRandomValues(random);
      return (random[0] & 1) === 1;
    },
  });
}

async function validateViewDefinition(
  ctx: ReadCtx,
  orgId: string,
  definition: ViewDefinition,
) {
  if (definition.filters.length > MAX_FILTERS) {
    throw new ConvexError({ code: "TOO_MANY_VIEW_FILTERS" });
  }
  if (definition.sorts.length > MAX_SORTS) {
    throw new ConvexError({ code: "TOO_MANY_VIEW_SORTS" });
  }
  if (definition.groups.length > MAX_GROUPS) {
    throw new ConvexError({ code: "TOO_MANY_VIEW_GROUPS" });
  }
  assertUniqueIds(definition.filters, "DUPLICATE_VIEW_FILTER_ID");
  assertUniqueIds(definition.sorts, "DUPLICATE_VIEW_SORT_ID");
  assertUniqueIds(definition.groups, "DUPLICATE_VIEW_GROUP_ID");

  const kanbanSummaryFieldIds =
    definition.configuration.kanbanSummaryFieldIds ?? [];
  const gallerySummaryFieldIds =
    definition.configuration.gallerySummaryFieldIds ?? [];
  if (kanbanSummaryFieldIds.length > MAX_KANBAN_SUMMARY_FIELDS) {
    throw new ConvexError({ code: "TOO_MANY_KANBAN_SUMMARY_FIELDS" });
  }
  if (gallerySummaryFieldIds.length > MAX_GALLERY_SUMMARY_FIELDS) {
    throw new ConvexError({ code: "TOO_MANY_GALLERY_SUMMARY_FIELDS" });
  }
  if (
    new Set(kanbanSummaryFieldIds).size !==
    kanbanSummaryFieldIds.length
  ) {
    throw new ConvexError({ code: "DUPLICATE_KANBAN_SUMMARY_FIELD" });
  }
  if (
    new Set(gallerySummaryFieldIds).size !==
    gallerySummaryFieldIds.length
  ) {
    throw new ConvexError({ code: "DUPLICATE_GALLERY_SUMMARY_FIELD" });
  }

  const emptyOperators = new Set(["is_empty", "is_not_empty"]);
  for (const filter of definition.filters) {
    if (emptyOperators.has(filter.operator)) {
      if (filter.value !== undefined) {
        throw new ConvexError({
          code: "VIEW_FILTER_VALUE_NOT_ALLOWED",
          filterId: filter.id,
        });
      }
    } else if (filter.value === undefined || filter.value === null) {
      throw new ConvexError({
        code: "VIEW_FILTER_VALUE_REQUIRED",
        filterId: filter.id,
      });
    }
  }

  const sortFieldIds = new Set<Id<"fields">>();
  for (const sort of definition.sorts) {
    if (sortFieldIds.has(sort.fieldId)) {
      throw new ConvexError({ code: "DUPLICATE_VIEW_SORT_FIELD" });
    }
    sortFieldIds.add(sort.fieldId);
  }
  const groupFieldIds = new Set<Id<"fields">>();
  for (const group of definition.groups) {
    if (groupFieldIds.has(group.fieldId)) {
      throw new ConvexError({ code: "DUPLICATE_VIEW_GROUP_FIELD" });
    }
    groupFieldIds.add(group.fieldId);
  }

  const referencedFieldIds = new Set<Id<"fields">>();
  for (const filter of definition.filters) {
    referencedFieldIds.add(filter.fieldId);
  }
  for (const sort of definition.sorts) referencedFieldIds.add(sort.fieldId);
  for (const group of definition.groups) {
    referencedFieldIds.add(group.fieldId);
  }
  const configurationFieldIds = [
    definition.configuration.kanbanFieldId,
    definition.configuration.calendarDateFieldId,
    definition.configuration.galleryCoverFieldId,
    ...kanbanSummaryFieldIds,
    ...gallerySummaryFieldIds,
  ].filter((fieldId): fieldId is Id<"fields"> => fieldId !== undefined);
  for (const fieldId of configurationFieldIds) {
    referencedFieldIds.add(fieldId);
  }

  const fields = new Map<Id<"fields">, Doc<"fields">>();
  for (const fieldId of referencedFieldIds) {
    const field = await ctx.db.get(fieldId);
    if (
      !field ||
      field.orgId !== orgId ||
      field.tableId !== definition.tableId ||
      field.status !== "active"
    ) {
      throw new ConvexError({ code: "VIEW_FIELD_MISMATCH" });
    }
    fields.set(fieldId, field);
  }

  if (definition.type === "kanban") {
    const fieldId = definition.configuration.kanbanFieldId;
    const field = fieldId ? fields.get(fieldId) : undefined;
    if (
      !field ||
      field.type !== "singleSelect"
    ) {
      throw new ConvexError({ code: "KANBAN_FIELD_REQUIRED" });
    }
  }
  if (definition.type === "calendar") {
    const fieldId = definition.configuration.calendarDateFieldId;
    const field = fieldId ? fields.get(fieldId) : undefined;
    if (
      !field ||
      field.type !== "date"
    ) {
      throw new ConvexError({ code: "CALENDAR_DATE_FIELD_REQUIRED" });
    }
  }
  if (
    definition.type === "gallery" &&
    definition.configuration.galleryCoverFieldId !== undefined
  ) {
    const field = fields.get(definition.configuration.galleryCoverFieldId);
    if (!field || field.type !== "attachment") {
      throw new ConvexError({ code: "GALLERY_COVER_FIELD_INVALID" });
    }
  }
}

async function writeViewAudit(
  ctx: MutationCtx,
  identity: OrgIdentity,
  view: Pick<Doc<"views">, "_id" | "baseId" | "tableId">,
  action: string,
  revisionBefore?: number,
  revisionAfter?: number,
  changedFieldIds?: Id<"fields">[],
) {
  await ctx.db.insert("auditEvents", {
    orgId: identity.orgId,
    actorType: "user",
    actorId: identity.userId,
    action,
    resourceType: "view",
    resourceId: view._id,
    baseId: view.baseId,
    tableId: view.tableId,
    changedFieldIds,
    revisionBefore,
    revisionAfter,
    createdAt: Date.now(),
  });
}

async function activeViewsForTable(
  ctx: ReadCtx,
  tableId: Id<"tables">,
) {
  return await ctx.db
    .query("views")
    .withIndex("by_table_and_status_and_rank", (q) =>
      q.eq("tableId", tableId).eq("status", "active"),
    )
    .take(MAX_VIEWS_PER_TABLE);
}

export const list = query({
  args: {
    tableId: v.id("tables"),
    includeArchived: v.optional(v.boolean()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    await requireTable(ctx, identity.orgId, args.tableId);
    const active = await activeViewsForTable(ctx, args.tableId);
    const archived = args.includeArchived
      ? await ctx.db
          .query("views")
          .withIndex("by_table_and_status_and_rank", (q) =>
            q.eq("tableId", args.tableId).eq("status", "archived"),
          )
          .take(MAX_VIEWS_PER_TABLE)
      : [];
    return [...active, ...archived]
      .filter((view) => canAccessView(view, identity))
      .sort(compareRanks);
  },
});

export const get = query({
  args: {
    tableId: v.id("tables"),
    viewId: v.optional(v.id("views")),
  },
  returns: v.union(
    v.null(),
    v.object({
      view: v.any(),
      fieldConfigs: v.array(v.any()),
    }),
  ),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    const table = await requireTable(ctx, identity.orgId, args.tableId);
    let view: Doc<"views"> | null = null;
    if (args.viewId !== undefined) {
      const requested = await requireAccessibleView(
        ctx,
        identity,
        args.viewId,
      );
      if (requested.tableId !== args.tableId) {
        throw new ConvexError({ code: "VIEW_TABLE_MISMATCH" });
      }
      view = requested;
    } else {
      const recentPreferences = await ctx.db
        .query("viewPreferences")
        .withIndex(
          "by_org_id_and_user_identity_key_and_table_id",
          (q) =>
            q
              .eq("orgId", identity.orgId)
              .eq(
                "userIdentityKey",
                preferenceUserIdentityKey(identity),
              )
              .eq("tableId", args.tableId),
        )
        .take(MAX_RECENT_PREFERENCE_SCAN);
      recentPreferences.sort(
        (left, right) =>
          (right.lastOpenedAt ?? -1) - (left.lastOpenedAt ?? -1),
      );
      for (const preference of recentPreferences) {
        if (preference.lastOpenedAt === null) continue;
        const candidate = await ctx.db.get(preference.viewId);
        if (
          candidate?.tableId === args.tableId &&
          candidate.status === "active" &&
          canAccessView(candidate, identity)
        ) {
          view = candidate;
          break;
        }
      }

      if (!view && table.defaultViewId !== undefined) {
        const candidate = await ctx.db.get(table.defaultViewId);
        if (
          candidate?.tableId === args.tableId &&
          candidate.status === "active" &&
          canAccessView(candidate, identity)
        ) {
          view = candidate;
        }
      }
    }
    if (!view) {
      const candidates = await activeViewsForTable(ctx, args.tableId);
      view =
        candidates.find((candidate) => canAccessView(candidate, identity)) ??
        null;
    }
    if (!view) return null;

    const [configs, fields] = await Promise.all([
      ctx.db
        .query("viewFieldConfigs")
        .withIndex("by_view_and_rank", (q) => q.eq("viewId", view!._id))
        .take(MAX_FIELDS_PER_VIEW),
      ctx.db
        .query("fields")
        .withIndex("by_table_and_status_and_rank", (q) =>
          q.eq("tableId", args.tableId).eq("status", "active"),
        )
        .take(MAX_FIELDS_PER_VIEW),
    ]);
    const activeFieldIds = new Set(fields.map((field) => field._id));
    return {
      view,
      fieldConfigs: configs.filter(
        (config) =>
          config.orgId === identity.orgId &&
          config.tableId === args.tableId &&
          activeFieldIds.has(config.fieldId),
      ),
    };
  },
});

export const listPreferences = query({
  args: {
    tableId: v.id("tables"),
  },
  returns: v.array(viewPreferenceResultValidator),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    await requireTable(ctx, identity.orgId, args.tableId);
    const preferences = await ctx.db
      .query("viewPreferences")
      .withIndex(
        "by_org_id_and_user_identity_key_and_table_id",
        (q) =>
          q
            .eq("orgId", identity.orgId)
            .eq(
              "userIdentityKey",
              preferenceUserIdentityKey(identity),
            )
            .eq("tableId", args.tableId),
      )
      .take(MAX_VIEWS_PER_TABLE);

    const accessible = [];
    for (const preference of preferences) {
      const view = await ctx.db.get(preference.viewId);
      if (
        !view ||
        view.tableId !== args.tableId ||
        view.status !== "active" ||
        !canAccessView(view, identity)
      ) {
        continue;
      }
      accessible.push({
        viewId: view._id,
        isFavorite: preference.isFavorite,
        lastOpenedAt: preference.lastOpenedAt,
      });
    }
    return accessible;
  },
});

export const listRecent = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(recentViewResultValidator),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    const limit = args.limit ?? 8;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_RECENT_VIEWS
    ) {
      throw new ConvexError({ code: "INVALID_RECENT_VIEW_LIMIT" });
    }
    const preferences = await ctx.db
      .query("viewPreferences")
      .withIndex(
        "by_org_id_and_user_identity_key_and_last_opened_at",
        (q) =>
          q
            .eq("orgId", identity.orgId)
            .eq(
              "userIdentityKey",
              preferenceUserIdentityKey(identity),
            ),
      )
      .order("desc")
      .take(MAX_RECENT_PREFERENCE_SCAN);

    const recent = [];
    for (const preference of preferences) {
      if (recent.length >= limit) break;
      if (preference.lastOpenedAt === null) continue;
      const view = await ctx.db.get(preference.viewId);
      if (
        !view ||
        view.status !== "active" ||
        !canAccessView(view, identity) ||
        !(await hasActiveViewParents(ctx, view))
      ) {
        continue;
      }
      recent.push({
        viewId: view._id,
        baseId: view.baseId,
        tableId: view.tableId,
        name: view.name,
        type: view.type,
        visibility: view.visibility,
        isFavorite: preference.isFavorite,
        lastOpenedAt: preference.lastOpenedAt,
      });
    }
    return recent;
  },
});

export const setFavorite = mutation({
  args: {
    viewId: v.id("views"),
    favorite: v.boolean(),
  },
  returns: viewPreferenceResultValidator,
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    const view = await requireAccessibleView(ctx, identity, args.viewId);
    const existing = await findViewPreference(
      ctx,
      identity,
      args.viewId,
    );
    if (!args.favorite && existing?.lastOpenedAt === null) {
      await ctx.db.delete(existing._id);
      return {
        viewId: view._id,
        isFavorite: false,
        lastOpenedAt: null,
      };
    }
    if (!args.favorite && !existing) {
      return {
        viewId: view._id,
        isFavorite: false,
        lastOpenedAt: null,
      };
    }

    const now = Date.now();
    if (existing) {
      if (existing.isFavorite !== args.favorite) {
        await ctx.db.patch(existing._id, {
          isFavorite: args.favorite,
          updatedAt: now,
        });
      }
      return {
        viewId: view._id,
        isFavorite: args.favorite,
        lastOpenedAt: existing.lastOpenedAt,
      };
    }

    await ctx.db.insert("viewPreferences", {
      orgId: identity.orgId,
      userIdentityKey: preferenceUserIdentityKey(identity),
      baseId: view.baseId,
      tableId: view.tableId,
      viewId: view._id,
      isFavorite: true,
      lastOpenedAt: null,
      updatedAt: now,
    });
    return {
      viewId: view._id,
      isFavorite: true,
      lastOpenedAt: null,
    };
  },
});

export const recordOpened = mutation({
  args: {
    viewId: v.id("views"),
  },
  returns: viewPreferenceResultValidator,
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    const view = await requireAccessibleView(ctx, identity, args.viewId);
    const userIdentityKey = preferenceUserIdentityKey(identity);
    const [existing, latest] = await Promise.all([
      findViewPreference(ctx, identity, view._id),
      ctx.db
        .query("viewPreferences")
        .withIndex(
          "by_org_id_and_user_identity_key_and_last_opened_at",
          (q) =>
            q
              .eq("orgId", identity.orgId)
              .eq("userIdentityKey", userIdentityKey),
        )
        .order("desc")
        .first(),
    ]);
    const lastOpenedAt = Math.max(
      Date.now(),
      (latest?.lastOpenedAt ?? 0) + 1,
    );

    if (existing) {
      await ctx.db.patch(existing._id, {
        baseId: view.baseId,
        tableId: view.tableId,
        lastOpenedAt,
        updatedAt: lastOpenedAt,
      });
    } else {
      await ctx.db.insert("viewPreferences", {
        orgId: identity.orgId,
        userIdentityKey,
        baseId: view.baseId,
        tableId: view.tableId,
        viewId: view._id,
        isFavorite: false,
        lastOpenedAt,
        updatedAt: lastOpenedAt,
      });
    }
    return {
      viewId: view._id,
      isFavorite: existing?.isFavorite ?? false,
      lastOpenedAt,
    };
  },
});

export const create = mutation({
  args: {
    tableId: v.id("tables"),
    name: v.string(),
    type: viewTypeValidator,
    visibility: viewVisibilityValidator,
    afterViewId: v.optional(v.id("views")),
    filterConjunction: v.optional(
      v.union(v.literal("and"), v.literal("or")),
    ),
    filters: v.optional(v.array(viewFilterValidator)),
    sorts: v.optional(v.array(viewSortValidator)),
    groups: v.optional(v.array(viewGroupValidator)),
    configuration: v.optional(viewConfigurationValidator),
  },
  returns: v.object({
    viewId: v.id("views"),
    revision: v.number(),
  }),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const table = await requireTable(ctx, identity.orgId, args.tableId);
    const views = await activeViewsForTable(ctx, args.tableId);
    if (views.length >= MAX_VIEWS_PER_TABLE) {
      throw new ConvexError({ code: "VIEW_LIMIT_REACHED" });
    }
    const currentDefault = views.find((view) => view.isDefault);
    if (!currentDefault && args.visibility === "personal") {
      throw new ConvexError({ code: "SHARED_VIEW_REQUIRED" });
    }

    let lowerRank = views.at(-1)?.rank;
    let upperRank: string | undefined;
    if (args.afterViewId !== undefined) {
      const afterIndex = views.findIndex(
        (view) => view._id === args.afterViewId,
      );
      if (afterIndex < 0 || !canAccessView(views[afterIndex]!, identity)) {
        throw new ConvexError({ code: "VIEW_NOT_FOUND" });
      }
      lowerRank = views[afterIndex]!.rank;
      upperRank = views[afterIndex + 1]?.rank;
    }

    const definition: ViewDefinition = {
      tableId: args.tableId,
      type: args.type,
      filters: args.filters ?? [],
      sorts: args.sorts ?? [],
      groups: args.groups ?? [],
      configuration: args.configuration ?? {},
    };
    await validateViewDefinition(ctx, identity.orgId, definition);

    const now = Date.now();
    const viewId = await ctx.db.insert("views", {
      orgId: identity.orgId,
      baseId: table.baseId,
      tableId: args.tableId,
      name: assertValidName(args.name),
      type: args.type,
      rank: randomRankBetween(lowerRank, upperRank),
      status: "active",
      visibility: args.visibility,
      ownerUserId:
        args.visibility === "personal" ? identity.userId : undefined,
      isDefault: currentDefault === undefined,
      filterConjunction: args.filterConjunction ?? "and",
      filters: definition.filters,
      sorts: definition.sorts,
      groups: definition.groups,
      configuration: definition.configuration,
      revision: 1,
      createdByUserId: identity.userId,
      updatedAt: now,
    });
    const view = (await ctx.db.get(viewId))!;
    await ensureViewFieldConfigs(ctx, view);
    if (!currentDefault) {
      await ctx.db.patch(args.tableId, {
        defaultViewId: viewId,
        updatedAt: now,
      });
    }
    await writeViewAudit(ctx, identity, view, "view.created", undefined, 1);
    return { viewId, revision: 1 };
  },
});

export const duplicate = mutation({
  args: {
    sourceViewId: v.id("views"),
    expectedRevision: v.number(),
    name: v.optional(v.string()),
    afterViewId: v.optional(v.id("views")),
  },
  returns: v.object({
    viewId: v.id("views"),
    revision: v.number(),
  }),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const source = await requireAccessibleView(
      ctx,
      identity,
      args.sourceViewId,
    );
    assertExpectedRevision(source, args.expectedRevision);
    const activeViews = await activeViewsForTable(ctx, source.tableId);
    if (activeViews.length >= MAX_VIEWS_PER_TABLE) {
      throw new ConvexError({ code: "VIEW_LIMIT_REACHED" });
    }

    const afterView =
      args.afterViewId === undefined
        ? source
        : await requireAccessibleView(ctx, identity, args.afterViewId);
    if (
      afterView.tableId !== source.tableId ||
      afterView.status !== "active"
    ) {
      throw new ConvexError({ code: "VIEW_TABLE_MISMATCH" });
    }
    const sortedViews = [...activeViews].sort(compareRanks);
    const afterIndex = sortedViews.findIndex(
      (candidate) => candidate._id === afterView._id,
    );
    if (afterIndex < 0) {
      throw new ConvexError({ code: "VIEW_NOT_FOUND" });
    }

    await ensureViewFieldConfigs(ctx, source);
    const sourceConfigs = await ctx.db
      .query("viewFieldConfigs")
      .withIndex("by_view_and_rank", (q) => q.eq("viewId", source._id))
      .take(MAX_FIELDS_PER_VIEW);
    const now = Date.now();
    const viewId = await ctx.db.insert("views", {
      orgId: source.orgId,
      baseId: source.baseId,
      tableId: source.tableId,
      name: assertValidName(args.name ?? `${source.name} copy`),
      type: source.type,
      rank: randomRankBetween(
        afterView.rank,
        sortedViews[afterIndex + 1]?.rank,
      ),
      status: "active",
      visibility: source.visibility,
      ownerUserId:
        source.visibility === "personal" ? identity.userId : undefined,
      isDefault: false,
      filterConjunction: source.filterConjunction,
      filters: source.filters,
      sorts: source.sorts,
      groups: source.groups,
      configuration: source.configuration,
      revision: 1,
      createdByUserId: identity.userId,
      updatedAt: now,
    });
    for (const config of sourceConfigs) {
      await ctx.db.insert("viewFieldConfigs", {
        orgId: config.orgId,
        baseId: config.baseId,
        tableId: config.tableId,
        viewId,
        fieldId: config.fieldId,
        rank: config.rank,
        width: config.width,
        hidden: config.hidden,
        frozen: config.frozen,
        formatting: config.formatting,
        updatedAt: now,
      });
    }
    const duplicated = (await ctx.db.get(viewId))!;
    await writeViewAudit(
      ctx,
      identity,
      duplicated,
      "view.duplicated",
      undefined,
      1,
    );
    return { viewId, revision: 1 };
  },
});

export const update = mutation({
  args: {
    viewId: v.id("views"),
    expectedRevision: v.number(),
    name: v.optional(v.string()),
    type: v.optional(viewTypeValidator),
    visibility: v.optional(viewVisibilityValidator),
    status: v.optional(v.union(v.literal("active"), v.literal("archived"))),
    filterConjunction: v.optional(
      v.union(v.literal("and"), v.literal("or")),
    ),
    filters: v.optional(v.array(viewFilterValidator)),
    sorts: v.optional(v.array(viewSortValidator)),
    groups: v.optional(v.array(viewGroupValidator)),
    configuration: v.optional(viewConfigurationValidator),
  },
  returns: v.object({
    viewId: v.id("views"),
    revision: v.number(),
  }),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const view = await requireAccessibleView(
      ctx,
      identity,
      args.viewId,
      true,
    );
    assertExpectedRevision(view, args.expectedRevision);
    if (view.status === "deleted") {
      throw new ConvexError({ code: "VIEW_NOT_FOUND" });
    }
    const nextStatus = args.status ?? view.status;
    const nextVisibility = args.visibility ?? view.visibility;
    if (view.status !== "active" && nextStatus === "active") {
      const activeViews = await activeViewsForTable(ctx, view.tableId);
      if (activeViews.length >= MAX_VIEWS_PER_TABLE) {
        throw new ConvexError({ code: "VIEW_LIMIT_REACHED" });
      }
      await ensureViewFieldConfigs(ctx, view);
    }
    if (
      view.isDefault &&
      (nextStatus !== "active" || nextVisibility === "personal")
    ) {
      throw new ConvexError({ code: "DEFAULT_VIEW_MUST_BE_SHARED" });
    }

    const nextDefinition: ViewDefinition = {
      tableId: view.tableId,
      type: args.type ?? view.type,
      filters: args.filters ?? view.filters,
      sorts: args.sorts ?? view.sorts,
      groups: args.groups ?? view.groups,
      configuration: args.configuration ?? view.configuration,
    };
    await validateViewDefinition(ctx, identity.orgId, nextDefinition);

    const now = Date.now();
    const revision = view.revision + 1;
    await ctx.db.patch(args.viewId, {
      name: args.name === undefined ? view.name : assertValidName(args.name),
      type: nextDefinition.type,
      visibility: nextVisibility,
      ownerUserId:
        nextVisibility === "personal" ? identity.userId : undefined,
      status: nextStatus,
      filterConjunction:
        args.filterConjunction ?? view.filterConjunction,
      filters: nextDefinition.filters,
      sorts: nextDefinition.sorts,
      groups: nextDefinition.groups,
      configuration: nextDefinition.configuration,
      revision,
      updatedAt: now,
      archivedAt: nextStatus === "archived" ? now : undefined,
    });
    if (nextStatus !== "active") {
      await retireViewMaterializations(ctx, view._id);
    }
    await writeViewAudit(
      ctx,
      identity,
      view,
      "view.updated",
      view.revision,
      revision,
    );
    return { viewId: args.viewId, revision };
  },
});

export const reorder = mutation({
  args: {
    viewId: v.id("views"),
    expectedRevision: v.number(),
    afterViewId: v.optional(v.id("views")),
    beforeViewId: v.optional(v.id("views")),
  },
  returns: v.object({
    viewId: v.id("views"),
    revision: v.number(),
    rank: v.string(),
  }),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const view = await requireAccessibleView(ctx, identity, args.viewId);
    assertExpectedRevision(view, args.expectedRevision);
    if (
      args.afterViewId === args.viewId ||
      args.beforeViewId === args.viewId ||
      (args.afterViewId !== undefined &&
        args.afterViewId === args.beforeViewId)
    ) {
      throw new ConvexError({ code: "INVALID_VIEW_POSITION" });
    }

    const activeViews = (await activeViewsForTable(ctx, view.tableId))
      .filter((candidate) => candidate._id !== view._id)
      .sort(compareRanks);
    const afterIndex =
      args.afterViewId === undefined
        ? -1
        : activeViews.findIndex(
            (candidate) => candidate._id === args.afterViewId,
          );
    const beforeIndex =
      args.beforeViewId === undefined
        ? -1
        : activeViews.findIndex(
            (candidate) => candidate._id === args.beforeViewId,
          );
    if (
      (args.afterViewId !== undefined && afterIndex < 0) ||
      (args.beforeViewId !== undefined && beforeIndex < 0)
    ) {
      throw new ConvexError({ code: "VIEW_NOT_FOUND" });
    }
    for (const targetId of [args.afterViewId, args.beforeViewId]) {
      if (targetId === undefined) continue;
      const target = activeViews.find(
        (candidate) => candidate._id === targetId,
      );
      if (!target || !canAccessView(target, identity)) {
        throw new ConvexError({ code: "VIEW_NOT_FOUND" });
      }
    }
    if (
      afterIndex >= 0 &&
      beforeIndex >= 0 &&
      beforeIndex !== afterIndex + 1
    ) {
      throw new ConvexError({ code: "VIEW_POSITION_NOT_ADJACENT" });
    }

    let lowerRank: string | undefined;
    let upperRank: string | undefined;
    if (afterIndex >= 0) {
      lowerRank = activeViews[afterIndex]!.rank;
      upperRank =
        beforeIndex >= 0
          ? activeViews[beforeIndex]!.rank
          : activeViews[afterIndex + 1]?.rank;
    } else if (beforeIndex >= 0) {
      upperRank = activeViews[beforeIndex]!.rank;
      lowerRank = activeViews[beforeIndex - 1]?.rank;
    } else {
      lowerRank = activeViews.at(-1)?.rank;
    }

    const rank = randomRankBetween(lowerRank, upperRank);
    const revision = view.revision + 1;
    const now = Date.now();
    await ctx.db.patch(view._id, { rank, revision, updatedAt: now });
    await writeViewAudit(
      ctx,
      identity,
      view,
      "view.reordered",
      view.revision,
      revision,
    );
    return { viewId: view._id, revision, rank };
  },
});

export const remove = mutation({
  args: {
    viewId: v.id("views"),
    expectedRevision: v.number(),
  },
  returns: v.object({
    viewId: v.id("views"),
    revision: v.number(),
    defaultViewId: v.optional(v.id("views")),
  }),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const view = await requireAccessibleView(
      ctx,
      identity,
      args.viewId,
      true,
    );
    assertExpectedRevision(view, args.expectedRevision);
    const activeViews = await activeViewsForTable(ctx, view.tableId);
    const replacement = activeViews.find(
      (candidate) =>
        candidate._id !== view._id &&
        candidate.visibility !== "personal",
    );
    if (view.status === "active" && activeViews.length === 1) {
      throw new ConvexError({ code: "LAST_VIEW_CANNOT_BE_DELETED" });
    }
    if (view.isDefault && !replacement) {
      throw new ConvexError({ code: "DEFAULT_VIEW_REPLACEMENT_REQUIRED" });
    }

    const now = Date.now();
    const revision = view.revision + 1;
    await ctx.db.patch(args.viewId, {
      status: "deleted",
      isDefault: false,
      revision,
      updatedAt: now,
      deletedAt: now,
    });
    await retireViewMaterializations(ctx, view._id);

    let defaultViewId: Id<"views"> | undefined;
    if (view.isDefault && replacement) {
      defaultViewId = replacement._id;
      await ctx.db.patch(replacement._id, {
        isDefault: true,
        revision: replacement.revision + 1,
        updatedAt: now,
      });
      await ctx.db.patch(view.tableId, {
        defaultViewId,
        updatedAt: now,
      });
    }
    const configs = await ctx.db
      .query("viewFieldConfigs")
      .withIndex("by_view_and_rank", (q) => q.eq("viewId", args.viewId))
      .take(MAX_FIELDS_PER_VIEW);
    for (const config of configs) await ctx.db.delete(config._id);

    await writeViewAudit(
      ctx,
      identity,
      view,
      "view.deleted",
      view.revision,
      revision,
    );
    return { viewId: args.viewId, revision, defaultViewId };
  },
});

export const setDefault = mutation({
  args: {
    viewId: v.id("views"),
    expectedRevision: v.number(),
  },
  returns: v.object({
    viewId: v.id("views"),
    revision: v.number(),
  }),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const view = await requireAccessibleView(ctx, identity, args.viewId);
    assertExpectedRevision(view, args.expectedRevision);
    if (view.visibility === "personal") {
      throw new ConvexError({ code: "PERSONAL_VIEW_CANNOT_BE_DEFAULT" });
    }
    const table = await requireTable(ctx, identity.orgId, view.tableId);
    if (view.isDefault && table.defaultViewId === view._id) {
      return { viewId: view._id, revision: view.revision };
    }

    const now = Date.now();
    const activeViews = await activeViewsForTable(ctx, view.tableId);
    for (const current of activeViews) {
      if (current._id === view._id || !current.isDefault) continue;
      await ctx.db.patch(current._id, {
        isDefault: false,
        revision: current.revision + 1,
        updatedAt: now,
      });
    }
    const revision = view.revision + 1;
    await ctx.db.patch(view._id, {
      isDefault: true,
      revision,
      updatedAt: now,
    });
    await ctx.db.patch(view.tableId, {
      defaultViewId: view._id,
      updatedAt: now,
    });
    await writeViewAudit(
      ctx,
      identity,
      view,
      "view.defaulted",
      view.revision,
      revision,
    );
    return { viewId: view._id, revision };
  },
});

export const updateFieldConfig = mutation({
  args: {
    viewId: v.id("views"),
    fieldId: v.id("fields"),
    expectedRevision: v.number(),
    width: v.optional(v.number()),
    hidden: v.optional(v.boolean()),
    frozen: v.optional(v.boolean()),
    formatting: v.optional(viewFieldFormattingValidator),
  },
  returns: v.object({
    viewId: v.id("views"),
    fieldId: v.id("fields"),
    revision: v.number(),
    fieldConfig: v.any(),
  }),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const view = await requireAccessibleView(ctx, identity, args.viewId);
    assertExpectedRevision(view, args.expectedRevision);
    const { field } = await requireViewField(
      ctx,
      identity.orgId,
      args.viewId,
      args.fieldId,
    );
    if (field.isPrimary && args.hidden === true) {
      throw new ConvexError({ code: "PRIMARY_FIELD_CANNOT_BE_HIDDEN" });
    }
    if (field.isPrimary && args.frozen === false) {
      throw new ConvexError({ code: "PRIMARY_FIELD_MUST_BE_FROZEN" });
    }
    if (
      args.width !== undefined &&
      (!Number.isFinite(args.width) || !Number.isInteger(args.width))
    ) {
      throw new ConvexError({ code: "INVALID_VIEW_FIELD_WIDTH" });
    }
    if (
      args.formatting?.color !== undefined &&
      !/^#[0-9a-fA-F]{6}$/.test(args.formatting.color)
    ) {
      throw new ConvexError({ code: "INVALID_VIEW_FIELD_COLOR" });
    }

    await ensureViewFieldConfigs(ctx, view);
    const config = await ctx.db
      .query("viewFieldConfigs")
      .withIndex("by_view_and_field", (q) =>
        q.eq("viewId", args.viewId).eq("fieldId", args.fieldId),
      )
      .unique();
    if (!config) {
      throw new ConvexError({ code: "VIEW_FIELD_NOT_FOUND" });
    }
    const now = Date.now();
    const revision = view.revision + 1;
    await ctx.db.patch(config._id, {
      width:
        args.width === undefined
          ? config.width
          : Math.max(
              MIN_FIELD_WIDTH,
              Math.min(args.width, MAX_FIELD_WIDTH),
            ),
      hidden: field.isPrimary ? false : (args.hidden ?? config.hidden),
      frozen: field.isPrimary ? true : (args.frozen ?? config.frozen),
      formatting: args.formatting ?? config.formatting,
      updatedAt: now,
    });
    await ctx.db.patch(view._id, { revision, updatedAt: now });
    const fieldConfig = (await ctx.db.get(config._id))!;
    await writeViewAudit(
      ctx,
      identity,
      view,
      "view.field_config_updated",
      view.revision,
      revision,
      [field._id],
    );
    return {
      viewId: view._id,
      fieldId: field._id,
      revision,
      fieldConfig,
    };
  },
});

export const reorderField = mutation({
  args: {
    viewId: v.id("views"),
    fieldId: v.id("fields"),
    expectedRevision: v.number(),
    afterFieldId: v.optional(v.id("fields")),
    beforeFieldId: v.optional(v.id("fields")),
  },
  returns: v.object({
    viewId: v.id("views"),
    fieldId: v.id("fields"),
    revision: v.number(),
    rank: v.string(),
  }),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const view = await requireAccessibleView(ctx, identity, args.viewId);
    assertExpectedRevision(view, args.expectedRevision);
    const { field } = await requireViewField(
      ctx,
      identity.orgId,
      args.viewId,
      args.fieldId,
    );
    if (field.isPrimary) {
      throw new ConvexError({ code: "PRIMARY_FIELD_CANNOT_BE_REORDERED" });
    }
    if (
      args.afterFieldId === args.fieldId ||
      args.beforeFieldId === args.fieldId ||
      (args.afterFieldId !== undefined &&
        args.afterFieldId === args.beforeFieldId)
    ) {
      throw new ConvexError({ code: "INVALID_VIEW_FIELD_POSITION" });
    }

    await ensureViewFieldConfigs(ctx, view);
    const [configs, activeFields] = await Promise.all([
      ctx.db
        .query("viewFieldConfigs")
        .withIndex("by_view_and_rank", (q) => q.eq("viewId", view._id))
        .take(MAX_FIELDS_PER_VIEW),
      ctx.db
        .query("fields")
        .withIndex("by_table_and_status_and_rank", (q) =>
          q.eq("tableId", view.tableId).eq("status", "active"),
        )
        .take(MAX_FIELDS_PER_VIEW),
    ]);
    const activeFieldIds = new Set(activeFields.map((item) => item._id));
    const activeConfigs = configs.filter((config) =>
      activeFieldIds.has(config.fieldId),
    );
    const moving = activeConfigs.find(
      (config) => config.fieldId === field._id,
    );
    if (!moving) throw new ConvexError({ code: "VIEW_FIELD_NOT_FOUND" });
    const remaining = activeConfigs.filter(
      (config) => config._id !== moving._id,
    );
    const afterIndex =
      args.afterFieldId === undefined
        ? -1
        : remaining.findIndex(
            (config) => config.fieldId === args.afterFieldId,
          );
    const beforeIndex =
      args.beforeFieldId === undefined
        ? -1
        : remaining.findIndex(
            (config) => config.fieldId === args.beforeFieldId,
          );
    if (
      (args.afterFieldId !== undefined && afterIndex < 0) ||
      (args.beforeFieldId !== undefined && beforeIndex < 0)
    ) {
      throw new ConvexError({ code: "VIEW_FIELD_NOT_FOUND" });
    }
    if (
      afterIndex >= 0 &&
      beforeIndex >= 0 &&
      beforeIndex !== afterIndex + 1
    ) {
      throw new ConvexError({ code: "VIEW_FIELD_POSITION_NOT_ADJACENT" });
    }
    const primaryIndex = remaining.findIndex(
      (config) => config.fieldId !== field._id && config.frozen,
    );
    if (beforeIndex === 0 && primaryIndex === 0) {
      throw new ConvexError({ code: "PRIMARY_FIELD_MUST_REMAIN_FIRST" });
    }

    let lowerRank: string | undefined;
    let upperRank: string | undefined;
    if (afterIndex >= 0) {
      lowerRank = remaining[afterIndex]!.rank;
      upperRank =
        beforeIndex >= 0
          ? remaining[beforeIndex]!.rank
          : remaining[afterIndex + 1]?.rank;
    } else if (beforeIndex >= 0) {
      upperRank = remaining[beforeIndex]!.rank;
      lowerRank = remaining[beforeIndex - 1]?.rank;
    } else {
      lowerRank = remaining.at(-1)?.rank;
    }
    const rank = randomRankBetween(lowerRank, upperRank);
    const now = Date.now();
    const revision = view.revision + 1;
    await ctx.db.patch(moving._id, { rank, updatedAt: now });
    await ctx.db.patch(view._id, { revision, updatedAt: now });
    await writeViewAudit(
      ctx,
      identity,
      view,
      "view.field_reordered",
      view.revision,
      revision,
      [field._id],
    );
    return { viewId: view._id, fieldId: field._id, revision, rank };
  },
});
