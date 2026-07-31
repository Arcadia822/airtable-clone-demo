/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import type { UserIdentity } from "convex/server";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import { createRank } from "./lib/data";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const orgId = "org_resourcePreferences123";
const otherOrgId = "org_resourcePreferencesOther123";
const identity = {
  subject: "user_resourcePreferences123",
  tokenIdentifier: "test|user_resourcePreferences123",
  org_id: orgId,
  org_role: "org:admin",
  pla: "o:pro",
} satisfies Partial<UserIdentity> & Record<string, unknown>;
const teammateIdentity = {
  ...identity,
  subject: "user_resourcePreferencesTeammate123",
  tokenIdentifier: "test|user_resourcePreferencesTeammate123",
} satisfies Partial<UserIdentity> & Record<string, unknown>;
const otherOrgIdentity = {
  ...identity,
  org_id: otherOrgId,
} satisfies Partial<UserIdentity> & Record<string, unknown>;

function setup() {
  return convexTest(schema, modules);
}

async function insertResourceSet(
  test: ReturnType<typeof setup>,
  resourceOrgId: string,
  label: string,
) {
  return await test.run(async (ctx) => {
    const now = Date.now();
    const baseId = await ctx.db.insert("bases", {
      orgId: resourceOrgId,
      name: `${label} workspace`,
      rank: createRank(),
      status: "active",
      createdByUserId: identity.subject,
      updatedAt: now,
    });
    const tableId = await ctx.db.insert("tables", {
      orgId: resourceOrgId,
      baseId,
      name: `${label} schedule`,
      rank: createRank(),
      status: "active",
      createdByUserId: identity.subject,
      updatedAt: now,
    });
    const formId = await ctx.db.insert("forms", {
      orgId: resourceOrgId,
      baseId,
      tableId,
      name: `${label} request`,
      slug: `${label.toLowerCase().replaceAll(" ", "-")}-request`,
      title: `${label} request`,
      description: "Friendly test form",
      rank: createRank(),
      status: "draft",
      appearance: {
        primaryColor: "#6d5dfc",
        backgroundColor: "#ffffff",
        submitLabel: "Submit",
        showPoweredBy: true,
      },
      thankYou: {
        title: "Thank you",
        message: "Your response was saved.",
      },
      draftRevision: 1,
      createdByUserId: identity.subject,
      updatedAt: now,
    });
    return { baseId, tableId, formId };
  });
}

describe("resource preferences", () => {
  it("isolates named favorites and recents by organization and person", async () => {
    const test = setup();
    const resources = await insertResourceSet(test, orgId, "Launch");
    const otherResources = await insertResourceSet(
      test,
      otherOrgId,
      "Private",
    );
    const admin = test.withIdentity(identity);

    await admin.mutation(api.resourcePreferences.trackRouteOpen, {
      baseId: resources.baseId,
      tableId: resources.tableId,
    });
    await admin.mutation(api.resourcePreferences.setFavorite, {
      resourceType: "table",
      resourceId: resources.tableId,
      favorite: true,
    });
    await admin.mutation(api.resourcePreferences.trackRouteOpen, {
      baseId: resources.baseId,
      formId: resources.formId,
    });
    await test
      .withIdentity(teammateIdentity)
      .mutation(api.resourcePreferences.setFavorite, {
        resourceType: "base",
        resourceId: resources.baseId,
        favorite: true,
      });
    await test
      .withIdentity(otherOrgIdentity)
      .mutation(api.resourcePreferences.trackRouteOpen, {
        baseId: otherResources.baseId,
      });

    const navigation = await admin.query(
      api.resourcePreferences.listNavigation,
      { favoriteLimit: 6, recentLimit: 8 },
    );
    expect(navigation.favorites).toEqual([
      expect.objectContaining({
        resourceType: "table",
        name: "Launch schedule",
        context: "Launch workspace",
        isFavorite: true,
      }),
    ]);
    expect(navigation.recent.map((item) => item.name)).toEqual([
      "Launch request",
      "Launch workspace",
      "Launch schedule",
    ]);
    expect(JSON.stringify(navigation)).not.toContain("Private");

    const stored = await test.run(async (ctx) =>
      ctx.db.query("resourcePreferences").take(20),
    );
    expect(
      new Set(stored.map((preference) => preference.orgId)),
    ).toEqual(new Set([orgId, otherOrgId]));
    expect(
      new Set(stored.map((preference) => preference.userIdentityKey)),
    ).toEqual(
      new Set([
        identity.tokenIdentifier,
        teammateIdentity.tokenIdentifier,
      ]),
    );
  });

  it("rejects foreign resources and unbounded navigation requests without exposing keys", async () => {
    const test = setup();
    const otherResources = await insertResourceSet(
      test,
      otherOrgId,
      "Confidential",
    );
    const admin = test.withIdentity(identity);

    await expect(
      admin.mutation(api.resourcePreferences.setFavorite, {
        resourceType: "form",
        resourceId: otherResources.formId,
        favorite: true,
      }),
    ).rejects.toThrow("That workspace item is no longer available.");
    await expect(
      admin.query(api.resourcePreferences.listNavigation, {
        favoriteLimit: 13,
      }),
    ).rejects.toThrow(/INVALID_PREFERENCE_LIMIT/);
  });
});
