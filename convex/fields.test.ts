/// <reference types="vite/client" />

import aggregateTest from "@convex-dev/aggregate/test";
import { convexTest } from "convex-test";
import type { UserIdentity } from "convex/server";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createRank } from "./lib/data";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const orgId = "org_fieldsTest123456";
const otherOrgId = "org_fieldsOther123456";
const adminIdentity = {
  subject: "user_fieldsAdmin123456",
  tokenIdentifier: "test|user_fieldsAdmin123456",
  org_id: orgId,
  org_role: "org:admin",
  pla: "o:pro",
} satisfies Partial<UserIdentity> & Record<string, unknown>;
const memberIdentity = {
  ...adminIdentity,
  subject: "user_fieldsMember123456",
  tokenIdentifier: "test|user_fieldsMember123456",
  org_role: "org:member",
} satisfies Partial<UserIdentity> & Record<string, unknown>;
const otherAdminIdentity = {
  ...adminIdentity,
  subject: "user_fieldsOtherAdmin123456",
  tokenIdentifier: "test|user_fieldsOtherAdmin123456",
  org_id: otherOrgId,
} satisfies Partial<UserIdentity> & Record<string, unknown>;

function setup() {
  const test = convexTest(schema, modules);
  aggregateTest.register(test, "fieldCount");
  return test;
}

