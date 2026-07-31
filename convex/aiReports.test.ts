/// <reference types="vite/client" />

import migrationsTest from "@convex-dev/migrations/test";
import aggregateTest from "@convex-dev/aggregate/test";
import { convexTest } from "convex-test";
import type { UserIdentity } from "convex/server";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import { createRank } from "./lib/data";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
  const test = convexTest(schema, modules);
  aggregateTest.register(test, "aiTurnCount");
  migrationsTest.register(test);
  return test;
}

function identity(
  organizationId: string,
  userId: string,
  plan: "free" | "starter" | "pro",
  role: "org:admin" | "org:member" = "org:member",
) {
  return {
    subject: userId,
    tokenIdentifier: `test|${userId}`,
    org_id: organizationId,
    org_role: role,
    pla: `o:${plan}`,
    fea: plan === "pro" ? "o:ai_assistant" : "",
  } satisfies Partial<UserIdentity> & Record<string, unknown>;
}

async function insertSourceFixture(
  test: ReturnType<typeof setup>,
  organizationId: string,
) {
  return await test.run(async (ctx) => {
    const now = Date.now();
    const baseId = await ctx.db.insert("bases", {
      orgId: organizationId,
      name: "Product operations",
      rank: createRank(),
      status: "active",
      createdByUserId: "fixture_author",
      updatedAt: now,
    });
    const tableId = await ctx.db.insert("tables", {
      orgId: organizationId,
      baseId,
      name: "Product roadmap",
      rank: createRank(),
      status: "active",
      createdByUserId: "fixture_author",
      updatedAt: now,
    });
    const fieldId = await ctx.db.insert("fields", {
      orgId: organizationId,
      baseId,
      tableId,
      name: "Status",
      type: "singleSelect",
      config: {
        options: [
          { id: "planned", label: "Planned", color: "#8b5cf6" },
          { id: "shipped", label: "Shipped", color: "#10b981" },
        ],
      },
      rank: createRank(),
      width: 160,
      isPrimary: true,
      status: "active",
      revision: 1,
      createdByUserId: "fixture_author",
      updatedAt: now,
    });
    await ctx.db.patch(tableId, { primaryFieldId: fieldId });
    const recordId = await ctx.db.insert("records", {
      orgId: organizationId,
      baseId,
      tableId,
      rank: createRank(),
      values: { [fieldId]: "planned" },
      status: "active",
      revision: 1,
      createdByType: "user",
      createdById: "fixture_author",
      updatedByType: "user",
      updatedById: "fixture_author",
      updatedAt: now,
    });
    return { baseId, tableId, fieldId, recordId };
  });
}

