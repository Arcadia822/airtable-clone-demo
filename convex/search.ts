import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { query } from "./_generated/server";
import { requireOrgIdentity, type OrgIdentity } from "./lib/auth";

const MAX_QUERY_LENGTH = 120;
const MAX_SEARCH_RESULTS = 24;
const MAX_RESULTS_PER_KIND = 8;
const MAX_RECENT_RESULTS = 10;
const MAX_RECENT_PREFERENCE_SCAN = 40;

const destinationKindValidator = v.union(
  v.literal("base"),
  v.literal("table"),
  v.literal("view"),
  v.literal("form"),
);

const searchDestinationValidator = v.object({
  kind: destinationKindValidator,
  name: v.string(),
  context: v.string(),
  href: v.string(),
  detail: v.optional(v.string()),
});

function normalizedLimit(
  requested: number | undefined,
  maximum: number,
): number {
  const limit = requested ?? Math.min(16, maximum);
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) {
    throw new ConvexError({ code: "INVALID_SEARCH_LIMIT" });
  }
  return limit;
}

function normalizedSearchQuery(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < 2 || normalized.length > MAX_QUERY_LENGTH) {
    throw new ConvexError({ code: "INVALID_SEARCH_QUERY" });
  }
  return normalized;
}

function canAccessView(
  view: Pick<Doc<"views">, "orgId" | "visibility" | "ownerUserId">,
  identity: OrgIdentity,
) {
  return (
    view.orgId === identity.orgId &&
    (view.visibility !== "personal" ||
      view.ownerUserId === identity.userId)
  );
}

function viewTypeLabel(type: Doc<"views">["type"]): string {
  switch (type) {
    case "kanban":
      return "Board view";
    case "calendar":
      return "Calendar view";
    case "gallery":
      return "Gallery view";
    default:
      return "Grid view";
  }
}

function formStatusLabel(status: Doc<"forms">["status"]): string {
  switch (status) {
    case "published":
      return "Published form";
    case "closed":
      return "Closed form";
    default:
      return "Draft form";
  }
}

type SearchDestination = {
  kind: "base" | "table" | "view" | "form";
  name: string;
  context: string;
  href: string;
  detail?: string;
};

type ActiveParentMaps = {
  bases: Map<Id<"bases">, Doc<"bases">>;
  tables: Map<Id<"tables">, Doc<"tables">>;
};

async function activeParentMaps(
  ctx: QueryCtx,
  orgId: string,
  baseIds: ReadonlySet<Id<"bases">>,
  tableIds: ReadonlySet<Id<"tables">>,
): Promise<ActiveParentMaps> {
  const [bases, tables] = await Promise.all([
    Promise.all([...baseIds].map((baseId) => ctx.db.get(baseId))),
    Promise.all([...tableIds].map((tableId) => ctx.db.get(tableId))),
  ]);
  return {
    bases: new Map(
      bases
        .filter(
          (base): base is Doc<"bases"> =>
            base !== null &&
            base.orgId === orgId &&
            base.status === "active",
        )
        .map((base) => [base._id, base]),
    ),
    tables: new Map(
      tables
        .filter(
          (table): table is Doc<"tables"> =>
            table !== null &&
            table.orgId === orgId &&
            table.status === "active",
        )
        .map((table) => [table._id, table]),
    ),
  };
}

function hasMatchingParents(
  maps: ActiveParentMaps,
  resource: Pick<Doc<"tables">, "baseId"> &
    Partial<Pick<Doc<"views">, "tableId">>,
): boolean {
  const base = maps.bases.get(resource.baseId);
  if (!base) return false;
  if (resource.tableId === undefined) return true;
  const table = maps.tables.get(resource.tableId);
  return Boolean(table && table.baseId === base._id);
}

function resultPriority(result: SearchDestination, queryText: string) {
  const name = result.name.toLocaleLowerCase();
  const query = queryText.toLocaleLowerCase();
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  return 3;
}