async function insertTableFixture(
  test: ReturnType<typeof setup>,
  options?: {
    fixtureOrgId?: string;
    tableName?: string;
  },
) {
  const fixtureOrgId = options?.fixtureOrgId ?? orgId;
  const tableName = options?.tableName ?? "Projects";
  return await test.run(async (ctx) => {
    const now = Date.now();
    const baseId = await ctx.db.insert("bases", {
      orgId: fixtureOrgId,
      name: `${tableName} base`,
      rank: createRank(),
      status: "active",
      createdByUserId: adminIdentity.subject,
      updatedAt: now,
    });
    const tableId = await ctx.db.insert("tables", {
      orgId: fixtureOrgId,
      baseId,
      name: tableName,
      rank: createRank(),
      status: "active",
      createdByUserId: adminIdentity.subject,
      updatedAt: now,
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
    await ctx.db.patch(tableId, { primaryFieldId });
    return { baseId, tableId, primaryFieldId };
  });
}

async function createNotesField(
  admin: ReturnType<ReturnType<typeof setup>["withIdentity"]>,
  tableId: Id<"tables">,
  name = "Notes",
) {
  return await admin.mutation(api.fields.create, {
    tableId,
    name,
    type: "longText",
    config: { maxLength: 50_000 },
  });
}

async function insertDraftFormReference(
  test: ReturnType<typeof setup>,
  args: {
    fixtureOrgId: string;
    baseId: Id<"bases">;
    tableId: Id<"tables">;
    targetFieldId: Id<"fields">;
    name: string;
  },
) {
  return await test.run(async (ctx) => {
    const now = Date.now();
    const formId = await ctx.db.insert("forms", {
      orgId: args.fixtureOrgId,
      baseId: args.baseId,
      tableId: args.tableId,
      name: args.name,
      slug: `${args.name.toLowerCase().replaceAll(" ", "-")}-${crypto.randomUUID()}`,
      title: args.name,
      description: "",
      rank: createRank(),
      status: "draft",
      appearance: {
        primaryColor: "#2563eb",
        backgroundColor: "#ffffff",
        submitLabel: "Submit",
        showPoweredBy: true,
      },
      thankYou: {
        title: "Thank you",
        message: "Your response has been recorded.",
      },
      draftRevision: 1,
      createdByUserId: adminIdentity.subject,
      updatedAt: now,
    });
    const referenceId = await ctx.db.insert("formDraftFields", {
      orgId: args.fixtureOrgId,
      formId,
      targetFieldId: args.targetFieldId,
      label: args.name,
      required: false,
      rank: createRank(),
    });
    return { formId, referenceId };
  });
}

async function insertPublishedFormReference(
  test: ReturnType<typeof setup>,
  args: {
    fixtureOrgId: string;
    baseId: Id<"bases">;
    tableId: Id<"tables">;
    targetFieldId: Id<"fields">;
    name: string;
  },
) {
  return await test.run(async (ctx) => {
    const now = Date.now();
    const formId = await ctx.db.insert("forms", {
      orgId: args.fixtureOrgId,
      baseId: args.baseId,
      tableId: args.tableId,
      name: args.name,
      slug: `${args.name.toLowerCase().replaceAll(" ", "-")}-${crypto.randomUUID()}`,
      title: args.name,
      description: "",
      rank: createRank(),
      status: "published",
      appearance: {
        primaryColor: "#2563eb",
        backgroundColor: "#ffffff",
        submitLabel: "Submit",
        showPoweredBy: true,
      },
      thankYou: {
        title: "Thank you",
        message: "Your response has been recorded.",
      },
      draftRevision: 1,
      createdByUserId: adminIdentity.subject,
      updatedAt: now,
      publishedAt: now,
    });
    const formVersionId = await ctx.db.insert("formVersions", {
      orgId: args.fixtureOrgId,
      formId,
      baseId: args.baseId,
      tableId: args.tableId,
      version: 1,
      title: args.name,
      description: "",
      appearance: {
        primaryColor: "#2563eb",
        backgroundColor: "#ffffff",
        submitLabel: "Submit",
        showPoweredBy: true,
      },
      thankYou: {
        title: "Thank you",
        message: "Your response has been recorded.",
      },
      publishedByUserId: adminIdentity.subject,
      publishedAt: now,
    });
    await ctx.db.patch(formId, { currentPublishedVersionId: formVersionId });
    const referenceId = await ctx.db.insert("formPublishedFieldRefs", {
      orgId: args.fixtureOrgId,
      formId,
      formVersionId,
      targetFieldId: args.targetFieldId,
    });
    return { formId, formVersionId, referenceId };
  });
}

async function insertSavedViewReference(
  test: ReturnType<typeof setup>,
  args: {
    fixtureOrgId: string;
    baseId: Id<"bases">;
    tableId: Id<"tables">;
    targetFieldId: Id<"fields">;
    name: string;
    status?: "active" | "archived";
  },
) {
  return await test.run(async (ctx) => {
    const now = Date.now();
    const viewId = await ctx.db.insert("views", {
      orgId: args.fixtureOrgId,
      baseId: args.baseId,
      tableId: args.tableId,
      name: args.name,
      type: "grid",
      rank: createRank(),
      status: args.status ?? "active",
      visibility: "collaborators",
      isDefault: false,
      filterConjunction: "and",
      filters: [],
      sorts: [],
      groups: [],
      configuration: { rowHeight: "medium" },
      revision: 1,
      createdByUserId: adminIdentity.subject,
      updatedAt: now,
      archivedAt: args.status === "archived" ? now : undefined,
    });
    const configId = await ctx.db.insert("viewFieldConfigs", {
      orgId: args.fixtureOrgId,
      baseId: args.baseId,
      tableId: args.tableId,
      viewId,
      fieldId: args.targetFieldId,
      rank: createRank(),
      width: 320,
      hidden: false,
      frozen: false,
      formatting: {},
      updatedAt: now,
    });
    return { viewId, configId };
  });
}

async function insertSavedAnalysisReference(
  test: ReturnType<typeof setup>,
  args: {
    fixtureOrgId: string;
    baseId: Id<"bases">;
    tableId: Id<"tables">;
    targetFieldId: Id<"fields">;
    name: string;
    status?: "active" | "archived";
  },
) {
  return await test.run(async (ctx) => {
    const now = Date.now();
    const reportId = await ctx.db.insert("aiReports", {
      orgId: args.fixtureOrgId,
      createdByUserId: adminIdentity.subject,
      name: args.name,
      content: "Facts\nThis analysis uses the selected column.",
      scopeLabel: "Table · Projects",
      format: "report",
      citations: [],
      status: args.status ?? "active",
      createdAt: now,
      updatedAt: now,
      archivedAt: args.status === "archived" ? now : undefined,
    });
    const referenceId = await ctx.db.insert("aiReportFieldRefs", {
      orgId: args.fixtureOrgId,
      reportId,
      baseId: args.baseId,
      tableId: args.tableId,
      fieldId: args.targetFieldId,
      createdAt: now,
    });
    return { reportId, referenceId };
  });
}

describe("field names", () => {
  it("keeps active column names unique across create, rename, and restore", async () => {
    const test = setup();
    const fixture = await insertTableFixture(test);
    const admin = test.withIdentity(adminIdentity);
    const notesFieldId = await createNotesField(
      admin,
      fixture.tableId,
      "Customer notes",
    );

    await expect(
      createNotesField(admin, fixture.tableId, " customer NOTES "),
    ).rejects.toThrow(/FIELD_NAME_ALREADY_USED/);
    await expect(
      admin.mutation(api.fields.update, {
        fieldId: fixture.primaryFieldId,
        name: "CUSTOMER NOTES",
      }),
    ).rejects.toThrow(/FIELD_NAME_ALREADY_USED/);

    await admin.mutation(api.fields.archive, { fieldId: notesFieldId });
    const replacementId = await createNotesField(
      admin,
      fixture.tableId,
      " customer NOTES ",
    );
    expect(
      await test.run(async (ctx) => ctx.db.get(replacementId)),
    ).toMatchObject({ name: "customer NOTES", status: "active" });
    await expect(
      admin.mutation(api.fields.restore, { fieldId: notesFieldId }),
    ).rejects.toThrow(/FIELD_NAME_ALREADY_USED/);
  });
});

describe("field archive lifecycle", () => {
  it("returns human-readable, organization and table scoped impact", async () => {
    const test = setup();
    const fixture = await insertTableFixture(test);
    const otherTable = await insertTableFixture(test, {
      tableName: "Other table",
    });
    const foreignTable = await insertTableFixture(test, {
      fixtureOrgId: otherOrgId,
      tableName: "Foreign table",
    });
    const admin = test.withIdentity(adminIdentity);
    const member = test.withIdentity(memberIdentity);
    const otherAdmin = test.withIdentity(otherAdminIdentity);
    const notesFieldId = await createNotesField(admin, fixture.tableId);

    const draft = await insertDraftFormReference(test, {
      fixtureOrgId: orgId,
      baseId: fixture.baseId,
      tableId: fixture.tableId,
      targetFieldId: notesFieldId,
      name: "Team request",
    });
    const published = await insertPublishedFormReference(test, {
      fixtureOrgId: orgId,
      baseId: fixture.baseId,
      tableId: fixture.tableId,
      targetFieldId: notesFieldId,
      name: "Live intake",
    });
    const savedView = await insertSavedViewReference(test, {
      fixtureOrgId: orgId,
      baseId: fixture.baseId,
      tableId: fixture.tableId,
      targetFieldId: notesFieldId,
      name: "Launch board",
    });
    const savedAnalysis = await insertSavedAnalysisReference(test, {
      fixtureOrgId: orgId,
      baseId: fixture.baseId,
      tableId: fixture.tableId,
      targetFieldId: notesFieldId,
      name: "Launch health",
    });

    const wrongTableDraft = await insertDraftFormReference(test, {
      fixtureOrgId: orgId,
      baseId: otherTable.baseId,
      tableId: otherTable.tableId,
      targetFieldId: notesFieldId,
      name: "Wrong table form",
    });
    const foreignDraft = await insertDraftFormReference(test, {
      fixtureOrgId: otherOrgId,
      baseId: foreignTable.baseId,
      tableId: foreignTable.tableId,
      targetFieldId: notesFieldId,
      name: "Foreign form",
    });
    await insertSavedViewReference(test, {
      fixtureOrgId: otherOrgId,
      baseId: fixture.baseId,
      tableId: fixture.tableId,
      targetFieldId: notesFieldId,
      name: "Foreign view",
    });
    await insertSavedAnalysisReference(test, {
      fixtureOrgId: orgId,
      baseId: otherTable.baseId,
      tableId: otherTable.tableId,
      targetFieldId: notesFieldId,
      name: "Wrong table analysis",
    });
    await insertSavedAnalysisReference(test, {
      fixtureOrgId: otherOrgId,
      baseId: fixture.baseId,
      tableId: fixture.tableId,
      targetFieldId: notesFieldId,
      name: "Foreign analysis",
    });
    await insertSavedAnalysisReference(test, {
      fixtureOrgId: orgId,
      baseId: fixture.baseId,
      tableId: fixture.tableId,
      targetFieldId: notesFieldId,
      name: "Archived analysis",
      status: "archived",
    });

    const impact = await admin.query(api.fields.getArchiveImpact, {
      fieldId: notesFieldId,
    });
    expect(impact).toEqual({
      columnName: "Notes",
      canArchive: false,
      blockingReason:
        "Close or update the published forms that use this column first.",
      dependencies: [
        { category: "Published form", name: "Live intake" },
        { category: "Draft form", name: "Team request" },
        {
          category: "Saved view",
          name: "Launch board",
          effect:
            "In “Launch board”, the column display settings using “Notes” will pause while the column is archived and return when it is restored.",
        },
        { category: "Saved analysis", name: "Launch health" },
      ],
    });
    const renderedImpact = JSON.stringify(impact);
    for (const internalId of [
      notesFieldId,
      draft.formId,
      published.formId,
      savedView.viewId,
      savedAnalysis.reportId,
    ]) {
      expect(renderedImpact).not.toContain(internalId);
    }

    await expect(
      member.query(api.fields.getArchiveImpact, {
        fieldId: notesFieldId,
      }),
    ).rejects.toThrow();
    await expect(
      otherAdmin.query(api.fields.getArchiveImpact, {
        fieldId: notesFieldId,
      }),
    ).rejects.toThrow();
    await expect(
      admin.mutation(api.fields.archive, { fieldId: notesFieldId }),
    ).rejects.toThrow(/FIELD_USED_BY_PUBLISHED_FORM/);

    await test.run(async (ctx) => {
      await ctx.db.delete(published.referenceId);
    });
    const unblocked = await admin.query(api.fields.getArchiveImpact, {
      fieldId: notesFieldId,
    });
    expect(unblocked.canArchive).toBe(true);
    expect(unblocked.blockingReason).toBeNull();
    expect(unblocked.dependencies).toEqual([
      { category: "Draft form", name: "Team request" },
      {
        category: "Saved view",
        name: "Launch board",
        effect:
          "In “Launch board”, the column display settings using “Notes” will pause while the column is archived and return when it is restored.",
      },
      { category: "Saved analysis", name: "Launch health" },
    ]);

    await admin.mutation(api.fields.archive, { fieldId: notesFieldId });
    expect(
      await test.run(async (ctx) => ctx.db.get(draft.referenceId)),
    ).toBeNull();
    expect(
      await test.run(async (ctx) =>
        ctx.db.get(wrongTableDraft.referenceId),
      ),
    ).not.toBeNull();
    expect(
      await test.run(async (ctx) => ctx.db.get(foreignDraft.referenceId)),
    ).not.toBeNull();
  });

  it("names every saved view behavior that pauses while a column is archived", async () => {
    const test = setup();
    const fixture = await insertTableFixture(test);
    const admin = test.withIdentity(adminIdentity);
    const notesFieldId = await createNotesField(admin, fixture.tableId);
    const savedView = await insertSavedViewReference(test, {
      fixtureOrgId: orgId,
      baseId: fixture.baseId,
      tableId: fixture.tableId,
      targetFieldId: notesFieldId,
      name: "Operations board",
    });

    await test.run(async (ctx) => {
      await ctx.db.patch(savedView.viewId, {
        type: "gallery",
        filters: [
          {
            id: "filter-one",
            fieldId: notesFieldId,
            operator: "contains",
            value: "launch",
          },
          {
            id: "filter-two",
            fieldId: notesFieldId,
            operator: "is_not_empty",
          },
        ],
        sorts: [
          {
            id: "sort-one",
            fieldId: notesFieldId,
            direction: "asc",
            rank: createRank(),
          },
        ],
        groups: [
          {
            id: "group-one",
            fieldId: notesFieldId,
            direction: "desc",
            rank: createRank(),
          },
        ],
        configuration: {
          rowHeight: "tall",
          kanbanFieldId: notesFieldId,
          kanbanSummaryFieldIds: [notesFieldId],
          calendarDateFieldId: notesFieldId,
          calendarDisplay: "agenda",
          galleryCoverFieldId: notesFieldId,
          gallerySummaryFieldIds: [notesFieldId],
        },
      });
    });

    const effect =
      "In “Operations board”, 2 filters, the sort, the group, the Kanban lane layout, the Kanban card summary display, the calendar date layout, the gallery cover display, the gallery card summary display, and the column display settings using “Notes” will pause while the column is archived and return when it is restored.";
    const impact = await admin.query(api.fields.getArchiveImpact, {
      fieldId: notesFieldId,
    });
    expect(impact.dependencies).toEqual([
      {
        category: "Saved view",
        name: "Operations board",
        effect,
      },
    ]);

    const conversion = await admin.query(
      api.fields.previewTypeConversion,
      {
        fieldId: notesFieldId,
        newType: "singleLineText",
      },
    );
    expect(conversion.dependencies).toEqual([
      {
        category: "Saved view",
        name: "Operations board",
        effect,
      },
    ]);

    const publicCopy = JSON.stringify({ impact, conversion });
    expect(publicCopy).not.toContain(notesFieldId);
    expect(publicCopy).not.toContain(savedView.viewId);
    expect(publicCopy).not.toContain(savedView.configId);
  });

  it("archives and restores a column without losing records or saved view settings", async () => {
    const test = setup();
    const fixture = await insertTableFixture(test);
    const admin = test.withIdentity(adminIdentity);
    const member = test.withIdentity(memberIdentity);
    const notesFieldId = await createNotesField(admin, fixture.tableId);
    const draft = await insertDraftFormReference(test, {
      fixtureOrgId: orgId,
      baseId: fixture.baseId,
      tableId: fixture.tableId,
      targetFieldId: notesFieldId,
      name: "Feedback draft",
    });
    const savedView = await insertSavedViewReference(test, {
      fixtureOrgId: orgId,
      baseId: fixture.baseId,
      tableId: fixture.tableId,
      targetFieldId: notesFieldId,
      name: "Feedback triage",
    });
    const recordId = await test.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert("records", {
        orgId,
        baseId: fixture.baseId,
        tableId: fixture.tableId,
        rank: createRank(),
        values: {
          [fixture.primaryFieldId]: "Customer feedback",
          [notesFieldId]: "Keep this historical value",
        },
        status: "active",
        revision: 1,
        createdByType: "user",
        createdById: adminIdentity.subject,
        updatedByType: "user",
        updatedById: adminIdentity.subject,
        updatedAt: now,
      });
    });

    await expect(
      member.mutation(api.fields.archive, { fieldId: notesFieldId }),
    ).rejects.toThrow();
    await admin.mutation(api.fields.archive, { fieldId: notesFieldId });

    const archivedState = await test.run(async (ctx) => ({
      field: await ctx.db.get(notesFieldId),
      draftReference: await ctx.db.get(draft.referenceId),
      record: await ctx.db.get(recordId),
      viewConfig: await ctx.db.get(savedView.configId),
    }));
    expect(archivedState.field).toMatchObject({
      status: "deleted",
      revision: 2,
    });
    expect(archivedState.field?.deletedAt).toEqual(expect.any(Number));
    expect(archivedState.draftReference).toBeNull();
    expect(archivedState.record?.values[notesFieldId]).toBe(
      "Keep this historical value",
    );
    expect(archivedState.viewConfig).toMatchObject({
      width: 320,
      hidden: false,
    });
    expect(
      await admin.query(api.fields.listArchived, {
        tableId: fixture.tableId,
      }),
    ).toEqual([
      {
        fieldId: notesFieldId,
        name: "Notes",
        archivedAt: archivedState.field?.deletedAt,
      },
    ]);
    expect(
      (await admin.query(api.fields.list, { tableId: fixture.tableId })).map(
        (field) => field._id,
      ),
    ).not.toContain(notesFieldId);

    await expect(
      member.query(api.fields.listArchived, {
        tableId: fixture.tableId,
      }),
    ).rejects.toThrow();
    await admin.mutation(api.fields.restore, { fieldId: notesFieldId });

    const restoredState = await test.run(async (ctx) => ({
      field: await ctx.db.get(notesFieldId),
      viewConfigs: await ctx.db
        .query("viewFieldConfigs")
        .withIndex("by_view_and_field", (q) =>
          q
            .eq("viewId", savedView.viewId)
            .eq("fieldId", notesFieldId),
        )
        .take(2),
      auditActions: (
        await ctx.db.query("auditEvents").take(20)
      ).map((event) => event.action),
    }));
    expect(restoredState.field).toMatchObject({
      status: "active",
      revision: 3,
    });
    expect(restoredState.field?.deletedAt).toBeUndefined();
    expect(restoredState.viewConfigs).toHaveLength(1);
    expect(restoredState.auditActions).toContain("field.archived");
    expect(restoredState.auditActions).toContain("field.restored");
    expect(
      await admin.query(api.fields.listArchived, {
        tableId: fixture.tableId,
      }),
    ).toEqual([]);
    expect(
      (await admin.query(api.fields.list, { tableId: fixture.tableId })).map(
        (field) => field._id,
      ),
    ).toContain(notesFieldId);
  });

  it("protects the primary column and keeps the legacy remove mutation reversible", async () => {
    const test = setup();
    const fixture = await insertTableFixture(test);
    const admin = test.withIdentity(adminIdentity);
    const notesFieldId = await createNotesField(
      admin,
      fixture.tableId,
      "Legacy notes",
    );

    const primaryImpact = await admin.query(api.fields.getArchiveImpact, {
      fieldId: fixture.primaryFieldId,
    });
    expect(primaryImpact).toMatchObject({
      columnName: "Name",
      canArchive: false,
      blockingReason: "The required column cannot be archived.",
    });
    await expect(
      admin.mutation(api.fields.archive, {
        fieldId: fixture.primaryFieldId,
      }),
    ).rejects.toThrow(/PRIMARY_FIELD_CANNOT_BE_DELETED/);

    await admin.mutation(api.fields.remove, { fieldId: notesFieldId });
    expect(
      await test.run(async (ctx) => ctx.db.get(notesFieldId)),
    ).toMatchObject({
      status: "deleted",
      revision: 2,
    });
    await admin.mutation(api.fields.restore, { fieldId: notesFieldId });
    expect(
      await test.run(async (ctx) => ctx.db.get(notesFieldId)),
    ).toMatchObject({
      status: "active",
      revision: 3,
    });
  });
});

