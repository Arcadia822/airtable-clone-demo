/// <reference types="vite/client" />

import presenceTest from "@convex-dev/presence/test";
import { convexTest } from "convex-test";
import type { UserIdentity } from "convex/server";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const orgId = "org_presence123";
const identity = {
  subject: "user_presence123",
  tokenIdentifier: "test|user_presence123",
  org_id: orgId,
  org_role: "org:admin",
  pla: "o:pro",
  name: "Alex Morgan",
  pictureUrl: "https://example.com/alex.png",
} satisfies Partial<UserIdentity> & Record<string, unknown>;

function setup() {
  const test = convexTest(schema, modules);
  presenceTest.register(test);
  return test;
}

async function insertWorkspace(test: ReturnType<typeof setup>) {
  return await test.run(async (ctx) => {
    const now = Date.now();
    const baseId = await ctx.db.insert("bases", {
      orgId,
      name: "Launch operations",
      rank: "a",
      status: "active",
      createdByUserId: identity.subject,
      updatedAt: now,
    });
    const tableId = await ctx.db.insert("tables", {
      orgId,
      baseId,
      name: "Roadmap",
      rank: "a",
      status: "active",
      createdByUserId: identity.subject,
      updatedAt: now,
    });
    const otherTableId = await ctx.db.insert("tables", {
      orgId,
      baseId,
      name: "Feedback",
      rank: "b",
      status: "active",
      createdByUserId: identity.subject,
      updatedAt: now,
    });
    const fieldId = await ctx.db.insert("fields", {
      orgId,
      baseId,
      tableId,
      name: "Initiative",
      type: "singleLineText",
      config: {},
      rank: "a",
      width: 220,
      isPrimary: true,
      status: "active",
      revision: 1,
      createdByUserId: identity.subject,
      updatedAt: now,
    });
    const otherFieldId = await ctx.db.insert("fields", {
      orgId,
      baseId,
      tableId: otherTableId,
      name: "Comment",
      type: "longText",
      config: {},
      rank: "a",
      width: 260,
      isPrimary: true,
      status: "active",
      revision: 1,
      createdByUserId: identity.subject,
      updatedAt: now,
    });
    const recordId = await ctx.db.insert("records", {
      orgId,
      baseId,
      tableId,
      rank: "a",
      values: {},
      status: "active",
      revision: 1,
      createdByType: "user",
      createdById: identity.subject,
      updatedByType: "user",
      updatedById: identity.subject,
      updatedAt: now,
    });
    return {
      tableId,
      fieldId,
      otherFieldId,
      recordId,
    };
  });
}

describe("workspace presence", () => {
  it("scopes a live session to the active Clerk organization and table", async () => {
    const test = setup();
    const workspace = await insertWorkspace(test);
    const admin = test.withIdentity(identity);
    const viewer = await admin.query(api.presence.viewer, {});

    expect(viewer).toEqual({
      userId: `${orgId}:${identity.tokenIdentifier}`,
      name: "Alex Morgan",
      image: identity.pictureUrl,
    });

    const heartbeat = await admin.mutation(api.presence.heartbeat, {
      roomId: `table:${workspace.tableId}`,
      userId: viewer.userId,
      sessionId: "browser-session",
      interval: 12_000,
    });
    await admin.mutation(api.presence.updateLocation, {
      tableId: workspace.tableId,
      fieldId: workspace.fieldId,
      recordId: workspace.recordId,
    });
    const members = await admin.query(api.presence.list, {
      roomToken: heartbeat.roomToken,
    });

    expect(members).toEqual([
      expect.objectContaining({
        userId: viewer.userId,
        online: true,
        name: "Alex Morgan",
        image: identity.pictureUrl,
        data: expect.objectContaining({
          fieldId: workspace.fieldId,
          recordId: workspace.recordId,
        }),
      }),
    ]);
  });

  it("rejects impersonation and locations from another table", async () => {
    const test = setup();
    const workspace = await insertWorkspace(test);
    const admin = test.withIdentity(identity);

    await expect(
      admin.mutation(api.presence.heartbeat, {
        roomId: `table:${workspace.tableId}`,
        userId: `${orgId}:test|someone-else`,
        sessionId: "browser-session",
        interval: 12_000,
      }),
    ).rejects.toThrow(/UNAUTHORIZED/);

    await expect(
      admin.mutation(api.presence.updateLocation, {
        tableId: workspace.tableId,
        fieldId: workspace.otherFieldId,
        recordId: workspace.recordId,
      }),
    ).rejects.toThrow(/PRESENCE_LOCATION_NOT_FOUND/);
  });
});
