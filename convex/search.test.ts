/// <reference types="vite/client" />

import migrationsTest from "@convex-dev/migrations/test";
import { convexTest } from "convex-test";
import type { UserIdentity } from "convex/server";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import { createRank } from "./lib/data";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const orgId = "org_search_primary";
const otherOrgId = "org_search_elsewhere";
const identity = {
  subject: "user_search_member",
  tokenIdentifier: "test|user_search_member",
  org_id: orgId,
  org_role: "org:member",
  pla: "o:pro",
} satisfies Partial<UserIdentity> & Record<string, unknown>;

function setup() {
  const test = convexTest(schema, modules);
  migrationsTest.register(test);
  return test;
}

async function insertResourceSet(
  test: ReturnType<typeof setup>,
  options: {
    resourceOrgId: string;
    label: string;
    tableStatus?: "active" | "deleted";
    viewStatus?: "active" | "archived";
    viewVisibility?: "collaborators" | "personal";
    viewOwnerUserId?: string;
    formStatus?: "draft" | "published" | "closed" | "deleted";
  },
) {
  return await test.run(async (ctx) => {
    const now = 1_000;
    const baseId = await ctx.db.insert("bases", {
      orgId: options.resourceOrgId,
      name: `${options.label} base`,
      description: `Plan ${options.label.toLocaleLowerCase()} work.`,
      rank: createRank(),
      status: "active",
      createdByUserId: identity.subject,
      updatedAt: now,
    });
    const tableStatus = options.tableStatus ?? "active";
    const tableId = await ctx.db.insert("tables", {
      orgId: options.resourceOrgId,
      baseId,
      name: `${options.label} table`,
      rank: createRank(),
      status: tableStatus,
      createdByUserId: identity.subject,
      updatedAt: now,
      deletedAt: tableStatus === "deleted" ? now : undefined,
    });
    const viewStatus = options.viewStatus ?? "active";
    const viewId = await ctx.db.insert("views", {
      orgId: options.resourceOrgId,
      baseId,
      tableId,
      name: `${options.label} view`,
      type: "grid",
      rank: createRank(),
      status: viewStatus,
      visibility: options.viewVisibility ?? "collaborators",
      ownerUserId: options.viewOwnerUserId,
      isDefault: false,
      filterConjunction: "and",
      filters: [],
      sorts: [],
      groups: [],
      configuration: { rowHeight: "medium" },
      revision: 1,
      createdByUserId: identity.subject,
      updatedAt: now,
      archivedAt: viewStatus === "archived" ? now : undefined,
    });
    const formStatus = options.formStatus ?? "draft";
    const formId = await ctx.db.insert("forms", {
      orgId: options.resourceOrgId,
      baseId,
      tableId,
      name: `${options.label} form`,
      slug: `form-${options.label.toLocaleLowerCase().replace(/\s+/g, "-")}`,
      title: `${options.label} form`,
      description: "",
      rank: createRank(),
      status: formStatus,
      appearance: {
        primaryColor: "#2563eb",
        backgroundColor: "#ffffff",
        submitLabel: "Submit",
        showPoweredBy: true,
      },
      thankYou: {
        title: "Thank you",
        message: "Response received.",
      },
      draftRevision: 1,
      createdByUserId: identity.subject,
      updatedAt: now,
      deletedAt: formStatus === "deleted" ? now : undefined,
    });
    return { baseId, tableId, viewId, formId };
  });
}

