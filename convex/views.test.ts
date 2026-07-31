/// <reference types="vite/client" />

import migrationsTest from "@convex-dev/migrations/test";
import { convexTest } from "convex-test";
import type { UserIdentity } from "convex/server";
import { describe, expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import { createRank } from "./lib/data";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const orgId = "org_viewsTest123456";
const otherOrgId = "org_viewsOther123456";
const adminIdentity = {
  subject: "user_viewsAdmin123456",
  tokenIdentifier: "test|user_viewsAdmin123456",
  org_id: orgId,
  org_role: "org:admin",
  pla: "o:pro",
} satisfies Partial<UserIdentity> & Record<string, unknown>;
const memberIdentity = {
  ...adminIdentity,
  subject: "user_viewsMember123456",
  tokenIdentifier: "test|user_viewsMember123456",
  org_role: "org:member",
} satisfies Partial<UserIdentity> & Record<string, unknown>;

function setup() {
  const test = convexTest(schema, modules);
  migrationsTest.register(test);
  return test;
}

async function insertTableFixture(
  test: ReturnType<typeof setup>,
  options?: {
    orgId?: string;
    tableName?: string;
    tableStatus?: "active" | "deleted";
  },
) {
  const fixtureOrgId = options?.orgId ?? orgId;
  return await test.run(async (ctx) => {
    const now = Date.now();
    const baseId = await ctx.db.insert("bases", {
      orgId: fixtureOrgId,
      name: `${options?.tableName ?? "Projects"} base`,
      rank: createRank(),
      status: "active",
      createdByUserId: adminIdentity.subject,
      updatedAt: now,
    });
    const tableId = await ctx.db.insert("tables", {
      orgId: fixtureOrgId,
      baseId,
      name: options?.tableName ?? "Projects",
      rank: createRank(),
      status: options?.tableStatus ?? "active",
      createdByUserId: adminIdentity.subject,
      updatedAt: now,
      deletedAt:
        options?.tableStatus === "deleted" ? now : undefined,
    });
    const primaryFieldId = await ctx.db.insert("fields", {
      orgId: fixtureOrgId,
      baseId,
      tableId,
      name: "Name",
      type: "singleLineText",
      config: { maxLength: 10_000 },
      rank: createRank(),
      width: 240,
      isPrimary: true,
      status: "active",
      revision: 1,
      createdByUserId: adminIdentity.subject,
      updatedAt: now,
    });
    const primary = (await ctx.db.get(primaryFieldId))!;
    const statusFieldId = await ctx.db.insert("fields", {
      orgId: fixtureOrgId,
      baseId,
      tableId,
      name: "Status",
      type: "singleSelect",
      config: {
        options: [
          { id: "planned", label: "Planned", color: "#64748B" },
          { id: "live", label: "Live", color: "#10B981" },
        ],
      },
      rank: createRank(primary.rank),
      width: 180,
      isPrimary: false,
      status: "active",
      revision: 1,
      createdByUserId: adminIdentity.subject,
      updatedAt: now,
    });
    const status = (await ctx.db.get(statusFieldId))!;
    const notesFieldId = await ctx.db.insert("fields", {
      orgId: fixtureOrgId,
      baseId,
      tableId,
      name: "Notes",
      type: "longText",
      config: { maxLength: 50_000 },
      rank: createRank(status.rank),
      width: 300,
      isPrimary: false,
      status: "active",
      revision: 1,
      createdByUserId: adminIdentity.subject,
      updatedAt: now,
    });
    await ctx.db.patch(tableId, { primaryFieldId });
    return {
      baseId,
      tableId,
      primaryFieldId,
      statusFieldId,
      notesFieldId,
    };
  });
}

describe("views", () => {
  it("creates organization-scoped views and resolves ordered field configs", async () => {
    const test = setup();
    const fixture = await insertTableFixture(test);
    const admin = test.withIdentity(adminIdentity);
    const member = test.withIdentity(memberIdentity);

    await expect(
      test.query(api.views.list, { tableId: fixture.tableId }),
    ).rejects.toThrow();

    const created = await admin.mutation(api.views.create, {
      tableId: fixture.tableId,
      name: "Launch plan",
      type: "grid",
      visibility: "collaborators",
      configuration: { rowHeight: "medium" },
    });
    expect(created.revision).toBe(1);

    const resolved = await member.query(api.views.get, {
      tableId: fixture.tableId,
    });
    expect(resolved?.view._id).toBe(created.viewId);
    expect(resolved?.fieldConfigs.map((config) => config.fieldId)).toEqual([
      fixture.primaryFieldId,
      fixture.statusFieldId,
      fixture.notesFieldId,
    ]);
    expect(resolved?.fieldConfigs[0]).toMatchObject({
      hidden: false,
      frozen: true,
      width: 240,
    });
    await expect(
      member.mutation(api.views.create, {
        tableId: fixture.tableId,
        name: "Unauthorized view",
        type: "grid",
        visibility: "collaborators",
      }),
    ).rejects.toThrow();

    const personal = await admin.mutation(api.views.create, {
      tableId: fixture.tableId,
      name: "My triage",
      type: "grid",
      visibility: "personal",
    });
    expect(
      (await admin.query(api.views.list, { tableId: fixture.tableId })).map(
        (view) => view._id,
      ),
    ).toContain(personal.viewId);
    expect(
      (await member.query(api.views.list, { tableId: fixture.tableId })).map(
        (view) => view._id,
      ),
    ).not.toContain(personal.viewId);

    const outsider = test.withIdentity({
      ...adminIdentity,
      subject: "user_viewsOutsider123456",
      tokenIdentifier: "test|user_viewsOutsider123456",
      org_id: otherOrgId,
    });
    await expect(
      outsider.query(api.views.get, { tableId: fixture.tableId }),
    ).rejects.toThrow();
  });

  it("checks revisions and validates configuration field ownership", async () => {
    const test = setup();
    const fixture = await insertTableFixture(test);
    const otherTable = await insertTableFixture(test, {
      tableName: "Other projects",
    });
    const admin = test.withIdentity(adminIdentity);
    const created = await admin.mutation(api.views.create, {
      tableId: fixture.tableId,
      name: "All projects",
      type: "grid",
      visibility: "collaborators",
    });

    const updated = await admin.mutation(api.views.update, {
      viewId: created.viewId,
      expectedRevision: 1,
      name: "Current projects",
    });
    expect(updated.revision).toBe(2);
    await expect(
      admin.mutation(api.views.update, {
        viewId: created.viewId,
        expectedRevision: 1,
        name: "Stale write",
      }),
    ).rejects.toThrow();

    await expect(
      admin.mutation(api.views.update, {
        viewId: created.viewId,
        expectedRevision: 2,
        filters: [
          {
            id: "other-table-filter",
            fieldId: otherTable.primaryFieldId,
            operator: "contains",
            value: "launch",
          },
        ],
      }),
    ).rejects.toThrow();
    expect(
      (
        await admin.query(api.views.get, {
          tableId: fixture.tableId,
          viewId: created.viewId,
        })
      )?.view.revision,
    ).toBe(2);
  });

  it("persists named alternative-view settings and validates card columns", async () => {
    const test = setup();
    const fixture = await insertTableFixture(test);
    const otherTable = await insertTableFixture(test, {
      tableName: "Other work",
    });
    const { coverFieldId, dateFieldId } = await test.run(async (ctx) => {
      const now = Date.now();
      const notes = (await ctx.db.get(fixture.notesFieldId))!;
      const dateFieldId = await ctx.db.insert("fields", {
        orgId,
        baseId: fixture.baseId,
        tableId: fixture.tableId,
        name: "Launch date",
        type: "date",
        config: { dateStyle: "dateTime" },
        rank: createRank(notes.rank),
        width: 180,
        isPrimary: false,
        status: "active",
        revision: 1,
        createdByUserId: adminIdentity.subject,
        updatedAt: now,
      });
      const dateField = (await ctx.db.get(dateFieldId))!;
      const coverFieldId = await ctx.db.insert("fields", {
        orgId,
        baseId: fixture.baseId,
        tableId: fixture.tableId,
        name: "Cover image",
        type: "attachment",
        config: { attachmentKind: "image" },
        rank: createRank(dateField.rank),
        width: 220,
        isPrimary: false,
        status: "active",
        revision: 1,
        createdByUserId: adminIdentity.subject,
        updatedAt: now,
      });
      return { coverFieldId, dateFieldId };
    });
    const admin = test.withIdentity(adminIdentity);

    const kanban = await admin.mutation(api.views.create, {
      tableId: fixture.tableId,
      name: "Delivery board",
      type: "kanban",
      visibility: "collaborators",
      configuration: {
        kanbanFieldId: fixture.statusFieldId,
        kanbanSummaryFieldIds: [
          fixture.notesFieldId,
          dateFieldId,
        ],
      },
    });
    const calendar = await admin.mutation(api.views.create, {
      tableId: fixture.tableId,
      name: "Launch calendar",
      type: "calendar",
      visibility: "collaborators",
      configuration: {
        calendarDateFieldId: dateFieldId,
        calendarDisplay: "agenda",
      },
    });
    const gallery = await admin.mutation(api.views.create, {
      tableId: fixture.tableId,
      name: "Launch gallery",
      type: "gallery",
      visibility: "collaborators",
      configuration: {
        galleryCoverFieldId: coverFieldId,
        gallerySummaryFieldIds: [
          fixture.statusFieldId,
          fixture.notesFieldId,
        ],
      },
    });

    const saved = await admin.query(api.views.list, {
      tableId: fixture.tableId,
      includeArchived: true,
    });
    expect(
      saved.find((view) => view._id === kanban.viewId)?.configuration,
    ).toMatchObject({
      kanbanFieldId: fixture.statusFieldId,
      kanbanSummaryFieldIds: [
        fixture.notesFieldId,
        dateFieldId,
      ],
    });
    expect(
      saved.find((view) => view._id === calendar.viewId)?.configuration,
    ).toMatchObject({
      calendarDateFieldId: dateFieldId,
      calendarDisplay: "agenda",
    });
    expect(
      saved.find((view) => view._id === gallery.viewId)?.configuration,
    ).toMatchObject({
      galleryCoverFieldId: coverFieldId,
      gallerySummaryFieldIds: [
        fixture.statusFieldId,
        fixture.notesFieldId,
      ],
    });

    await expect(
      admin.mutation(api.views.update, {
        viewId: kanban.viewId,
        expectedRevision: 1,
        configuration: {
          kanbanFieldId: fixture.statusFieldId,
          kanbanSummaryFieldIds: [
            fixture.notesFieldId,
            fixture.notesFieldId,
          ],
        },
      }),
    ).rejects.toThrow();
    await expect(
      admin.mutation(api.views.update, {
        viewId: gallery.viewId,
        expectedRevision: 1,
        configuration: {
          gallerySummaryFieldIds: [otherTable.notesFieldId],
        },
      }),
    ).rejects.toThrow();
  });

  it("updates and reorders per-view field settings without exposing ranks", async () => {
    const test = setup();
    const fixture = await insertTableFixture(test);
    const admin = test.withIdentity(adminIdentity);
    const created = await admin.mutation(api.views.create, {
      tableId: fixture.tableId,
      name: "Delivery",
      type: "grid",
      visibility: "collaborators",
    });

    const resized = await admin.mutation(api.views.updateFieldConfig, {
      viewId: created.viewId,
      fieldId: fixture.notesFieldId,
      expectedRevision: 1,
      width: 42,
      hidden: true,
      formatting: { wrap: true, color: "#A855F7" },
    });
    expect(resized).toMatchObject({
      revision: 2,
      fieldConfig: {
        width: 100,
        hidden: true,
        formatting: { wrap: true, color: "#A855F7" },
      },
    });
    await expect(
      admin.mutation(api.views.updateFieldConfig, {
        viewId: created.viewId,
        fieldId: fixture.primaryFieldId,
        expectedRevision: 2,
        hidden: true,
      }),
    ).rejects.toThrow();

    const reordered = await admin.mutation(api.views.reorderField, {
      viewId: created.viewId,
      fieldId: fixture.notesFieldId,
      expectedRevision: 2,
      afterFieldId: fixture.primaryFieldId,
      beforeFieldId: fixture.statusFieldId,
    });
    expect(reordered.revision).toBe(3);
    const resolved = await admin.query(api.views.get, {
      tableId: fixture.tableId,
      viewId: created.viewId,
    });
    expect(resolved?.fieldConfigs.map((config) => config.fieldId)).toEqual([
      fixture.primaryFieldId,
      fixture.notesFieldId,
      fixture.statusFieldId,
    ]);
  });

  it("switches and replaces defaults while protecting the last view", async () => {
    const test = setup();
    const fixture = await insertTableFixture(test);
    const admin = test.withIdentity(adminIdentity);
    const first = await admin.mutation(api.views.create, {
      tableId: fixture.tableId,
      name: "Primary grid",
      type: "grid",
      visibility: "collaborators",
    });
    const second = await admin.mutation(api.views.create, {
      tableId: fixture.tableId,
      name: "Planning grid",
      type: "grid",
      visibility: "collaborators",
      afterViewId: first.viewId,
    });
    const personal = await admin.mutation(api.views.create, {
      tableId: fixture.tableId,
      name: "Private notes",
      type: "grid",
      visibility: "personal",
    });

    await expect(
      admin.mutation(api.views.setDefault, {
        viewId: personal.viewId,
        expectedRevision: 1,
      }),
    ).rejects.toThrow();

    const defaulted = await admin.mutation(api.views.setDefault, {
      viewId: second.viewId,
      expectedRevision: 1,
    });
    expect(defaulted.revision).toBe(2);
    const removed = await admin.mutation(api.views.remove, {
      viewId: second.viewId,
      expectedRevision: 2,
    });
    expect(removed.defaultViewId).toBe(first.viewId);

    const state = await test.run(async (ctx) => ({
      table: await ctx.db.get(fixture.tableId),
      first: await ctx.db.get(first.viewId),
      removedConfigs: await ctx.db
        .query("viewFieldConfigs")
        .withIndex("by_view_and_rank", (q) =>
          q.eq("viewId", second.viewId),
        )
        .take(10),
    }));
    expect(state.table?.defaultViewId).toBe(first.viewId);
    expect(state.first?.isDefault).toBe(true);
    expect(state.removedConfigs).toHaveLength(0);

    await admin.mutation(api.views.remove, {
      viewId: personal.viewId,
      expectedRevision: 1,
    });
    await expect(
      admin.mutation(api.views.remove, {
        viewId: first.viewId,
        expectedRevision: state.first!.revision,
      }),
    ).rejects.toThrow();
  });

  it("reconciles columns added while a view was archived", async () => {
    const test = setup();
    const fixture = await insertTableFixture(test);
    const admin = test.withIdentity(adminIdentity);
    await admin.mutation(api.views.create, {
      tableId: fixture.tableId,
      name: "Default grid",
      type: "grid",
      visibility: "collaborators",
    });
    const archivedView = await admin.mutation(api.views.create, {
      tableId: fixture.tableId,
      name: "Quarterly archive",
      type: "grid",
      visibility: "collaborators",
    });
    const archived = await admin.mutation(api.views.update, {
      viewId: archivedView.viewId,
      expectedRevision: 1,
      status: "archived",
    });

    const addedFieldId = await test.run(async (ctx) => {
      const notes = (await ctx.db.get(fixture.notesFieldId))!;
      return await ctx.db.insert("fields", {
        orgId,
        baseId: fixture.baseId,
        tableId: fixture.tableId,
        name: "Owner",
        type: "email",
        config: {},
        rank: createRank(notes.rank),
        width: 220,
        isPrimary: false,
        status: "active",
        revision: 1,
        createdByUserId: adminIdentity.subject,
        updatedAt: Date.now(),
      });
    });
    const beforeRestore = await test.run(async (ctx) =>
      ctx.db
        .query("viewFieldConfigs")
        .withIndex("by_view_and_field", (q) =>
          q
            .eq("viewId", archivedView.viewId)
            .eq("fieldId", addedFieldId),
        )
        .unique(),
    );
    expect(beforeRestore).toBeNull();

    const restored = await admin.mutation(api.views.update, {
      viewId: archivedView.viewId,
      expectedRevision: archived.revision,
      status: "active",
    });
    expect(restored.revision).toBe(3);
    const resolved = await admin.query(api.views.get, {
      tableId: fixture.tableId,
      viewId: archivedView.viewId,
    });
    expect(
      resolved?.fieldConfigs.some(
        (config) => config.fieldId === addedFieldId,
      ),
    ).toBe(true);
  });

  it("duplicates a named view with its saved column setup and reorders it", async () => {
    const test = setup();
    const fixture = await insertTableFixture(test);
    const admin = test.withIdentity(adminIdentity);
    const first = await admin.mutation(api.views.create, {
      tableId: fixture.tableId,
      name: "All projects",
      type: "grid",
      visibility: "collaborators",
    });
    const second = await admin.mutation(api.views.create, {
      tableId: fixture.tableId,
      name: "Launch schedule",
      type: "grid",
      visibility: "collaborators",
      afterViewId: first.viewId,
    });
    const customized = await admin.mutation(api.views.updateFieldConfig, {
      viewId: second.viewId,
      fieldId: fixture.notesFieldId,
      expectedRevision: second.revision,
      width: 410,
      hidden: true,
      formatting: { wrap: true, color: "#7C3AED" },
    });

    const duplicated = await admin.mutation(api.views.duplicate, {
      sourceViewId: second.viewId,
      expectedRevision: customized.revision,
      name: "Launch schedule copy",
    });
    const duplicateState = await admin.query(api.views.get, {
      tableId: fixture.tableId,
      viewId: duplicated.viewId,
    });
    expect(duplicateState?.view).toMatchObject({
      name: "Launch schedule copy",
      isDefault: false,
      type: "grid",
      visibility: "collaborators",
    });
    expect(
      duplicateState?.fieldConfigs.find(
        (config) => config.fieldId === fixture.notesFieldId,
      ),
    ).toMatchObject({
      width: 410,
      hidden: true,
      formatting: { wrap: true, color: "#7C3AED" },
    });

    const reordered = await admin.mutation(api.views.reorder, {
      viewId: duplicated.viewId,
      expectedRevision: duplicated.revision,
      beforeViewId: first.viewId,
    });
    expect(reordered.revision).toBe(2);
    const ordered = await admin.query(api.views.list, {
      tableId: fixture.tableId,
    });
    expect(ordered.map((view) => view.name)).toEqual([
      "Launch schedule copy",
      "All projects",
      "Launch schedule",
    ]);
  });
});

describe("per-user view preferences", () => {
  it("isolates favorites by organization and user while enforcing view access", async () => {
    const test = setup();
    const fixture = await insertTableFixture(test);
    const admin = test.withIdentity(adminIdentity);
    const member = test.withIdentity(memberIdentity);
    const shared = await admin.mutation(api.views.create, {
      tableId: fixture.tableId,
      name: "Shared delivery",
      type: "grid",
      visibility: "collaborators",
    });
    const personal = await admin.mutation(api.views.create, {
      tableId: fixture.tableId,
      name: "Admin notes",
      type: "grid",
      visibility: "personal",
    });
    const accessRevoked = await admin.mutation(api.views.create, {
      tableId: fixture.tableId,
      name: "Temporary shared view",
      type: "grid",
      visibility: "collaborators",
    });

    await admin.mutation(api.views.setFavorite, {
      viewId: shared.viewId,
      favorite: true,
    });
    await admin.mutation(api.views.setFavorite, {
      viewId: personal.viewId,
      favorite: true,
    });
    await member.mutation(api.views.setFavorite, {
      viewId: shared.viewId,
      favorite: true,
    });
    await member.mutation(api.views.setFavorite, {
      viewId: accessRevoked.viewId,
      favorite: true,
    });
    await admin.mutation(api.views.update, {
      viewId: accessRevoked.viewId,
      expectedRevision: accessRevoked.revision,
      visibility: "personal",
    });
    await expect(
      member.mutation(api.views.setFavorite, {
        viewId: personal.viewId,
        favorite: true,
      }),
    ).rejects.toThrow(/VIEW_NOT_FOUND/);

    const [adminPreferences, memberPreferences] = await Promise.all([
      admin.query(api.views.listPreferences, {
        tableId: fixture.tableId,
      }),
      member.query(api.views.listPreferences, {
        tableId: fixture.tableId,
      }),
    ]);
    expect(adminPreferences).toEqual([
      {
        viewId: shared.viewId,
        isFavorite: true,
        lastOpenedAt: null,
      },
      {
        viewId: personal.viewId,
        isFavorite: true,
        lastOpenedAt: null,
      },
    ]);
    expect(memberPreferences).toEqual([
      {
        viewId: shared.viewId,
        isFavorite: true,
        lastOpenedAt: null,
      },
    ]);

    const stored = await test.run(async (ctx) =>
      ctx.db.query("viewPreferences").take(10),
    );
    expect(stored).toHaveLength(4);
    expect(
      new Set(stored.map((preference) => preference.userIdentityKey)),
    ).toEqual(
      new Set([
        adminIdentity.tokenIdentifier,
        memberIdentity.tokenIdentifier,
      ]),
    );

    const outsider = test.withIdentity({
      ...adminIdentity,
      subject: "user_viewPreferenceOutsider123456",
      tokenIdentifier: "test|user_viewPreferenceOutsider123456",
      org_id: otherOrgId,
    });
    await expect(
      outsider.query(api.views.listPreferences, {
        tableId: fixture.tableId,
      }),
    ).rejects.toThrow();
    await expect(
      outsider.mutation(api.views.setFavorite, {
        viewId: shared.viewId,
        favorite: true,
      }),
    ).rejects.toThrow();
  });

  it("toggles favorites without losing the user's last-opened timestamp", async () => {
    const test = setup();
    const fixture = await insertTableFixture(test);
    const admin = test.withIdentity(adminIdentity);
    const first = await admin.mutation(api.views.create, {
      tableId: fixture.tableId,
      name: "Delivery",
      type: "grid",
      visibility: "collaborators",
    });
    const second = await admin.mutation(api.views.create, {
      tableId: fixture.tableId,
      name: "Capacity",
      type: "grid",
      visibility: "collaborators",
    });

    expect(
      await admin.mutation(api.views.setFavorite, {
        viewId: first.viewId,
        favorite: true,
      }),
    ).toEqual({
      viewId: first.viewId,
      isFavorite: true,
      lastOpenedAt: null,
    });
    const opened = await admin.mutation(api.views.recordOpened, {
      viewId: first.viewId,
    });
    const unfavorited = await admin.mutation(api.views.setFavorite, {
      viewId: first.viewId,
      favorite: false,
    });
    expect(unfavorited).toEqual({
      viewId: first.viewId,
      isFavorite: false,
      lastOpenedAt: opened.lastOpenedAt,
    });

    await admin.mutation(api.views.setFavorite, {
      viewId: second.viewId,
      favorite: true,
    });
    await admin.mutation(api.views.setFavorite, {
      viewId: second.viewId,
      favorite: false,
    });
    expect(
      await admin.query(api.views.listPreferences, {
        tableId: fixture.tableId,
      }),
    ).toEqual([
      {
        viewId: first.viewId,
        isFavorite: false,
        lastOpenedAt: opened.lastOpenedAt,
      },
    ]);
  });

  it("returns recently opened accessible views in strict newest-first order", async () => {
    const test = setup();
    const fixture = await insertTableFixture(test);
    const admin = test.withIdentity(adminIdentity);
    const member = test.withIdentity(memberIdentity);
    const first = await admin.mutation(api.views.create, {
      tableId: fixture.tableId,
      name: "Launch plan",
      type: "grid",
      visibility: "collaborators",
    });
    const second = await admin.mutation(api.views.create, {
      tableId: fixture.tableId,
      name: "Release calendar",
      type: "grid",
      visibility: "collaborators",
    });
    const neverOpened = await admin.mutation(api.views.create, {
      tableId: fixture.tableId,
      name: "Favorite only",
      type: "grid",
      visibility: "collaborators",
    });
    await admin.mutation(api.views.setFavorite, {
      viewId: neverOpened.viewId,
      favorite: true,
    });

    const firstOpen = await admin.mutation(api.views.recordOpened, {
      viewId: first.viewId,
    });
    const secondOpen = await admin.mutation(api.views.recordOpened, {
      viewId: second.viewId,
    });
    const reopened = await admin.mutation(api.views.recordOpened, {
      viewId: first.viewId,
    });
    expect(reopened.lastOpenedAt).toBeGreaterThan(secondOpen.lastOpenedAt!);
    expect(secondOpen.lastOpenedAt).toBeGreaterThan(firstOpen.lastOpenedAt!);

    const recents = await admin.query(api.views.listRecent, { limit: 10 });
    expect(recents.map((recent) => recent.name)).toEqual([
      "Launch plan",
      "Release calendar",
    ]);
    expect(
      (
        await admin.query(api.views.listRecent, {
          limit: 1,
        })
      ).map((recent) => recent.viewId),
    ).toEqual([first.viewId]);

    await member.mutation(api.views.recordOpened, {
      viewId: second.viewId,
    });
    expect(
      (await member.query(api.views.listRecent, {})).map(
        (recent) => recent.viewId,
      ),
    ).toEqual([second.viewId]);
  });

  it("reopens each user's latest accessible view before falling back to the table default", async () => {
    const test = setup();
    const fixture = await insertTableFixture(test);
    const admin = test.withIdentity(adminIdentity);
    const member = test.withIdentity(memberIdentity);
    const defaultView = await admin.mutation(api.views.create, {
      tableId: fixture.tableId,
      name: "Default grid",
      type: "grid",
      visibility: "collaborators",
    });
    const recentlyOpened = await admin.mutation(api.views.create, {
      tableId: fixture.tableId,
      name: "My recent work",
      type: "grid",
      visibility: "collaborators",
    });
    const privateView = await admin.mutation(api.views.create, {
      tableId: fixture.tableId,
      name: "Admin notes",
      type: "grid",
      visibility: "personal",
    });

    await admin.mutation(api.views.recordOpened, {
      viewId: recentlyOpened.viewId,
    });
    expect(
      (
        await admin.query(api.views.get, {
          tableId: fixture.tableId,
        })
      )?.view._id,
    ).toBe(recentlyOpened.viewId);
    expect(
      (
        await admin.query(api.views.get, {
          tableId: fixture.tableId,
          viewId: defaultView.viewId,
        })
      )?.view._id,
    ).toBe(defaultView.viewId);

    expect(
      (
        await member.query(api.views.get, {
          tableId: fixture.tableId,
        })
      )?.view._id,
    ).toBe(defaultView.viewId);

    await test.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("viewPreferences", {
        orgId,
        userIdentityKey: memberIdentity.tokenIdentifier,
        baseId: fixture.baseId,
        tableId: fixture.tableId,
        viewId: privateView.viewId,
        isFavorite: false,
        lastOpenedAt: now + 1,
        updatedAt: now + 1,
      });
      await ctx.db.insert("viewPreferences", {
        orgId,
        userIdentityKey: memberIdentity.tokenIdentifier,
        baseId: fixture.baseId,
        tableId: fixture.tableId,
        viewId: recentlyOpened.viewId,
        isFavorite: false,
        lastOpenedAt: now,
        updatedAt: now,
      });
    });
    expect(
      (
        await member.query(api.views.get, {
          tableId: fixture.tableId,
        })
      )?.view._id,
    ).toBe(recentlyOpened.viewId);

    await test.run(async (ctx) => {
      await ctx.db.patch(recentlyOpened.viewId, {
        status: "archived",
        archivedAt: Date.now(),
      });
    });
    expect(
      (
        await member.query(api.views.get, {
          tableId: fixture.tableId,
        })
      )?.view._id,
    ).toBe(defaultView.viewId);
  });
});