export const destinations = query({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(searchDestinationValidator),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    const searchText = normalizedSearchQuery(args.query);
    const limit = normalizedLimit(args.limit, MAX_SEARCH_RESULTS);
    const perKind = Math.min(limit, MAX_RESULTS_PER_KIND);

    const [bases, tables, views, draftForms, publishedForms, closedForms] =
      await Promise.all([
        ctx.db
          .query("bases")
          .withSearchIndex(
            "search_name_by_org_id_and_status",
            (search) =>
              search
                .search("name", searchText)
                .eq("orgId", identity.orgId)
                .eq("status", "active"),
          )
          .take(perKind),
        ctx.db
          .query("tables")
          .withSearchIndex(
            "search_name_by_org_id_and_status",
            (search) =>
              search
                .search("name", searchText)
                .eq("orgId", identity.orgId)
                .eq("status", "active"),
          )
          .take(perKind),
        ctx.db
          .query("views")
          .withSearchIndex(
            "search_name_by_org_id_and_status",
            (search) =>
              search
                .search("name", searchText)
                .eq("orgId", identity.orgId)
                .eq("status", "active"),
          )
          .take(perKind),
        ...(["draft", "published", "closed"] as const).map((status) =>
          ctx.db
            .query("forms")
            .withSearchIndex(
              "search_name_by_org_id_and_status",
              (search) =>
                search
                  .search("name", searchText)
                  .eq("orgId", identity.orgId)
                  .eq("status", status),
            )
            .take(perKind),
        ),
      ]);

    const forms = [...draftForms, ...publishedForms, ...closedForms]
      .sort((left, right) => {
        const priority =
          resultPriority(
            {
              kind: "form",
              name: left.name,
              context: "",
              href: "",
            },
            searchText,
          ) -
          resultPriority(
            {
              kind: "form",
              name: right.name,
              context: "",
              href: "",
            },
            searchText,
          );
        if (priority !== 0) return priority;
        return left.name.localeCompare(right.name);
      })
      .slice(0, perKind);
    const baseIds = new Set<Id<"bases">>([
      ...bases.map((base) => base._id),
      ...tables.map((table) => table.baseId),
      ...views.map((view) => view.baseId),
      ...forms.map((form) => form.baseId),
    ]);
    const tableIds = new Set<Id<"tables">>([
      ...views.map((view) => view.tableId),
      ...forms.map((form) => form.tableId),
      ...tables.map((table) => table._id),
    ]);
    const parents = await activeParentMaps(
      ctx,
      identity.orgId,
      baseIds,
      tableIds,
    );
    const results: SearchDestination[] = [];

    for (const base of bases) {
      if (!parents.bases.has(base._id)) continue;
      results.push({
        kind: "base",
        name: base.name,
        context: "Base",
        href: `/bases/${base._id}`,
        detail: base.description?.trim() || undefined,
      });
    }
    for (const table of tables) {
      const base = parents.bases.get(table.baseId);
      if (!base || !hasMatchingParents(parents, table)) continue;
      results.push({
        kind: "table",
        name: table.name,
        context: base.name,
        href: `/bases/${table.baseId}/tables/${table._id}`,
        detail: "Table",
      });
    }
    for (const view of views) {
      const base = parents.bases.get(view.baseId);
      const table = parents.tables.get(view.tableId);
      if (
        !base ||
        !table ||
        !hasMatchingParents(parents, view) ||
        !canAccessView(view, identity)
      ) {
        continue;
      }
      results.push({
        kind: "view",
        name: view.name,
        context: `${base.name} / ${table.name}`,
        href: `/bases/${view.baseId}/tables/${view.tableId}?view=${view._id}`,
        detail: viewTypeLabel(view.type),
      });
    }
    for (const form of forms) {
      const base = parents.bases.get(form.baseId);
      const table = parents.tables.get(form.tableId);
      if (
        !base ||
        !table ||
        !hasMatchingParents(parents, form)
      ) {
        continue;
      }
      results.push({
        kind: "form",
        name: form.name,
        context: `${base.name} / ${table.name}`,
        href: `/bases/${form.baseId}/forms/${form._id}`,
        detail: formStatusLabel(form.status),
      });
    }

    return results
      .sort((left, right) => {
        const priority =
          resultPriority(left, searchText) -
          resultPriority(right, searchText);
        if (priority !== 0) return priority;
        return left.name.localeCompare(right.name);
      })
      .slice(0, limit);
  },
});

const recentDestinationValidator = searchDestinationValidator.extend({
  favorite: v.boolean(),
});

export const recent = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(recentDestinationValidator),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    const limit = normalizedLimit(args.limit, MAX_RECENT_RESULTS);
    const preferences = await ctx.db
      .query("viewPreferences")
      .withIndex(
        "by_org_id_and_user_identity_key_and_last_opened_at",
        (preference) =>
          preference
            .eq("orgId", identity.orgId)
            .eq("userIdentityKey", identity.raw.tokenIdentifier),
      )
      .order("desc")
      .take(MAX_RECENT_PREFERENCE_SCAN);
    const hydratedViews = await Promise.all(
      preferences.map((preference) => ctx.db.get(preference.viewId)),
    );
    const accessibleViews = hydratedViews.filter(
      (view): view is Doc<"views"> =>
        view !== null &&
        view.status === "active" &&
        canAccessView(view, identity),
    );
    const parents = await activeParentMaps(
      ctx,
      identity.orgId,
      new Set(accessibleViews.map((view) => view.baseId)),
      new Set(accessibleViews.map((view) => view.tableId)),
    );
    const viewsById = new Map(
      accessibleViews.map((view) => [view._id, view]),
    );
    const results = [];
    const seenViewIds = new Set<Id<"views">>();

    for (const preference of preferences) {
      if (results.length >= limit) break;
      if (preference.lastOpenedAt === null) continue;
      if (seenViewIds.has(preference.viewId)) continue;
      const view = viewsById.get(preference.viewId);
      if (!view) continue;
      const base = parents.bases.get(view.baseId);
      const table = parents.tables.get(view.tableId);
      if (!base || !table || table.baseId !== base._id) continue;
      results.push({
        kind: "view" as const,
        name: view.name,
        context: `${base.name} / ${table.name}`,
        href: `/bases/${view.baseId}/tables/${view.tableId}?view=${view._id}`,
        detail: viewTypeLabel(view.type),
        favorite: preference.isFavorite,
      });
      seenViewIds.add(view._id);
    }
    return results;
  },
});
