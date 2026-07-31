/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import type { UserIdentity } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const orgId = "org_analytics_primary";
const otherOrgId = "org_analytics_other";
const identity = {
  subject: "user_analytics_owner",
  tokenIdentifier: "test|user_analytics_owner",
  org_id: orgId,
  org_role: "org:admin",
  pla: "o:starter",
  fea: "o:form_analytics",
} satisfies Partial<UserIdentity> & Record<string, unknown>;
const otherIdentity = {
  ...identity,
  subject: "user_analytics_other",
  tokenIdentifier: "test|user_analytics_other",
  org_id: otherOrgId,
} satisfies Partial<UserIdentity> & Record<string, unknown>;

afterEach(() => vi.useRealTimers());

function setup() {
  const test = convexTest(schema, modules);
  rateLimiterTest.register(test, "rateLimiter");
  return test;
}

async function insertAnalyticsFixture(test: ReturnType<typeof setup>) {
  return await test.run(async (ctx) => {
    const updatedAt = Date.parse("2026-07-20T12:00:00.000Z");
    const baseId = await ctx.db.insert("bases", {
      orgId,
      name: "Customer research",
      rank: "a",
      status: "active",
      createdByUserId: identity.subject,
      updatedAt,
    });
    const otherBaseId = await ctx.db.insert("bases", {
      orgId,
      name: "Product planning",
      rank: "b",
      status: "active",
      createdByUserId: identity.subject,
      updatedAt,
    });
    const tableId = await ctx.db.insert("tables", {
      orgId,
      baseId,
      name: "Research responses",
      rank: "a",
      status: "active",
      createdByUserId: identity.subject,
      updatedAt,
    });
    const channelFieldId = await ctx.db.insert("fields", {
      orgId,
      baseId,
      tableId,
      name: "Discovery channel",
      type: "singleSelect",
      config: {
        options: [
          { id: "web", label: "Website", color: "#0ea5e9" },
          { id: "event", label: "Live event", color: "#f59e0b" },
        ],
      },
      rank: "a",
      width: 180,
      isPrimary: true,
      status: "active",
      revision: 1,
      createdByUserId: identity.subject,
      updatedAt,
    });
    const priorityFieldId = await ctx.db.insert("fields", {
      orgId,
      baseId,
      tableId,
      name: "Priorities",
      type: "multiSelect",
      config: {
        options: [
          { id: "speed", label: "Speed", color: "#8b5cf6" },
          { id: "quality", label: "Quality", color: "#10b981" },
        ],
      },
      rank: "b",
      width: 180,
      isPrimary: false,
      status: "active",
      revision: 1,
      createdByUserId: identity.subject,
      updatedAt,
    });
    await ctx.db.patch(tableId, { primaryFieldId: channelFieldId });
    const formId = await ctx.db.insert("forms", {
      orgId,
      baseId,
      tableId,
      name: "Post-event survey",
      slug: "post-event-survey-private-address",
      title: "Tell us what you thought",
      description: "",
      rank: "a",
      status: "closed",
      appearance: {
        primaryColor: "#0f172a",
        backgroundColor: "#ffffff",
        submitLabel: "Send response",
        showPoweredBy: true,
      },
      thankYou: {
        title: "Thanks",
        message: "Your response was saved.",
      },
      draftRevision: 1,
      createdByUserId: identity.subject,
      updatedAt,
    });
    const formVersionId = await ctx.db.insert("formVersions", {
      orgId,
      formId,
      baseId,
      tableId,
      version: 1,
      title: "Tell us what you thought",
      description: "",
      appearance: {
        primaryColor: "#0f172a",
        backgroundColor: "#ffffff",
        submitLabel: "Send response",
        showPoweredBy: true,
      },
      thankYou: {
        title: "Thanks",
        message: "Your response was saved.",
      },
      publishedByUserId: identity.subject,
      publishedAt: updatedAt,
    });
    const channelQuestionId = await ctx.db.insert("formVersionFields", {
      orgId,
      formId,
      formVersionId,
      targetFieldId: channelFieldId,
      targetFieldType: "singleSelect",
      targetFieldConfig: {
        options: [
          { id: "web", label: "Website", color: "#0ea5e9" },
          { id: "event", label: "Live event", color: "#f59e0b" },
        ],
      },
      label: "How did you hear about us?",
      required: true,
      rank: "a",
    });
    const priorityQuestionId = await ctx.db.insert("formVersionFields", {
      orgId,
      formId,
      formVersionId,
      targetFieldId: priorityFieldId,
      targetFieldType: "multiSelect",
      targetFieldConfig: {
        options: [
          { id: "speed", label: "Speed", color: "#8b5cf6" },
          { id: "quality", label: "Quality", color: "#10b981" },
        ],
      },
      label: "What matters most?",
      required: false,
      rank: "b",
    });

    const submittedTimes = [
      Date.parse("2026-07-25T10:00:00.000Z"),
      Date.parse("2026-07-27T12:00:00.000Z"),
    ];
    const records: Id<"records">[] = [];
    for (const [index, submittedAt] of submittedTimes.entries()) {
      const recordId = await ctx.db.insert("records", {
        orgId,
        baseId,
        tableId,
        rank: `r${index}`,
        values: {
          [channelFieldId]: "web",
          [priorityFieldId]:
            index === 0 ? ["speed", "quality"] : ["quality"],
        },
        status: "active",
        revision: 1,
        createdByType: "public_form",
        createdById: formId,
        updatedByType: "public_form",
        updatedById: formId,
        updatedAt: submittedAt,
      });
      records.push(recordId);
      await ctx.db.insert("formSubmissions", {
        orgId,
        formId,
        formVersionId,
        recordId,
        idempotencyKey: `response-${index}`,
        submittedMonth: "2026-07",
        submittedAt,
      });
    }

    const metricDays = [
      {
        day: "2026-07-25",
        views: 10,
        starts: 6,
        submissions: 1,
        validationErrors: 1,
        abandonments: 2,
      },
      {
        day: "2026-07-27",
        views: 5,
        starts: 3,
        submissions: 1,
        validationErrors: 0,
        abandonments: 1,
      },
    ];
    for (const metrics of metricDays) {
      for (const [metric, count] of [
        ["view", metrics.views],
        ["start", metrics.starts],
        ["submission", metrics.submissions],
        ["validation_error", metrics.validationErrors],
        ["abandonment", metrics.abandonments],
      ] as const) {
        await ctx.db.insert("formMetricBuckets", {
          orgId,
          formId,
          formVersionId,
          day: metrics.day,
          metric,
          shard: 0,
          count,
          updatedAt,
        });
      }
    }

    for (const [metric, count] of [
      ["view", 8],
      ["start", 5],
      ["submission", 1],
      ["validation_error", 2],
      ["abandonment", 2],
    ] as const) {
      await ctx.db.insert("formMetricBuckets", {
        orgId,
        formId,
        formVersionId,
        day: "2026-07-20",
        metric,
        shard: 0,
        count,
        updatedAt,
      });
    }

    for (const [kind, dimension, count] of [
      ["device", "desktop", 10],
      ["device", "mobile", 5],
      ["traffic_source", "search", 8],
      ["traffic_source", "direct", 7],
      ["question_exit", channelQuestionId, 2],
      ["question_exit", priorityQuestionId, 1],
    ] as const) {
      await ctx.db.insert("formAnalyticsBreakdownBuckets", {
        orgId,
        formId,
        formVersionId,
        day: "2026-07-25",
        kind,
        dimension,
        shard: 0,
        count,
        updatedAt,
      });
    }

    return {
      baseId,
      otherBaseId,
      formId,
      formVersionId,
      channelQuestionId,
    };
  });
}

