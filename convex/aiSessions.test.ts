/// <reference types="vite/client" />

import migrationsTest from "@convex-dev/migrations/test";
import aggregateTest from "@convex-dev/aggregate/test";
import { convexTest } from "convex-test";
import type { UserIdentity } from "convex/server";
import { describe, expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import { aiTurnCount } from "./lib/aggregates";
import { monthKey } from "./lib/quotas";
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
) {
  return {
    subject: userId,
    tokenIdentifier: `test|${userId}`,
    org_id: organizationId,
    org_role: "org:member",
    pla: `o:${plan}`,
    fea: plan === "pro" ? "o:ai_assistant" : "",
  } satisfies Partial<UserIdentity> & Record<string, unknown>;
}

describe("AI monthly usage", () => {
  it("shows the active organization its current monthly allowance", async () => {
    const test = setup();
    const pro = test.withIdentity(
      identity("org_ai_usage", "user_ai_usage", "pro"),
    );

    expect(await pro.query(api.aiSessions.getUsage, {})).toEqual({
      eligible: true,
      limit: 500,
      recentChanges: [],
      remaining: 500,
      used: 0,
    });

    await test.mutation(internal.aiSessions.registerOwnership, {
      continuationTokenHash: "a".repeat(64),
      organizationId: "org_ai_usage",
      sessionId: "assistant-session-1",
      userId: "user_ai_usage",
    });
    await test.mutation(internal.aiSessions.consumeTurn, {
      organizationId: "org_ai_usage",
      requestId: "request-1",
      sessionId: "assistant-session-1",
      userId: "user_ai_usage",
    });

    expect(await pro.query(api.aiSessions.getUsage, {})).toEqual({
      eligible: true,
      limit: 500,
      recentChanges: [],
      remaining: 499,
      used: 1,
    });
  });

  it("keeps usage isolated by organization and explains plan eligibility", async () => {
    const test = setup();
    const starter = test.withIdentity(
      identity("org_ai_starter", "user_ai_starter", "starter"),
    );
    const otherPro = test.withIdentity(
      identity("org_ai_other", "user_ai_other", "pro"),
    );
    await test.run(async (ctx) => {
      await ctx.db.insert("auditEvents", {
        action: "record.updated",
        actorId: "user_ai_other",
        actorType: "eve",
        createdAt: 1_785_430_524_000,
        orgId: "org_ai_other",
        resourceId: "record-private-reference",
        resourceType: "record",
      });
    });

    expect(await starter.query(api.aiSessions.getUsage, {})).toEqual({
      eligible: false,
      limit: 0,
      recentChanges: [],
      remaining: 0,
      used: 0,
    });
    expect(await otherPro.query(api.aiSessions.getUsage, {})).toEqual({
      eligible: true,
      limit: 500,
      recentChanges: [
        {
          createdAt: 1_785_430_524_000,
          id: expect.any(String),
          label: "Updated a record",
          location: "Workspace",
        },
      ],
      remaining: 500,
      used: 0,
    });
  });

  it("allows the final monthly turn, deduplicates its retry, and rejects the next request", async () => {
    const test = setup();
    const organizationId = "org_ai_quota_boundary";
    const userId = "user_ai_quota_boundary";
    const sessionId = "assistant-session-quota-boundary";
    await test.mutation(internal.aiSessions.registerOwnership, {
      continuationTokenHash: "b".repeat(64),
      organizationId,
      sessionId,
      userId,
    });
    await test.run(async (ctx) => {
      const session = await ctx.db
        .query("aiSessions")
        .withIndex("by_external_session", (q) =>
          q.eq("externalSessionId", sessionId),
        )
        .unique();
      const month = monthKey();
      for (let index = 0; index < 499; index += 1) {
        const eventId = await ctx.db.insert("aiUsageEvents", {
          orgId: organizationId,
          sessionId: session!._id,
          requestId: `seeded-request-${index}`,
          month,
          createdAt: Date.now(),
        });
        const event = await ctx.db.get(eventId);
        await aiTurnCount.insert(ctx, event!);
      }
    });

    await expect(
      test.mutation(internal.aiSessions.consumeTurn, {
        organizationId,
        requestId: "request-500",
        sessionId,
        userId,
      }),
    ).resolves.toEqual({ duplicate: false, used: 500, limit: 500 });
    await expect(
      test.mutation(internal.aiSessions.consumeTurn, {
        organizationId,
        requestId: "request-500",
        sessionId,
        userId,
      }),
    ).resolves.toEqual({ duplicate: true, used: 500, limit: 500 });
    await expect(
      test.mutation(internal.aiSessions.consumeTurn, {
        organizationId,
        requestId: "request-501",
        sessionId,
        userId,
      }),
    ).rejects.toThrow(/AI_QUOTA_EXCEEDED/);

    const events = await test.run(async (ctx) =>
      ctx.db
        .query("aiUsageEvents")
        .withIndex("by_org_and_month", (q) =>
          q.eq("orgId", organizationId).eq("month", monthKey()),
        )
        .collect(),
    );
    expect(events).toHaveLength(500);
    expect(
      events.filter((event) => event.requestId === "request-500"),
    ).toHaveLength(1);
  });
});