describe("field type conversion", () => {
  async function createField(
    admin: ReturnType<ReturnType<typeof setup>["withIdentity"]>,
    tableId: Id<"tables">,
    input: {
      name: string;
      type:
        | "singleLineText"
        | "number"
        | "multiSelect"
        | "singleSelect";
      config: {
        maxLength?: number;
        precision?: number;
        options?: Array<{
          id: string;
          label: string;
          color: string;
        }>;
      };
    },
  ) {
    return await admin.mutation(api.fields.create, {
      tableId,
      ...input,
    });
  }

  async function insertRecord(
    test: ReturnType<typeof setup>,
    fixture: Awaited<ReturnType<typeof insertTableFixture>>,
    values: Record<string, string | number | boolean | string[]>,
  ) {
    return await test.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert("records", {
        orgId,
        baseId: fixture.baseId,
        tableId: fixture.tableId,
        rank: createRank(),
        values,
        status: "active",
        revision: 1,
        createdByType: "user",
        createdById: adminIdentity.subject,
        updatedByType: "user",
        updatedById: adminIdentity.subject,
        updatedAt: now,
      });
    });
  }

  it("previews named outcomes and requires acknowledgement before clearing values", async () => {
    const test = setup();
    const fixture = await insertTableFixture(test);
    const admin = test.withIdentity(adminIdentity);
    const member = test.withIdentity(memberIdentity);
    const otherAdmin = test.withIdentity(otherAdminIdentity);
    const estimateFieldId = await createField(admin, fixture.tableId, {
      name: "Estimate",
      type: "singleLineText",
      config: { maxLength: 10_000 },
    });
    const validRecordId = await insertRecord(test, fixture, {
      [fixture.primaryFieldId]: "Valid",
      [estimateFieldId]: "42.5",
    });
    const invalidRecordId = await insertRecord(test, fixture, {
      [fixture.primaryFieldId]: "Invalid",
      [estimateFieldId]: "Ask the team",
    });
    await insertRecord(test, fixture, {
      [fixture.primaryFieldId]: "Empty",
    });

    const preview = await admin.query(api.fields.previewTypeConversion, {
      fieldId: estimateFieldId,
      newType: "number",
      newConfig: { precision: 1 },
    });
    expect(preview).toMatchObject({
      columnName: "Estimate",
      currentType: "Short text",
      newType: "Number",
      expectedFieldRevision: 1,
      canApply: true,
      blockingReason: null,
      requiresDataLossAcknowledgement: true,
      counts: {
        reviewedRows: 3,
        filledCells: 2,
        keptAsIs: 0,
        changed: 1,
        cleared: 1,
        losingSomeInformation: 0,
      },
    });
    expect(preview.previewVersion).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.examples).toEqual(
      expect.arrayContaining([
        {
          before: "Ask the team",
          after: "Empty",
          result: "Will be cleared",
          explanation: "This value is not a valid number.",
        },
        {
          before: "42.5",
          after: "42.5",
          result: "Will change",
          explanation: "The value converts cleanly.",
        },
      ]),
    );
    expect(preview.warnings.join(" ")).toContain(
      "cannot be converted and will be cleared",
    );
    const visiblePreview = JSON.stringify(preview);
    expect(visiblePreview).not.toContain(estimateFieldId);
    expect(visiblePreview).not.toContain(validRecordId);
    expect(visiblePreview).not.toContain(invalidRecordId);

    await expect(
      member.query(api.fields.previewTypeConversion, {
        fieldId: estimateFieldId,
        newType: "number",
      }),
    ).rejects.toThrow();
    await expect(
      otherAdmin.query(api.fields.previewTypeConversion, {
        fieldId: estimateFieldId,
        newType: "number",
      }),
    ).rejects.toThrow();
    await expect(
      admin.mutation(api.fields.applyTypeConversion, {
        fieldId: estimateFieldId,
        newType: "number",
        newConfig: { precision: 1 },
        expectedFieldRevision: preview.expectedFieldRevision,
        previewVersion: preview.previewVersion,
        acknowledgeDataLoss: false,
      }),
    ).rejects.toThrow(/FIELD_CONVERSION_REQUIRES_ACKNOWLEDGEMENT/);

    const applied = await admin.mutation(api.fields.applyTypeConversion, {
      fieldId: estimateFieldId,
      newType: "number",
      newConfig: { precision: 1 },
      expectedFieldRevision: preview.expectedFieldRevision,
      previewVersion: preview.previewVersion,
      acknowledgeDataLoss: true,
    });
    expect(applied).toEqual({
      columnName: "Estimate",
      previousType: "Short text",
      newType: "Number",
      fieldRevision: 2,
      rowsUpdated: 2,
      cellsCleared: 1,
      cellsChanged: 1,
    });
    const state = await test.run(async (ctx) => ({
      field: await ctx.db.get(estimateFieldId),
      valid: await ctx.db.get(validRecordId),
      invalid: await ctx.db.get(invalidRecordId),
      audits: await ctx.db.query("auditEvents").take(20),
    }));
    expect(state.field).toMatchObject({
      type: "number",
      config: { precision: 1 },
      revision: 2,
    });
    expect(state.valid?.values[estimateFieldId]).toBe(42.5);
    expect(state.valid?.revision).toBe(2);
    expect(state.invalid?.values[estimateFieldId]).toBeUndefined();
    expect(state.invalid?.revision).toBe(2);
    expect(state.audits.map((event) => event.action)).toContain(
      "field.type_converted",
    );
  });

  it("rejects a preview when rows or the column change before apply", async () => {
    const test = setup();
    const fixture = await insertTableFixture(test);
    const admin = test.withIdentity(adminIdentity);
    const fieldId = await createField(admin, fixture.tableId, {
      name: "Score",
      type: "singleLineText",
      config: { maxLength: 10_000 },
    });
    const recordId = await insertRecord(test, fixture, {
      [fixture.primaryFieldId]: "Launch",
      [fieldId]: "4",
    });
    const rowPreview = await admin.query(
      api.fields.previewTypeConversion,
      {
        fieldId,
        newType: "rating",
      },
    );
    await test.run(async (ctx) => {
      const record = await ctx.db.get(recordId);
      await ctx.db.patch(recordId, {
        values: { ...record!.values, [fieldId]: "5" },
        revision: record!.revision + 1,
        updatedAt: Date.now(),
      });
    });
    await expect(
      admin.mutation(api.fields.applyTypeConversion, {
        fieldId,
        newType: "rating",
        expectedFieldRevision: rowPreview.expectedFieldRevision,
        previewVersion: rowPreview.previewVersion,
        acknowledgeDataLoss: true,
      }),
    ).rejects.toThrow(/FIELD_CONVERSION_PREVIEW_STALE/);

    const fieldPreview = await admin.query(
      api.fields.previewTypeConversion,
      {
        fieldId,
        newType: "rating",
      },
    );
    await admin.mutation(api.fields.update, {
      fieldId,
      name: "Customer score",
    });
    await expect(
      admin.mutation(api.fields.applyTypeConversion, {
        fieldId,
        newType: "rating",
        expectedFieldRevision: fieldPreview.expectedFieldRevision,
        previewVersion: fieldPreview.previewVersion,
        acknowledgeDataLoss: true,
      }),
    ).rejects.toThrow(/FIELD_CONVERSION_PREVIEW_STALE/);
  });

  it("uses choice labels in previews and never exposes stored choice keys", async () => {
    const test = setup();
    const fixture = await insertTableFixture(test);
    const admin = test.withIdentity(adminIdentity);
    const fieldId = await createField(admin, fixture.tableId, {
      name: "Teams",
      type: "multiSelect",
      config: {
        options: [
          {
            id: "choice_internal_product_7b2",
            label: "Product",
            color: "#2563eb",
          },
          {
            id: "choice_internal_design_9f4",
            label: "Design",
            color: "#8b5cf6",
          },
        ],
      },
    });
    const recordId = await insertRecord(test, fixture, {
      [fixture.primaryFieldId]: "Launch",
      [fieldId]: [
        "choice_internal_product_7b2",
        "choice_internal_design_9f4",
      ],
    });

    const preview = await admin.query(api.fields.previewTypeConversion, {
      fieldId,
      newType: "singleSelect",
    });
    expect(preview).toMatchObject({
      columnName: "Teams",
      currentType: "Multiple choice",
      newType: "Single choice",
      requiresDataLossAcknowledgement: true,
      counts: {
        filledCells: 1,
        changed: 1,
        losingSomeInformation: 1,
      },
      examples: [
        {
          before: "Product, Design",
          after: "Product",
          result: "Will change",
          explanation: "Only the first matching choice will be kept.",
        },
      ],
    });
    expect(JSON.stringify(preview)).not.toContain("choice_internal");

    await admin.mutation(api.fields.applyTypeConversion, {
      fieldId,
      newType: "singleSelect",
      expectedFieldRevision: preview.expectedFieldRevision,
      previewVersion: preview.previewVersion,
      acknowledgeDataLoss: true,
    });
    const state = await test.run(async (ctx) => ({
      field: await ctx.db.get(fieldId),
      record: await ctx.db.get(recordId),
    }));
    expect(state.field?.type).toBe("singleSelect");
    expect(state.record?.values[fieldId]).toBe(
      "choice_internal_product_7b2",
    );
  });

  it("rounds practical ratings, clears out-of-range ratings, and blocks published form columns", async () => {
    const test = setup();
    const fixture = await insertTableFixture(test);
    const admin = test.withIdentity(adminIdentity);
    const fieldId = await createField(admin, fixture.tableId, {
      name: "Satisfaction",
      type: "number",
      config: { precision: 1 },
    });
    const roundedRecordId = await insertRecord(test, fixture, {
      [fixture.primaryFieldId]: "Rounded",
      [fieldId]: 4.4,
    });
    const clearedRecordId = await insertRecord(test, fixture, {
      [fixture.primaryFieldId]: "Outside range",
      [fieldId]: 8,
    });

    const preview = await admin.query(api.fields.previewTypeConversion, {
      fieldId,
      newType: "rating",
    });
    expect(preview).toMatchObject({
      currentType: "Number",
      newType: "Rating",
      requiresDataLossAcknowledgement: true,
      counts: {
        filledCells: 2,
        changed: 1,
        cleared: 1,
        losingSomeInformation: 1,
      },
    });
    await admin.mutation(api.fields.applyTypeConversion, {
      fieldId,
      newType: "rating",
      expectedFieldRevision: preview.expectedFieldRevision,
      previewVersion: preview.previewVersion,
      acknowledgeDataLoss: true,
    });
    const converted = await test.run(async (ctx) => ({
      field: await ctx.db.get(fieldId),
      rounded: await ctx.db.get(roundedRecordId),
      cleared: await ctx.db.get(clearedRecordId),
    }));
    expect(converted.field).toMatchObject({
      type: "rating",
      config: { min: 1, max: 5, precision: 0 },
    });
    expect(converted.rounded?.values[fieldId]).toBe(4);
    expect(converted.cleared?.values[fieldId]).toBeUndefined();

    const publishedFieldId = await createField(admin, fixture.tableId, {
      name: "Public answer",
      type: "singleLineText",
      config: { maxLength: 10_000 },
    });
    await insertPublishedFormReference(test, {
      fixtureOrgId: orgId,
      baseId: fixture.baseId,
      tableId: fixture.tableId,
      targetFieldId: publishedFieldId,
      name: "Customer survey",
    });
    const blocked = await admin.query(
      api.fields.previewTypeConversion,
      {
        fieldId: publishedFieldId,
        newType: "number",
      },
    );
    expect(blocked).toMatchObject({
      canApply: false,
      blockingReason:
        "Close or update the published forms that use this column first.",
      dependencies: [
        { category: "Published form", name: "Customer survey" },
      ],
    });
    expect(blocked.warnings[0]).toBe(blocked.blockingReason);
    await expect(
      admin.mutation(api.fields.applyTypeConversion, {
        fieldId: publishedFieldId,
        newType: "number",
        expectedFieldRevision: blocked.expectedFieldRevision,
        previewVersion: blocked.previewVersion,
        acknowledgeDataLoss: true,
      }),
    ).rejects.toThrow(/FIELD_CONVERSION_BLOCKED/);
  });

  it("handles percentage, checkbox, date, currency, and contact-style conversions", async () => {
    const test = setup();
    const fixture = await insertTableFixture(test);
    const admin = test.withIdentity(adminIdentity);
    const sources = [
      {
        name: "Completion",
        value: "75%",
        newType: "percent" as const,
        expected: 0.75,
      },
      {
        name: "Confirmed",
        value: "yes",
        newType: "checkbox" as const,
        expected: true,
      },
      {
        name: "Launch date",
        value: "2026-08-02",
        newType: "date" as const,
        expected: Date.parse("2026-08-02"),
      },
      {
        name: "Contact",
        value: "hello@example.com",
        newType: "email" as const,
        expected: "hello@example.com",
      },
      {
        name: "Website",
        value: "https://example.com/launch",
        newType: "url" as const,
        expected: "https://example.com/launch",
      },
      {
        name: "Phone",
        value: "+971 50 123 4567",
        newType: "phone" as const,
        expected: "+971 50 123 4567",
      },
    ];

    for (const source of sources) {
      const fieldId = await createField(admin, fixture.tableId, {
        name: source.name,
        type: "singleLineText",
        config: { maxLength: 10_000 },
      });
      const recordId = await insertRecord(test, fixture, {
        [fixture.primaryFieldId]: source.name,
        [fieldId]: source.value,
      });
      const preview = await admin.query(
        api.fields.previewTypeConversion,
        {
          fieldId,
          newType: source.newType,
        },
      );
      expect(preview.canApply).toBe(true);
      expect(preview.counts.cleared).toBe(0);
      await admin.mutation(api.fields.applyTypeConversion, {
        fieldId,
        newType: source.newType,
        expectedFieldRevision: preview.expectedFieldRevision,
        previewVersion: preview.previewVersion,
        acknowledgeDataLoss: false,
      });
      expect(
        await test.run(async (ctx) =>
          (await ctx.db.get(recordId))?.values[fieldId],
        ),
      ).toBe(source.expected);
    }

    const amountFieldId = await createField(admin, fixture.tableId, {
      name: "Amount",
      type: "number",
      config: { precision: 2 },
    });
    const amountRecordId = await insertRecord(test, fixture, {
      [fixture.primaryFieldId]: "Budget",
      [amountFieldId]: 1250.5,
    });
    const currencyPreview = await admin.query(
      api.fields.previewTypeConversion,
      {
        fieldId: amountFieldId,
        newType: "currency",
        newConfig: { precision: 2, currency: "AED" },
      },
    );
    expect(currencyPreview.counts.keptAsIs).toBe(1);
    const currencyApplied = await admin.mutation(
      api.fields.applyTypeConversion,
      {
        fieldId: amountFieldId,
        newType: "currency",
        newConfig: { precision: 2, currency: "AED" },
        expectedFieldRevision: currencyPreview.expectedFieldRevision,
        previewVersion: currencyPreview.previewVersion,
        acknowledgeDataLoss: false,
      },
    );
    expect(currencyApplied.rowsUpdated).toBe(0);
    const currencyState = await test.run(async (ctx) => ({
      field: await ctx.db.get(amountFieldId),
      record: await ctx.db.get(amountRecordId),
    }));
    expect(currencyState.field).toMatchObject({
      type: "currency",
      config: { precision: 2, currency: "AED" },
    });
    expect(currencyState.record?.values[amountFieldId]).toBe(1250.5);
  });

  it("converts more than 100 rows with exact confirmation, cancel, resume, and one completion audit", async () => {
    const test = setup();
    const fixture = await insertTableFixture(test);
    const admin = test.withIdentity(adminIdentity);
    const fieldId = await createField(admin, fixture.tableId, {
      name: "Legacy score",
      type: "singleLineText",
      config: { maxLength: 10_000 },
    });
    const recordIds = await test.run(async (ctx) => {
      const ids: Id<"records">[] = [];
      let previousRank: string | undefined;
      for (let index = 0; index < 121; index += 1) {
        const rank = createRank(previousRank);
        previousRank = rank;
        ids.push(await ctx.db.insert("records", {
          orgId,
          baseId: fixture.baseId,
          tableId: fixture.tableId,
          rank,
          values: {
            [fixture.primaryFieldId]: `Row ${index + 1}`,
            [fieldId]:
              index === 120 ? "not a rating" : String((index % 5) + 1),
          },
          status: "active",
          revision: 1,
          createdByType: "user",
          createdById: adminIdentity.subject,
          updatedByType: "user",
          updatedById: adminIdentity.subject,
          updatedAt: Date.now(),
        }));
      }
      return ids;
    });

    const preview = await admin.query(api.fields.previewTypeConversion, {
      fieldId,
      newType: "rating",
    });
    expect(preview).toMatchObject({
      canApply: true,
      counts: { reviewedRows: 100, filledCells: 100 },
      blockingReason: null,
      requiresDataLossAcknowledgement: true,
    });
    expect(preview.warnings.join(" ")).toMatch(/sample/i);
    await expect(
      admin.mutation(api.fields.startTypeConversionJob, {
        fieldId,
        newType: "rating",
        expectedFieldRevision: preview.expectedFieldRevision,
        previewVersion: preview.previewVersion,
        acknowledgeDataLoss: false,
      }),
    ).rejects.toThrow(/FIELD_CONVERSION_REQUIRES_ACKNOWLEDGEMENT/);

    const started = await admin.mutation(
      api.fields.startTypeConversionJob,
      {
        fieldId,
        newType: "rating",
        expectedFieldRevision: preview.expectedFieldRevision,
        previewVersion: preview.previewVersion,
        acknowledgeDataLoss: true,
      },
    );
    expect(started).toMatchObject({
      fieldId,
      status: "staging",
      phase: "staging",
    });

    let staged = started;
    for (let index = 0; staged.status === "staging" && index < 10; index += 1) {
      staged = await admin.mutation(api.fields.stageTypeConversionBatch, {
        jobId: started.jobId,
      });
    }
    expect(staged).toMatchObject({
      status: "ready",
      counts: {
        reviewedRows: 121,
        filledCells: 121,
        changed: 120,
        cleared: 1,
      },
    });

    await expect(
      admin.mutation(api.fields.beginTypeConversionApply, {
        jobId: started.jobId,
        acknowledgeDataLoss: false,
      }),
    ).rejects.toThrow(/FIELD_CONVERSION_REQUIRES_EXACT_ACKNOWLEDGEMENT/);
    await expect(
      admin.mutation(api.fields.update, {
        fieldId,
        name: "Locked name",
      }),
    ).rejects.toThrow(/FIELD_CONVERSION_IN_PROGRESS/);
    await expect(
      admin.mutation(api.records.updateCell, {
        recordId: recordIds[0]!,
        fieldId,
        value: "4",
      }),
    ).rejects.toThrow(/FIELD_CONVERSION_IN_PROGRESS/);

    let cancelled = await admin.mutation(
      api.fields.requestTypeConversionCancel,
      { jobId: started.jobId },
    );
    for (
      let index = 0;
      cancelled.status === "cancelling" && index < 10;
      index += 1
    ) {
      cancelled = await admin.mutation(
        api.fields.cancelTypeConversionBatch,
        { jobId: started.jobId },
      );
    }
    expect(cancelled.status).toBe("cancelled");
    const cancelledState = await test.run(async (ctx) => ({
      field: await ctx.db.get(fieldId),
      shadows: await ctx.db
        .query("fieldConversionShadowValues")
        .withIndex("by_job", (q) => q.eq("jobId", started.jobId))
        .collect(),
    }));
    expect(cancelledState.field?.type).toBe("singleLineText");
    expect(cancelledState.shadows).toHaveLength(0);
    expect(
      await admin.query(api.fields.getActiveTypeConversionJob, {
        tableId: fixture.tableId,
      }),
    ).toBeNull();

    const restarted = await admin.mutation(
      api.fields.startTypeConversionJob,
      {
        fieldId,
        newType: "rating",
        expectedFieldRevision: preview.expectedFieldRevision,
        previewVersion: preview.previewVersion,
        acknowledgeDataLoss: true,
      },
    );
    let ready = restarted;
    for (let index = 0; ready.status === "staging" && index < 10; index += 1) {
      ready = await admin.mutation(api.fields.stageTypeConversionBatch, {
        jobId: restarted.jobId,
      });
    }
    expect(ready.status).toBe("ready");

    await admin.mutation(api.records.updateCell, {
      recordId: recordIds[0]!,
      fieldId: fixture.primaryFieldId,
      value: "Renamed while conversion was ready",
    });
    const applying = await admin.mutation(
      api.fields.beginTypeConversionApply,
      {
        jobId: restarted.jobId,
        acknowledgeDataLoss: true,
      },
    );
    expect(applying.status).toBe("applying");

    let applied = await admin.mutation(
      api.fields.applyTypeConversionBatch,
      { jobId: restarted.jobId },
    );
    expect(applied).toMatchObject({
      status: "applying",
      counts: { appliedRows: 50 },
    });
    const mixedState = await test.run(async (ctx) => ({
      rawFirst: await ctx.db.get(recordIds[0]!),
      field: await ctx.db.get(fieldId),
    }));
    expect(mixedState.rawFirst?.values[fieldId]).toBe(1);
    expect(mixedState.field?.type).toBe("singleLineText");
    const visiblePage = await admin.query(api.records.listPage, {
      tableId: fixture.tableId,
      paginationOpts: { cursor: null, numItems: 100 },
    });
    expect(
      visiblePage.page.find(
        (record: { _id: Id<"records"> }) =>
          record._id === recordIds[0],
      )?.values[fieldId],
    ).toBe("1");

    for (
      let index = 0;
      applied.status === "applying" && index < 10;
      index += 1
    ) {
      applied = await admin.mutation(api.fields.applyTypeConversionBatch, {
        jobId: restarted.jobId,
      });
    }
    expect(applied).toMatchObject({
      status: "completed",
      counts: {
        appliedRows: 121,
        rowsUpdated: 121,
        cleared: 1,
      },
    });
    const completedState = await test.run(async (ctx) => ({
      field: await ctx.db.get(fieldId),
      first: await ctx.db.get(recordIds[0]!),
      invalid: await ctx.db.get(recordIds[120]!),
      audits: (await ctx.db.query("auditEvents").collect()).filter(
        (event) =>
          event.action === "field.type_converted" &&
          event.resourceId === fieldId,
      ),
    }));
    expect(completedState.field).toMatchObject({
      type: "rating",
      revision: 2,
    });
    expect(completedState.first?.values[fieldId]).toBe(1);
    expect(completedState.invalid?.values[fieldId]).toBeUndefined();
    expect(completedState.audits).toHaveLength(1);

    const repeated = await admin.mutation(
      api.fields.applyTypeConversionBatch,
      { jobId: restarted.jobId },
    );
    expect(repeated.status).toBe("completed");
    expect(
      await test.run(async (ctx) =>
        (await ctx.db.query("auditEvents").collect()).filter(
          (event) =>
            event.action === "field.type_converted" &&
            event.resourceId === fieldId,
        ),
      ),
    ).toHaveLength(1);
  });

  it("pauses a stale batch before writes and resumes safely after retry", async () => {
    const test = setup();
    const fixture = await insertTableFixture(test);
    const admin = test.withIdentity(adminIdentity);
    const fieldId = await createField(admin, fixture.tableId, {
      name: "Imported score",
      type: "singleLineText",
      config: { maxLength: 10_000 },
    });
    const recordIds = await test.run(async (ctx) => {
      const ids: Id<"records">[] = [];
      let previousRank: string | undefined;
      for (let index = 0; index < 51; index += 1) {
        const rank = createRank(previousRank);
        previousRank = rank;
        ids.push(await ctx.db.insert("records", {
          orgId,
          baseId: fixture.baseId,
          tableId: fixture.tableId,
          rank,
          values: {
            [fixture.primaryFieldId]: `Imported ${index + 1}`,
            [fieldId]: String((index % 5) + 1),
          },
          status: "active",
          revision: 1,
          createdByType: "user",
          createdById: adminIdentity.subject,
          updatedByType: "user",
          updatedById: adminIdentity.subject,
          updatedAt: Date.now(),
        }));
      }
      return ids;
    });
    const preview = await admin.query(api.fields.previewTypeConversion, {
      fieldId,
      newType: "rating",
    });
    const started = await admin.mutation(
      api.fields.startTypeConversionJob,
      {
        fieldId,
        newType: "rating",
        expectedFieldRevision: preview.expectedFieldRevision,
        previewVersion: preview.previewVersion,
        acknowledgeDataLoss: false,
      },
    );
    let ready = started;
    for (let index = 0; ready.status === "staging" && index < 10; index += 1) {
      ready = await admin.mutation(api.fields.stageTypeConversionBatch, {
        jobId: started.jobId,
      });
    }
    await admin.mutation(api.fields.beginTypeConversionApply, {
      jobId: started.jobId,
      acknowledgeDataLoss: false,
    });

    await test.run(async (ctx) => {
      const first = (await ctx.db.get(recordIds[0]!))!;
      await ctx.db.patch(first._id, {
        values: { ...first.values, [fieldId]: "changed elsewhere" },
        revision: first.revision + 1,
      });
    });
    const failed = await admin.mutation(
      api.fields.applyTypeConversionBatch,
      { jobId: started.jobId },
    );
    expect(failed).toMatchObject({
      status: "failed",
      phase: "applying",
    });
    expect(failed.failureMessage).toMatch(/saved value changed/i);
    expect(
      await test.run(async (ctx) =>
        (await ctx.db.get(recordIds[1]!))?.values[fieldId],
      ),
    ).toBe("2");
    await test.run(async (ctx) => {
      const first = (await ctx.db.get(recordIds[0]!))!;
      await ctx.db.patch(first._id, {
        values: { ...first.values, [fieldId]: "1" },
        revision: first.revision + 1,
      });
    });

    const retried = await admin.mutation(
      api.fields.retryTypeConversionJob,
      { jobId: started.jobId },
    );
    expect(retried.status).toBe("applying");
    let completed = retried;
    for (
      let index = 0;
      completed.status === "applying" && index < 10;
      index += 1
    ) {
      completed = await admin.mutation(
        api.fields.applyTypeConversionBatch,
        { jobId: started.jobId },
      );
    }
    expect(completed).toMatchObject({
      status: "completed",
      counts: { appliedRows: 51, rowsUpdated: 51 },
    });
    expect(
      await test.run(async (ctx) =>
        (await ctx.db.get(recordIds[0]!))?.values[fieldId],
      ),
    ).toBe(1);
  });
});
