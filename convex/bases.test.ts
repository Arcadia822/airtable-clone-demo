/// <reference types="vite/client" />

import aggregateTest from "@convex-dev/aggregate/test";
import { convexTest } from "convex-test";
import type { UserIdentity } from "convex/server";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import { formCount, tableCount } from "./lib/aggregates";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const orgId = "org_baseDashboard123";
const otherOrgId = "org_baseDashboardOther123";
const identity = {
  subject: "user_baseDashboard123",
  tokenIdentifier: "test|user_baseDashboard123",
  org_id: orgId,
  org_role: "org:admin",
  pla: "o:pro",
} satisfies Partial<UserIdentity> & Record<string, unknown>;

function setup() {
  const test = convexTest(schema, modules);
  aggregateTest.register(test, "tableCount");
  aggregateTest.register(test, "formCount");
  return test;
}

async function insertBaseMetadata(
  test: ReturnType<typeof setup>,
  inputs: {
    orgId: string;
    name: string;
    rank: string;
    tables: number;
    forms: number;
  },
) {
  return await test.run(async (ctx) => {
    const updatedAt = 1_720_000_000_000 + inputs.rank.charCodeAt(0);
    const baseId = await ctx.db.insert("bases", {
      orgId: inputs.orgId,
      name: inputs.name,
      description: `${inputs.name} description`,
      color: "#2563eb",
      rank: inputs.rank,
      status: "active",
      createdByUserId: "internal_user_key",
      updatedAt,
    });
    const tableIds = [];
    for (let index = 0; index < inputs.tables; index += 1) {
      const tableId = await ctx.db.insert("tables", {
        orgId: inputs.orgId,
        baseId,
        name: `${inputs.name} table ${index + 1}`,
        rank: String.fromCharCode(97 + index),
        status: "active",
        createdByUserId: "internal_user_key",
        updatedAt,
      });
      const table = await ctx.db.get(tableId);
      await tableCount.insert(ctx, table!);
      tableIds.push(tableId);
    }
    for (let index = 0; index < inputs.forms; index += 1) {
      const tableId = tableIds[index % tableIds.length];
      if (!tableId) {
        throw new Error("A form fixture requires a table.");
      }
      const formId = await ctx.db.insert("forms", {
        orgId: inputs.orgId,
        baseId,
        tableId,
        name: `${inputs.name} form ${index + 1}`,
        slug: `${inputs.name.toLowerCase().replaceAll(" ", "-")}-${index + 1}`,
        title: `${inputs.name} form ${index + 1}`,
        description: "Dashboard fixture",
        rank: String.fromCharCode(97 + index),
        status: "draft",
        appearance: {
          primaryColor: "#2563eb",
          backgroundColor: "#ffffff",
          submitLabel: "Submit",
          showPoweredBy: true,
        },
        thankYou: {
          title: "Thank you",
          message: "Your response was saved.",
        },
        draftRevision: 1,
        createdByUserId: "internal_user_key",
        updatedAt,
      });
      const form = await ctx.db.get(formId);
      await formCount.insert(ctx, form!);
    }
    return { baseId, updatedAt };
  });
}

describe("bases.listDashboardSummaries", () => {
  it("returns bounded, organization-scoped aggregate metadata and personal activity", async () => {
    const test = setup();
    const launch = await insertBaseMetadata(test, {
      orgId,
      name: "Launch operations",
      rank: "a",
      tables: 2,
      forms: 1,
    });
    await insertBaseMetadata(test, {
      orgId,
      name: "Customer research",
      rank: "b",
      tables: 1,
      forms: 0,
    });
    await insertBaseMetadata(test, {
      orgId: otherOrgId,
      name: "Private finance",
      rank: "a",
      tables: 1,
      forms: 0,
    });
    await test.run(async (ctx) => {
      await ctx.db.insert("resourcePreferences", {
        orgId,
        userIdentityKey: identity.tokenIdentifier,
        resourceType: "base",
        resourceId: launch.baseId,
        isFavorite: true,
        lastOpenedAt: 1_730_000_000_000,
        updatedAt: 1_730_000_000_000,
      });
    });

    const admin = test.withIdentity(identity);
    const summaries = await admin.query(
      api.bases.listDashboardSummaries,
      {},
    );

    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toEqual({
      baseId: launch.baseId,
      name: "Launch operations",
      description: "Launch operations description",
      color: "#2563eb",
      rank: "a",
      tableCount: 2,
      formCount: 1,
      isFavorite: true,
      lastOpenedAt: 1_730_000_000_000,
      updatedAt: launch.updatedAt,
    });
    expect(summaries[1]).toMatchObject({
      name: "Customer research",
      tableCount: 1,
      formCount: 0,
      isFavorite: false,
      lastOpenedAt: null,
    });
    expect(JSON.stringify(summaries)).not.toContain("Private finance");
    expect(JSON.stringify(summaries)).not.toContain("internal_user_key");

    const teammateSummaries = await test
      .withIdentity({
        ...identity,
        subject: "user_baseDashboardTeammate123",
        tokenIdentifier: "test|user_baseDashboardTeammate123",
      })
      .query(api.bases.listDashboardSummaries, {});
    expect(teammateSummaries[0]).toMatchObject({
      tableCount: 2,
      formCount: 1,
      isFavorite: false,
      lastOpenedAt: null,
    });
  });

  it("requires an authenticated organization context", async () => {
    const test = setup();

    await expect(
      test.query(api.bases.listDashboardSummaries, {}),
    ).rejects.toThrow();
    await expect(
      test
        .withIdentity({
          subject: "user_withoutOrganization123",
          tokenIdentifier: "test|user_withoutOrganization123",
        })
        .query(api.bases.listDashboardSummaries, {}),
    ).rejects.toThrow(/ACTIVE_ORGANIZATION_REQUIRED/);
  });
});