describe("view migrations", () => {
  it("backfills active tables and missing field configs idempotently", async () => {
    const test = setup();
    const first = await insertTableFixture(test, {
      tableName: "Legacy table",
    });
    const second = await insertTableFixture(test, {
      tableName: "Partially migrated table",
    });
    const deleted = await insertTableFixture(test, {
      tableName: "Deleted table",
      tableStatus: "deleted",
    });

    const existingViewId = await test.run(async (ctx) => {
      const table = (await ctx.db.get(second.tableId))!;
      const viewId = await ctx.db.insert("views", {
        orgId,
        baseId: table.baseId,
        tableId: table._id,
        name: "Existing grid",
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
        createdByUserId: adminIdentity.subject,
        updatedAt: Date.now(),
      });
      await ctx.db.patch(table._id, { defaultViewId: viewId });
      return viewId;
    });

    await test.mutation(internal.migrations.backfillDefaultViews, {
      cursor: null,
      dryRun: false,
      oneBatchOnly: true,
    });
    await test.mutation(internal.migrations.backfillViewFieldConfigs, {
      cursor: null,
      dryRun: false,
      oneBatchOnly: true,
    });

    const afterFirstRun = await test.run(async (ctx) => ({
      firstViews: await ctx.db
        .query("views")
        .withIndex("by_table_and_status_and_rank", (q) =>
          q.eq("tableId", first.tableId).eq("status", "active"),
        )
        .take(10),
      secondViews: await ctx.db
        .query("views")
        .withIndex("by_table_and_status_and_rank", (q) =>
          q.eq("tableId", second.tableId).eq("status", "active"),
        )
        .take(10),
      deletedViews: await ctx.db
        .query("views")
        .withIndex("by_table_and_status_and_rank", (q) =>
          q.eq("tableId", deleted.tableId).eq("status", "active"),
        )
        .take(10),
      existingConfigs: await ctx.db
        .query("viewFieldConfigs")
        .withIndex("by_view_and_rank", (q) =>
          q.eq("viewId", existingViewId),
        )
        .take(10),
    }));
    expect(afterFirstRun.firstViews).toHaveLength(1);
    expect(afterFirstRun.secondViews).toHaveLength(1);
    expect(afterFirstRun.deletedViews).toHaveLength(0);
    expect(afterFirstRun.existingConfigs).toHaveLength(3);

    await test.mutation(internal.migrations.backfillDefaultViews, {
      reset: true,
      cursor: null,
      dryRun: false,
      oneBatchOnly: true,
    });
    await test.mutation(internal.migrations.backfillViewFieldConfigs, {
      reset: true,
      cursor: null,
      dryRun: false,
      oneBatchOnly: true,
    });

    const afterReset = await test.run(async (ctx) => ({
      views: await ctx.db.query("views").take(20),
      configs: await ctx.db.query("viewFieldConfigs").take(50),
    }));
    expect(afterReset.views).toHaveLength(2);
    expect(afterReset.configs).toHaveLength(6);
  });
});
