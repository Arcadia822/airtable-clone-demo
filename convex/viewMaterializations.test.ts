/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import type { UserIdentity } from "convex/server";
import { describe, expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { createRank } from "./lib/data";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const orgId = "org_viewMaterialization123456";
const otherOrgId = "org_viewMaterializationOther123456";
const approvedOptionId = "option_stage_approved_opaque_123456";
const newOptionId = "option_stage_new_opaque_123456";
const adminIdentity = {
  subject: "user_viewMaterializationAdmin123456",
  tokenIdentifier: "test|user_viewMaterializationAdmin123456",
  org_id: orgId,
  org_role: "org:admin",
  pla: "o:pro",
} satisfies Partial<UserIdentity> & Record<string, unknown>;
const memberIdentity = {
  ...adminIdentity,
  subject: "user_viewMaterializationMember123456",
  tokenIdentifier: "test|user_viewMaterializationMember123456",
  org_role: "org:member",
} satisfies Partial<UserIdentity> & Record<string, unknown>;
const outsiderIdentity = {
  ...adminIdentity,
  subject: "user_viewMaterializationOutsider123456",
  tokenIdentifier: "test|user_viewMaterializationOutsider123456",
  org_id: otherOrgId,
} satisfies Partial<UserIdentity> & Record<string, unknown>;

function setup() {
  return convexTest(schema, modules);
}

async function insertFixture(test: ReturnType<typeof setup>) {
  return await test.run(async (ctx) => {
    const now = Date.now();
    const baseId = await ctx.db.insert("bases", {
      orgId,
      name: "Scale test",
      rank: createRank(),
      status: "active",
      createdByUserId: adminIdentity.subject,
      updatedAt: now,
    });
    const tableId = await ctx.db.insert("tables", {
      orgId,
      baseId,
      name: "Pipeline",
      rank: createRank(),
      status: "active",
      createdByUserId: adminIdentity.subject,
      updatedAt: now,
    });
    const nameFieldId = await ctx.db.insert("fields", {
      orgId,
      baseId,
      tableId,
      name: "Name",
      type: "singleLineText",
      config: { maxLength: 10_000 },
      rank: createRank(),
      width: 220,
      isPrimary: true,
      status: "active",
      revision: 1,
      createdByUserId: adminIdentity.subject,
      updatedAt: now,
    });
    const stageFieldId = await ctx.db.insert("fields", {
      orgId,
      baseId,
      tableId,
      name: "Stage",
      type: "singleSelect",
      config: {
        options: [
          {
            id: approvedOptionId,
            label: "Approved",
            color: "#16a34a",
          },
          { id: newOptionId, label: "New", color: "#64748b" },
        ],
      },
      rank: createRank(),
      width: 160,
      isPrimary: false,
      status: "active",
      revision: 1,
      createdByUserId: adminIdentity.subject,
      updatedAt: now,
    });
    const scoreFieldId = await ctx.db.insert("fields", {
      orgId,
      baseId,
      tableId,
      name: "Score",
      type: "number",
      config: { precision: 0 },
      rank: createRank(),
      width: 140,
      isPrimary: false,
      status: "active",
      revision: 1,
      createdByUserId: adminIdentity.subject,
      updatedAt: now,
    });
    await ctx.db.patch(tableId, { primaryFieldId: nameFieldId });

    const recordIds: Id<"records">[] = [];
    let previousRank: string | undefined;
    for (let index = 0; index < 160; index += 1) {
      const rank = createRank(previousRank);
      previousRank = rank;
      recordIds.push(await ctx.db.insert("records", {
        orgId,
        baseId,
        tableId,
        rank,
        values: {
          [nameFieldId]: `Company ${index + 1}`,
          [stageFieldId]:
            index % 2 === 0 ? approvedOptionId : newOptionId,
          [scoreFieldId]: index,
        },
        status: "active",
        revision: 1,
        createdByType: "user",
        createdById: adminIdentity.subject,
        updatedByType: "user",
        updatedById: adminIdentity.subject,
        updatedAt: now,
      }));
    }
    const viewId = await ctx.db.insert("views", {
      orgId,
      baseId,
      tableId,
      name: "Qualified pipeline",
      type: "grid",
      rank: createRank(),
      status: "active",
      visibility: "collaborators",
      isDefault: true,
      filterConjunction: "and",
      filters: [
        {
          id: "qualified",
          fieldId: scoreFieldId,
          operator: "greater_than",
          value: 10,
        },
      ],
      sorts: [
        {
          id: "score_desc",
          fieldId: scoreFieldId,
          direction: "desc",
          rank: "a",
        },
      ],
      groups: [
        {
          id: "stage_asc",
          fieldId: stageFieldId,
          direction: "asc",
          rank: "a",
        },
      ],
      configuration: { rowHeight: "medium" },
      revision: 1,
      createdByUserId: adminIdentity.subject,
      updatedAt: now,
    });
    await ctx.db.patch(tableId, { defaultViewId: viewId });
    return {
      baseId,
      tableId,
      viewId,
      nameFieldId,
      stageFieldId,
      scoreFieldId,
      recordIds,
    };
  });
}

async function finishMaterialization(
  test: ReturnType<typeof setup>,
  materializationId: Id<"viewMaterializations">,
) {
  for (let index = 0; index < 20; index += 1) {
    const materialization = await test.run((ctx) =>
      ctx.db.get(materializationId),
    );
    if (materialization?.status === "active") return materialization;
    await test.mutation(internal.viewMaterializations.process, {
      materializationId,
    });
  }
  throw new Error("Materialization did not finish in bounded test steps");
}

async function emitRecordChange(
  test: ReturnType<typeof setup>,
  args: {
    baseId: Id<"bases">;
    tableId: Id<"tables">;
    recordId: Id<"records">;
  },
) {
  await test.run(async (ctx) => {
    const state = await ctx.db
      .query("tableViewDataStates")
      .withIndex("by_table", (q) => q.eq("tableId", args.tableId))
      .unique();
    const revision = (state?.revision ?? 0) + 1;
    const now = Date.now();
    if (state) {
      await ctx.db.patch(state._id, { revision, updatedAt: now });
    } else {
      await ctx.db.insert("tableViewDataStates", {
        orgId,
        baseId: args.baseId,
        tableId: args.tableId,
        revision,
        updatedAt: now,
      });
    }
    await ctx.db.insert("tableViewChanges", {
      orgId,
      baseId: args.baseId,
      tableId: args.tableId,
      revision,
      recordIds: [args.recordId],
      updatedAt: now,
    });
  });
}

describe("saved view materializations", () => {
  it("serves authoritative filtered, sorted, grouped pages beyond 100 rows and atomically replaces generations", async () => {
    const test = setup();
    const fixture = await insertFixture(test);
    const admin = test.withIdentity(adminIdentity);
    const member = test.withIdentity(memberIdentity);
    const outsider = test.withIdentity(outsiderIdentity);

    const ensured = await admin.mutation(
      api.viewMaterializations.ensure,
      { viewId: fixture.viewId },
    );
    expect(ensured).toMatchObject({
      mode: "building",
      matchedCount: null,
    });
    const firstGeneration = await test.run(async (ctx) =>
      ctx.db
        .query("viewMaterializations")
        .withIndex("by_view_and_status", (q) =>
          q.eq("viewId", fixture.viewId).eq("status", "building"),
        )
        .unique(),
    );
    expect(firstGeneration).not.toBeNull();

    await test.mutation(internal.viewMaterializations.process, {
      materializationId: firstGeneration!._id,
    });
    const changingRecord = await test.run(async (ctx) => {
      const record = (await ctx.db.get(fixture.recordIds[0]!))!;
      await ctx.db.patch(record._id, {
        values: {
          ...record.values,
          [fixture.scoreFieldId]: 200,
        },
        revision: record.revision + 1,
      });
      return record._id;
    });
    await emitRecordChange(test, {
      baseId: fixture.baseId,
      tableId: fixture.tableId,
      recordId: changingRecord,
    });

    const firstReady = await finishMaterialization(
      test,
      firstGeneration!._id,
    );
    expect(firstReady).toMatchObject({
      status: "active",
      matchedCount: 150,
      indexedDataRevision: 1,
      groupCountsReady: true,
    });
    expect(firstReady).not.toHaveProperty("groupCounts");
    const firstGroupCounts = await test.run((ctx) =>
      ctx.db
        .query("viewGroupCounts")
        .withIndex("by_materialization", (q) =>
          q.eq("materializationId", firstGeneration!._id),
        )
        .collect(),
    );
    expect(
      Object.fromEntries(
        firstGroupCounts.map((group) => [
          group.groupLabel,
          group.count,
        ]),
      ),
    ).toEqual({
      "Stage: Approved": 75,
      "Stage: New": 75,
    });
    const status = await member.query(
      api.viewMaterializations.status,
      { viewId: fixture.viewId },
    );
    expect(status).toMatchObject({
      mode: "ready",
      materializationId: firstGeneration!._id,
      matchedCount: 150,
    });
    await expect(
      outsider.query(api.viewMaterializations.status, {
        viewId: fixture.viewId,
      }),
    ).rejects.toThrow(/VIEW_NOT_AVAILABLE/);

    const firstPage = await member.query(
      api.viewMaterializations.listPage,
      {
        viewId: fixture.viewId,
        materializationId: firstGeneration!._id,
        paginationOpts: { cursor: null, numItems: 100 },
      },
    );
    expect(firstPage.page).toHaveLength(100);
    expect(firstPage.isDone).toBe(false);
    expect(
      firstPage.page
        .filter(
          (record: Doc<"records"> & { viewGroupLabel?: string }) =>
            record.viewGroupLabel === "Stage: Approved",
        )
        .every(
          (
            record: Doc<"records"> & {
              viewGroupCount?: number;
            },
          ) => record.viewGroupCount === 75,
        ),
    ).toBe(true);
    expect(
      firstPage.page
        .filter(
          (record: Doc<"records"> & { viewGroupLabel?: string }) =>
            record.viewGroupLabel === "Stage: New",
        )
        .every(
          (
            record: Doc<"records"> & {
              viewGroupCount?: number;
            },
          ) => record.viewGroupCount === 75,
        ),
    ).toBe(true);
    const secondPage = await member.query(
      api.viewMaterializations.listPage,
      {
        viewId: fixture.viewId,
        materializationId: firstGeneration!._id,
        paginationOpts: {
          cursor: firstPage.continueCursor,
          numItems: 100,
        },
      },
    );
    expect(secondPage.page).toHaveLength(50);
    expect(secondPage.isDone).toBe(true);
    const allRows = [...firstPage.page, ...secondPage.page] as Array<
      Doc<"records"> & {
        viewGroupCount?: number;
        viewGroupLabel?: string;
      }
    >;
    expect(allRows).toHaveLength(150);
    expect(
      allRows.every(
        (record) =>
          Number(record.values[fixture.scoreFieldId]) > 10,
      ),
    ).toBe(true);
    expect(
      allRows.map((record) => record.viewGroupLabel),
    ).toEqual([
      ...Array.from(
        { length: 75 },
        () => "Stage: Approved",
      ),
      ...Array.from(
        { length: 75 },
        () => "Stage: New",
      ),
    ]);
    expect(
      allRows
        .map((record) => record.viewGroupLabel)
        .join(" "),
    ).not.toMatch(/field_|record_|[a-z0-9_-]{24,}/i);
    for (const label of ["Stage: Approved", "Stage: New"]) {
      const scores = allRows
        .filter((record) => record.viewGroupLabel === label)
        .map((record) => Number(record.values[fixture.scoreFieldId]));
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    }

    const currentView = await test.run((ctx) =>
      ctx.db.get(fixture.viewId),
    );
    await admin.mutation(api.views.update, {
      viewId: fixture.viewId,
      expectedRevision: currentView!.revision,
      filters: [
        {
          id: "approved",
          fieldId: fixture.stageFieldId,
          operator: "is",
          value: approvedOptionId,
        },
      ],
      sorts: [
        {
          id: "name_desc",
          fieldId: fixture.nameFieldId,
          direction: "desc",
          rank: "a",
        },
      ],
    });
    expect(
      await admin.query(api.viewMaterializations.status, {
        viewId: fixture.viewId,
      }),
    ).toMatchObject({ mode: "building" });
    await admin.mutation(api.viewMaterializations.ensure, {
      viewId: fixture.viewId,
    });
    await admin.mutation(api.viewMaterializations.ensure, {
      viewId: fixture.viewId,
    });
    const generations = await test.run(async (ctx) => ({
      active: await ctx.db
        .query("viewMaterializations")
        .withIndex("by_view_and_status", (q) =>
          q.eq("viewId", fixture.viewId).eq("status", "active"),
        )
        .unique(),
      building: await ctx.db
        .query("viewMaterializations")
        .withIndex("by_view_and_status", (q) =>
          q.eq("viewId", fixture.viewId).eq("status", "building"),
        )
        .unique(),
    }));
    expect(generations.active?._id).toBe(firstGeneration!._id);
    expect(generations.building?.viewRevision).toBe(2);
    const previousSnapshot = await admin.query(
      api.viewMaterializations.listPage,
      {
        viewId: fixture.viewId,
        materializationId: firstGeneration!._id,
        paginationOpts: { cursor: null, numItems: 10 },
      },
    );
    expect(previousSnapshot.page).toHaveLength(10);
    expect(
      previousSnapshot.page.every(
        (record: Doc<"records">) =>
          Number(record.values[fixture.scoreFieldId]) > 10,
      ),
    ).toBe(true);

    const secondReady = await finishMaterialization(
      test,
      generations.building!._id,
    );
    expect(secondReady).toMatchObject({
      status: "active",
      viewRevision: 2,
      matchedCount: 80,
    });
    const approvedPage = await admin.query(
      api.viewMaterializations.listPage,
      {
        viewId: fixture.viewId,
        materializationId: secondReady._id,
        paginationOpts: { cursor: null, numItems: 100 },
      },
    );
    expect(approvedPage.page).toHaveLength(80);
    expect(
      approvedPage.page.every(
        (record: Doc<"records">) =>
          record.values[fixture.stageFieldId] === approvedOptionId,
      ),
    ).toBe(true);
    expect(
      approvedPage.page.every(
        (
          record: Doc<"records"> & {
            viewGroupCount?: number;
            viewGroupLabel?: string;
          },
        ) =>
          record.viewGroupLabel === "Stage: Approved" &&
          record.viewGroupCount === 80,
      ),
    ).toBe(true);
    const approvedNames = approvedPage.page.map(
      (record: Doc<"records">) =>
        String(record.values[fixture.nameFieldId]),
    );
    expect(approvedNames).toEqual(
      [...approvedNames].sort((left, right) =>
        right.localeCompare(left, "en", {
          numeric: true,
          sensitivity: "base",
        }),
      ),
    );
    const replaced = await test.run(async (ctx) => ({
      current: await ctx.db
        .query("viewMaterializations")
        .withIndex("by_view_and_status", (q) =>
          q.eq("viewId", fixture.viewId).eq("status", "active"),
        )
        .unique(),
      previous: await ctx.db.get(firstGeneration!._id),
    }));
    expect(replaced.current?._id).toBe(generations.building!._id);
    expect(replaced.previous?.status).toBe("retired");
    const retiredSnapshot = await admin.query(
      api.viewMaterializations.listPage,
      {
        viewId: fixture.viewId,
        materializationId: firstGeneration!._id,
        paginationOpts: { cursor: null, numItems: 10 },
      },
    );
    expect(retiredSnapshot.page).toHaveLength(10);

    await test.run(async (ctx) => {
      const record = (await ctx.db.get(changingRecord))!;
      await ctx.db.patch(record._id, {
        status: "deleted",
        revision: record.revision + 1,
      });
    });
    await emitRecordChange(test, {
      baseId: fixture.baseId,
      tableId: fixture.tableId,
      recordId: changingRecord,
    });
    expect(
      await admin.query(api.viewMaterializations.status, {
        viewId: fixture.viewId,
      }),
    ).toMatchObject({ mode: "building", matchedCount: 80 });
    await test.mutation(internal.viewMaterializations.process, {
      materializationId: secondReady._id,
    });
    expect(
      await admin.query(api.viewMaterializations.status, {
        viewId: fixture.viewId,
      }),
    ).toMatchObject({ mode: "ready", matchedCount: 79 });
    const afterDelete = await admin.query(
      api.viewMaterializations.listPage,
      {
        viewId: fixture.viewId,
        materializationId: secondReady._id,
        paginationOpts: { cursor: null, numItems: 1 },
      },
    );
    expect(afterDelete.page[0]?.viewGroupCount).toBe(79);

    await test.run(async (ctx) => {
      const record = (await ctx.db.get(changingRecord))!;
      await ctx.db.patch(record._id, {
        status: "active",
        revision: record.revision + 1,
      });
    });
    await emitRecordChange(test, {
      baseId: fixture.baseId,
      tableId: fixture.tableId,
      recordId: changingRecord,
    });
    await test.mutation(internal.viewMaterializations.process, {
      materializationId: secondReady._id,
    });
    expect(
      await admin.query(api.viewMaterializations.status, {
        viewId: fixture.viewId,
      }),
    ).toMatchObject({ mode: "ready", matchedCount: 80 });
    const afterRestore = await admin.query(
      api.viewMaterializations.listPage,
      {
        viewId: fixture.viewId,
        materializationId: secondReady._id,
        paginationOpts: { cursor: null, numItems: 1 },
      },
    );
    expect(afterRestore.page[0]?.viewGroupCount).toBe(80);
  });

  it("keeps personal materializations private", async () => {
    const test = setup();
    const fixture = await insertFixture(test);
    const admin = test.withIdentity(adminIdentity);
    const member = test.withIdentity(memberIdentity);
    await test.run(async (ctx) => {
      await ctx.db.patch(fixture.viewId, {
        visibility: "personal",
        ownerUserId: adminIdentity.subject,
      });
    });
    expect(
      await admin.mutation(api.viewMaterializations.ensure, {
        viewId: fixture.viewId,
      }),
    ).toMatchObject({ mode: "building" });
    await expect(
      member.mutation(api.viewMaterializations.ensure, {
        viewId: fixture.viewId,
      }),
    ).rejects.toThrow(/VIEW_NOT_AVAILABLE/);
  });

  it("rebuilds a legacy grouped generation once and keeps the migration idempotent", async () => {
    const test = setup();
    const fixture = await insertFixture(test);
    const admin = test.withIdentity(adminIdentity);
    const legacyId = await test.run((ctx) =>
      ctx.db.insert("viewMaterializations", {
        orgId,
        baseId: fixture.baseId,
        tableId: fixture.tableId,
        viewId: fixture.viewId,
        viewRevision: 1,
        generation: "legacy-without-normalized-group-counts",
        status: "active",
        phase: "catchup",
        scanCursor: null,
        indexedDataRevision: 0,
        matchedCount: 149,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    expect(
      await admin.query(api.viewMaterializations.status, {
        viewId: fixture.viewId,
      }),
    ).toMatchObject({ mode: "building" });
    await admin.mutation(api.viewMaterializations.ensure, {
      viewId: fixture.viewId,
    });
    await admin.mutation(api.viewMaterializations.ensure, {
      viewId: fixture.viewId,
    });
    const replacement = await test.run((ctx) =>
      ctx.db
        .query("viewMaterializations")
        .withIndex("by_view_and_status", (q) =>
          q.eq("viewId", fixture.viewId).eq("status", "building"),
        )
        .unique(),
    );
    expect(replacement).not.toBeNull();
    const ready = await finishMaterialization(test, replacement!._id);
    expect(ready).toMatchObject({
      groupCountsReady: true,
      matchedCount: 149,
      status: "active",
    });
    const counts = await test.run((ctx) =>
      ctx.db
        .query("viewGroupCounts")
        .withIndex("by_materialization", (q) =>
          q.eq("materializationId", ready._id),
        )
        .collect(),
    );
    expect(
      Object.fromEntries(
        counts.map((group) => [group.groupLabel, group.count]),
      ),
    ).toEqual({
      "Stage: Approved": 74,
      "Stage: New": 75,
    });
    expect((await test.run((ctx) => ctx.db.get(legacyId)))?.status).toBe(
      "retired",
    );
    expect(
      await admin.mutation(api.viewMaterializations.ensure, {
        viewId: fixture.viewId,
      }),
    ).toMatchObject({
      materializationId: ready._id,
      mode: "ready",
    });
    expect(
      await test.run((ctx) =>
        ctx.db
          .query("viewMaterializations")
          .withIndex("by_view_and_status", (q) =>
            q.eq("viewId", fixture.viewId).eq("status", "building"),
          )
          .collect(),
      ),
    ).toHaveLength(0);
  });
});