describe("form analytics", () => {
  it("fills empty days and returns friendly funnel, answer, and timing insights", async () => {
    const test = setup();
    const fixture = await insertAnalyticsFixture(test);
    const viewer = test.withIdentity(identity);

    const closed = await viewer.query(api.analytics.summary, {
      baseId: fixture.baseId,
      formId: fixture.formId,
      fromDay: "2026-07-24",
      toDay: "2026-07-30",
    });

    expect(closed.form).toEqual({
      name: "Post-event survey",
      statusLabel: "Closed",
    });
    expect(closed.series).toHaveLength(7);
    expect(closed.series[0]).toEqual({
      date: "2026-07-24",
      views: 0,
      starts: 0,
      submissions: 0,
      validationErrors: 0,
      abandonments: 0,
    });
    expect(closed.totals).toEqual({
      views: 15,
      starts: 9,
      submissions: 2,
      validationErrors: 1,
      abandonments: 3,
    });
    expect(closed.comparison).toMatchObject({
      fromDay: "2026-07-17",
      toDay: "2026-07-23",
      primaryRate: {
        label: "Completion from starts",
        current: 2 / 9,
        previous: 1 / 5,
      },
    });
    expect(closed.comparison.metrics[0]).toEqual({
      label: "Unique views",
      current: 15,
      previous: 8,
      change: 7,
      percentChange: 7 / 8,
    });
    expect(closed.funnel.primaryRateLabel).toBe("Completion from starts");
    expect(closed.funnel.primaryRate).toBeCloseTo(2 / 9);
    expect(closed.topAnswers).toEqual([
      {
        question: "How did you hear about us?",
        answerStyle: "Single choice",
        answeredResponses: 2,
        answers: [{ answer: "Website", count: 2, share: 1 }],
      },
      {
        question: "What matters most?",
        answerStyle: "Multiple choice",
        answeredResponses: 2,
        answers: [
          { answer: "Quality", count: 2, share: 1 },
          { answer: "Speed", count: 1, share: 0.5 },
        ],
      },
    ]);
    expect(closed.responseTiming).toMatchObject({
      latestSubmittedAt: Date.parse("2026-07-27T12:00:00.000Z"),
      responsesInLastSevenDays: 2,
      medianGapMinutes: 3_000,
      analyzedResponses: 2,
      sampleLimited: false,
    });
    expect(closed.breakdowns).toEqual({
      devices: {
        items: [
          { label: "Desktop", count: 10, share: 2 / 3 },
          { label: "Mobile", count: 5, share: 1 / 3 },
        ],
        measuredViews: 15,
        classifiedViews: 15,
        sampleLimited: false,
        note: expect.stringMatching(/broad categories/i),
      },
      trafficSources: {
        items: [
          { label: "Search", count: 8, share: 8 / 15 },
          { label: "Direct", count: 7, share: 7 / 15 },
        ],
        measuredViews: 15,
        classifiedViews: 15,
        sampleLimited: false,
        note: expect.stringMatching(/broad categories/i),
      },
    });
    expect(closed.questionAbandonment).toMatchObject({
      total: 3,
      attributed: 3,
      sampleLimited: false,
      items: [
        {
          question: "How did you hear about us?",
          count: 2,
          share: 2 / 3,
        },
        {
          question: "What matters most?",
          count: 1,
          share: 1 / 3,
        },
      ],
    });
    expect(closed.privacy).toMatchObject({
      rawEventsStored: false,
      referrersTracked: false,
      rawReferrersStored: false,
      rawDeviceDetailsStored: false,
      questionAnswersStoredInEvents: false,
      visitorDedupeRetentionDays: 100,
    });
    expect(JSON.stringify(closed)).not.toMatch(
      /private-address|channelFieldId|priorityFieldId|formVersionId|recordId/,
    );

    await test.run(async (ctx) => {
      await ctx.db.patch(fixture.formId, {
        status: "deleted",
        deletedAt: Date.parse("2026-07-30T15:00:00.000Z"),
      });
    });
    const archived = await viewer.query(api.analytics.summary, {
      baseId: fixture.baseId,
      formId: fixture.formId,
      fromDay: "2026-07-24",
      toDay: "2026-07-30",
    });
    expect(archived.form.statusLabel).toBe("Archived");
    expect(archived.totals.submissions).toBe(2);
  });

  it("keeps reports inside the active organization and selected base", async () => {
    const test = setup();
    const fixture = await insertAnalyticsFixture(test);

    await expect(
      test.withIdentity(otherIdentity).query(api.analytics.summary, {
        baseId: fixture.baseId,
        formId: fixture.formId,
        fromDay: "2026-07-24",
        toDay: "2026-07-30",
      }),
    ).rejects.toThrow(/FORM_NOT_FOUND/);
    await expect(
      test.withIdentity(identity).query(api.analytics.summary, {
        baseId: fixture.otherBaseId,
        formId: fixture.formId,
        fromDay: "2026-07-24",
        toDay: "2026-07-30",
      }),
    ).rejects.toThrow(/FORM_NOT_FOUND/);
  });

  it("labels the view-to-submission fallback when start tracking is absent", async () => {
    const test = setup();
    const fixture = await insertAnalyticsFixture(test);
    await test.run(async (ctx) => {
      const form = await ctx.db.get(fixture.formId);
      if (!form?.currentPublishedVersionId) {
        const version = await ctx.db
          .query("formVersions")
          .withIndex("by_form_and_version", (q) =>
            q.eq("formId", fixture.formId),
          )
          .first();
        if (!version) throw new Error("Missing test version");
        await ctx.db.patch(fixture.formId, {
          currentPublishedVersionId: version._id,
        });
        for (const [metric, count] of [
          ["view", 4],
          ["submission", 1],
        ] as const) {
          await ctx.db.insert("formMetricBuckets", {
            orgId,
            formId: fixture.formId,
            formVersionId: version._id,
            day: "2026-07-30",
            metric,
            shard: 0,
            count,
            updatedAt: Date.parse("2026-07-30T12:00:00.000Z"),
          });
        }
      }
    });

    const report = await test.withIdentity(identity).query(
      api.analytics.summary,
      {
        baseId: fixture.baseId,
        formId: fixture.formId,
        fromDay: "2026-07-30",
        toDay: "2026-07-30",
      },
    );

    expect(report.funnel.primaryRateLabel).toBe(
      "Submission rate from views",
    );
    expect(report.funnel.primaryRate).toBe(0.25);
    expect(report.funnel.note).toMatch(/without a recorded start/i);
  });

  it("deduplicates broad visit and question-exit categories without storing browsing details", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T20:30:00.000Z"));
    const test = setup();
    const fixture = await insertAnalyticsFixture(test);
    await test.run(async (ctx) => {
      await ctx.db.patch(fixture.formId, {
        status: "published",
        analyticsTimeZone: "Asia/Dubai",
        currentPublishedVersionId: fixture.formVersionId,
      });
    });
    const visitorHash = "a".repeat(64);
    const viewArgs = {
      slug: "post-event-survey-private-address",
      formVersionId: fixture.formVersionId,
      metric: "view" as const,
      visitorHash,
      deviceCategory: "tablet" as const,
      trafficSource: "search" as const,
    };
    await test.mutation(internal.analytics.trackPublic, viewArgs);
    await test.mutation(internal.analytics.trackPublic, viewArgs);
    const abandonmentArgs = {
      slug: "post-event-survey-private-address",
      formVersionId: fixture.formVersionId,
      metric: "abandonment" as const,
      visitorHash,
      lastQuestionId: fixture.channelQuestionId,
    };
    await test.mutation(internal.analytics.trackPublic, abandonmentArgs);
    await test.mutation(internal.analytics.trackPublic, abandonmentArgs);

    const stored = await test.run(async (ctx) => ({
      metrics: await ctx.db
        .query("formMetricBuckets")
        .withIndex("by_form_and_day", (q) =>
          q.eq("formId", fixture.formId),
        )
        .take(100),
      breakdowns: await ctx.db
        .query("formAnalyticsBreakdownBuckets")
        .withIndex("by_form_and_kind_and_day", (q) =>
          q.eq("formId", fixture.formId).eq("kind", "device"),
        )
        .take(100),
      allBreakdowns: await ctx.db
        .query("formAnalyticsBreakdownBuckets")
        .withIndex("by_form_and_kind_and_day", (q) =>
          q.eq("formId", fixture.formId),
        )
        .take(100),
      formStats: await ctx.db
        .query("formStats")
        .withIndex("by_form", (q) =>
          q.eq("formId", fixture.formId),
        )
        .unique(),
    }));
    const today = "2026-07-31";
    const newViews = stored.metrics.filter(
      (row) => row.metric === "view" && row.day === today,
    );
    const newExits = stored.metrics.filter(
      (row) => row.metric === "abandonment" && row.day === today,
    );
    expect(newViews).toHaveLength(1);
    expect(newViews[0]?.count).toBe(1);
    expect(newExits).toHaveLength(1);
    expect(newExits[0]?.count).toBe(1);
    expect(stored.formStats).toMatchObject({
      formId: fixture.formId,
      views: 1,
      submissions: 0,
    });
    expect(stored.breakdowns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dimension: "tablet", count: 1 }),
      ]),
    );
    expect(stored.allBreakdowns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dimension: "search", count: 1 }),
        expect.objectContaining({
          dimension: fixture.channelQuestionId,
          count: 1,
        }),
      ]),
    );
    expect(JSON.stringify(stored)).not.toMatch(
      /private customer|search\?q|user-agent|fileName|answer/,
    );
  });
});