describe("saved AI reports", () => {
  it("saves a friendly report, redacts internal references, opens it, and archives it", async () => {
    const test = setup();
    const source = await insertSourceFixture(test, "org_reports");
    const user = test.withIdentity(
      identity("org_reports", "user_reports", "pro"),
    );

    await user.mutation(api.aiReports.save, {
      name: "Q3 roadmap review",
      content:
        "Delivery is on track. recordId=record_private and base_secret should stay hidden.",
      scopeLabel: "Table · Product roadmap",
      sources: [
        {
          kind: "table",
          baseId: source.baseId,
          tableId: source.tableId,
          fieldIds: [source.fieldId],
        },
      ],
    });

    const initial = await user.query(api.aiReports.list, {});
    expect(initial.archived).toEqual([]);
    expect(initial.active).toEqual([
      expect.objectContaining({
        canArchive: true,
        name: "Q3 roadmap review",
        scopeLabel: "Table · Product roadmap",
        status: "active",
      }),
    ]);

    const report = await user.query(api.aiReports.get, {
      reportId: initial.active[0]!.id,
    });
    expect(report).toEqual(
      expect.objectContaining({
        name: "Q3 roadmap review",
        scopeLabel: "Table · Product roadmap",
        status: "active",
      }),
    );
    expect(report?.content).toContain("Delivery is on track.")
    expect(report?.content).not.toMatch(/recordId|record_private|base_secret/);

    await user.mutation(api.aiReports.archive, {
      reportId: initial.active[0]!.id,
    });

    const archived = await user.query(api.aiReports.list, {});
    expect(archived.active).toEqual([]);
    expect(archived.archived).toEqual([
      expect.objectContaining({
        canArchive: false,
        name: "Q3 roadmap review",
        status: "archived",
      }),
    ]);
  });

  it("isolates reports by organization and limits archiving to the author or an admin", async () => {
    const test = setup();
    const source = await insertSourceFixture(test, "org_shared_reports");
    const author = test.withIdentity(
      identity("org_shared_reports", "user_author", "pro"),
    );
    const teammate = test.withIdentity(
      identity("org_shared_reports", "user_teammate", "pro"),
    );
    const admin = test.withIdentity(
      identity(
        "org_shared_reports",
        "user_admin",
        "pro",
        "org:admin",
      ),
    );
    const outsider = test.withIdentity(
      identity("org_other_reports", "user_outside", "pro"),
    );

    await author.mutation(api.aiReports.save, {
      name: "Launch summary",
      content: "The launch checklist has three open items.",
      scopeLabel: "Base · Product operations",
      sources: [
        {
          kind: "table",
          baseId: source.baseId,
          tableId: source.tableId,
          fieldIds: [source.fieldId],
        },
      ],
    });
    const reportId = (await author.query(api.aiReports.list, {})).active[0]!.id;

    expect((await teammate.query(api.aiReports.list, {})).active[0]).toEqual(
      expect.objectContaining({ canArchive: false, name: "Launch summary" }),
    );
    await expect(
      teammate.mutation(api.aiReports.archive, { reportId }),
    ).rejects.toThrow();

    expect(await outsider.query(api.aiReports.list, {})).toEqual({
      active: [],
      archived: [],
    });
    expect(
      await outsider.query(api.aiReports.get, { reportId }),
    ).toBeNull();

    await admin.mutation(api.aiReports.archive, { reportId });
    expect((await admin.query(api.aiReports.list, {})).archived).toHaveLength(
      1,
    );
  });

  it("saves validated chart provenance and removes field dependencies when archived", async () => {
    const test = setup();
    const organizationId = "org_chart_reports";
    const source = await insertSourceFixture(test, organizationId);
    const user = test.withIdentity(
      identity(organizationId, "user_chart_reports", "pro"),
    );

    await user.mutation(api.aiReports.save, {
      name: "Status distribution",
      content: `Facts
Four records are Planned and three are Shipped.

Interpretation
The roadmap has a balanced mix of upcoming and completed work.`,
      scopeLabel: "Table · Product roadmap",
      format: "chart",
      chart: {
        type: "bar",
        title: "Product roadmap by Status",
        xLabel: "Status",
        yLabel: "Records",
        data: [
          { label: "Planned", value: 4 },
          { label: "Shipped", value: 3 },
        ],
      },
      sources: [
        {
          kind: "table",
          baseId: source.baseId,
          tableId: source.tableId,
          fieldIds: [source.fieldId],
          recordIds: [source.recordId],
          queryDescriptions: [
            "Summarized 7 records from Product roadmap using Status, grouped by Status.",
          ],
        },
      ],
    });

    const summary = (await user.query(api.aiReports.list, {})).active[0]!;
    expect(summary).toEqual(
      expect.objectContaining({
        format: "chart",
        name: "Status distribution",
        sourceCount: 2,
      }),
    );
    const report = await user.query(api.aiReports.get, {
      reportId: summary.id,
    });
    expect(report).toEqual(
      expect.objectContaining({
        format: "chart",
        chart: expect.objectContaining({
          title: "Product roadmap by Status",
        }),
        citations: [
          {
            kind: "table",
            label:
              "Query · Summarized 7 records from Product roadmap using Status, grouped by Status.",
            href: `/bases/${source.baseId}/tables/${source.tableId}`,
          },
          {
            kind: "table",
            label: "Record · Planned",
            href: `/bases/${source.baseId}/tables/${source.tableId}?record=${source.recordId}`,
          },
        ],
      }),
    );
    expect(report?.citations[0]?.label).not.toContain(source.tableId);

    const referencesBeforeArchive = await test.run(async (ctx) =>
      ctx.db
        .query("aiReportFieldRefs")
        .withIndex("by_report", (q) => q.eq("reportId", summary.id))
        .collect(),
    );
    expect(referencesBeforeArchive).toEqual([
      expect.objectContaining({
        orgId: organizationId,
        reportId: summary.id,
        baseId: source.baseId,
        tableId: source.tableId,
        fieldId: source.fieldId,
      }),
    ]);

    await user.mutation(api.aiReports.archive, { reportId: summary.id });
    expect(
      await test.run(async (ctx) =>
        ctx.db
          .query("aiReportFieldRefs")
          .withIndex("by_report", (q) => q.eq("reportId", summary.id))
          .collect(),
      ),
    ).toEqual([]);
  });

  it("rejects invalid charts and cross-organization source references", async () => {
    const test = setup();
    const source = await insertSourceFixture(test, "org_source_owner");
    const outsider = test.withIdentity(
      identity("org_source_outsider", "user_source_outsider", "pro"),
    );

    await expect(
      outsider.mutation(api.aiReports.save, {
        name: "Invalid chart",
        content: "This chart should not be stored.",
        scopeLabel: "Current workspace",
        format: "chart",
        chart: {
          type: "bar",
          title: "Invalid",
          xLabel: "Status",
          yLabel: "Records",
          data: [{ label: "Planned", value: -1 }],
        },
        sources: [],
      }),
    ).rejects.toThrow();

    await expect(
      outsider.mutation(api.aiReports.save, {
        name: "Foreign source",
        content: "This source belongs to another workspace.",
        scopeLabel: "Table · Product roadmap",
        sources: [
          {
            kind: "table",
            baseId: source.baseId,
            tableId: source.tableId,
            fieldIds: [source.fieldId],
          },
        ],
      }),
    ).rejects.toThrow();

    expect(await outsider.query(api.aiReports.list, {})).toEqual({
      active: [],
      archived: [],
    });
    expect(
      await test.run(async (ctx) =>
        ctx.db.query("aiReportFieldRefs").collect(),
      ),
    ).toEqual([]);
  });

  it("keeps report creation on the AI-enabled plan", async () => {
    const test = setup();
    const starter = test.withIdentity(
      identity("org_starter_reports", "user_starter", "starter"),
    );

    await expect(
      starter.mutation(api.aiReports.save, {
        name: "Unavailable report",
        content: "This should not be stored.",
        scopeLabel: "Current workspace",
        sources: [],
      }),
    ).rejects.toThrow();
    expect(await starter.query(api.aiReports.list, {})).toEqual({
      active: [],
      archived: [],
    });
  });

  it("rejects saving text without a validated workspace source", async () => {
    const test = setup();
    const user = test.withIdentity(
      identity("org_source_required", "user_source_required", "pro"),
    );

    await expect(
      user.mutation(api.aiReports.save, {
        name: "Unsourced analysis",
        content: "This answer has no inspected workspace evidence.",
        scopeLabel: "Current workspace",
        sources: [],
      }),
    ).rejects.toThrow(/REPORT_SOURCE_REQUIRED/);
    expect(await user.query(api.aiReports.list, {})).toEqual({
      active: [],
      archived: [],
    });
  });
});