describe("workspace search", () => {
  it("returns bounded named destinations from only the active organization", async () => {
    const test = setup();
    const visible = await insertResourceSet(test, {
      resourceOrgId: orgId,
      label: "Launch",
      formStatus: "published",
    });
    await insertResourceSet(test, {
      resourceOrgId: otherOrgId,
      label: "Launch elsewhere",
    });
    await insertResourceSet(test, {
      resourceOrgId: orgId,
      label: "Launch private",
      viewVisibility: "personal",
      viewOwnerUserId: "another_person",
      formStatus: "deleted",
    });
    await insertResourceSet(test, {
      resourceOrgId: orgId,
      label: "Launch archived",
      viewStatus: "archived",
      tableStatus: "deleted",
    });

    const results = await test.withIdentity(identity).query(
      api.search.destinations,
      { query: "Launch", limit: 12 },
    );

    expect(results).toHaveLength(7);
    expect(results.map((result) => result.name)).toEqual(
      expect.arrayContaining([
        "Launch base",
        "Launch table",
        "Launch view",
        "Launch form",
      ]),
    );
    for (const hiddenName of [
        "Launch elsewhere base",
        "Launch private view",
        "Launch private form",
        "Launch archived table",
        "Launch archived view",
        "Launch archived form",
      ]) {
      expect(results.map((result) => result.name)).not.toContain(hiddenName);
    }
    expect(
      results.find((result) => result.name === "Launch table"),
    ).toMatchObject({
      context: "Launch base",
      detail: "Table",
      href: `/bases/${visible.baseId}/tables/${visible.tableId}`,
    });
    expect(results.find((result) => result.kind === "form")).toMatchObject({
      context: "Launch base / Launch table",
      detail: "Published form",
    });
    for (const result of results) {
      expect(`${result.name} ${result.context} ${result.detail ?? ""}`).not
        .toMatch(/org_|user_|base_|table_|view_/);
    }
  });

  it("rejects unauthenticated and unbounded requests", async () => {
    const test = setup();
    await expect(
      test.query(api.search.destinations, {
        query: "Launch",
      }),
    ).rejects.toThrow();
    await expect(
      test.withIdentity(identity).query(api.search.destinations, {
        query: "Launch",
        limit: 25,
      }),
    ).rejects.toThrow();
    await expect(
      test.withIdentity(identity).query(api.search.destinations, {
        query: "L",
      }),
    ).rejects.toThrow();
    await expect(
      test.withIdentity(identity).query(api.search.recent, {
        limit: 11,
      }),
    ).rejects.toThrow();
  });

  it("hydrates only this person's accessible recent views with friendly context", async () => {
    const test = setup();
    const first = await insertResourceSet(test, {
      resourceOrgId: orgId,
      label: "Customer launches",
    });
    const otherOrganization = await insertResourceSet(test, {
      resourceOrgId: otherOrgId,
      label: "Private launches",
    });
    const hidden = await insertResourceSet(test, {
      resourceOrgId: orgId,
      label: "Leadership launches",
      viewVisibility: "personal",
      viewOwnerUserId: "another_person",
    });

    await test.run(async (ctx) => {
      await ctx.db.insert("viewPreferences", {
        orgId,
        userIdentityKey: identity.tokenIdentifier,
        baseId: first.baseId,
        tableId: first.tableId,
        viewId: first.viewId,
        isFavorite: true,
        lastOpenedAt: 30,
        updatedAt: 30,
      });
      await ctx.db.insert("viewPreferences", {
        orgId,
        userIdentityKey: identity.tokenIdentifier,
        baseId: hidden.baseId,
        tableId: hidden.tableId,
        viewId: hidden.viewId,
        isFavorite: false,
        lastOpenedAt: 40,
        updatedAt: 40,
      });
      await ctx.db.insert("viewPreferences", {
        orgId: otherOrgId,
        userIdentityKey: identity.tokenIdentifier,
        baseId: otherOrganization.baseId,
        tableId: otherOrganization.tableId,
        viewId: otherOrganization.viewId,
        isFavorite: false,
        lastOpenedAt: 50,
        updatedAt: 50,
      });
    });

    const results = await test
      .withIdentity(identity)
      .query(api.search.recent, { limit: 6 });

    expect(results).toEqual([
      expect.objectContaining({
        favorite: true,
        name: "Customer launches view",
        context: "Customer launches base / Customer launches table",
        href: `/bases/${first.baseId}/tables/${first.tableId}?view=${first.viewId}`,
      }),
    ]);
  });
});
