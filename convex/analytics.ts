import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireFeature, requireOrgIdentity } from "./lib/auth";
import { hasActiveFormParents, requireForm } from "./lib/data";
import { resolveFormBySlug } from "./lib/formSlugs";
import { incrementFormStat } from "./lib/formStats";
import { FEATURE_SLUGS } from "./lib/quotas";
import { rateLimiter } from "./lib/rateLimits";
import {
  analyticsDayAt,
  normalizeAnalyticsTimeZone,
  shiftAnalyticsDay,
  startOfAnalyticsDay,
} from "./lib/analyticsTimeZone";
import {
  analyticsDeviceCategoryValidator,
  analyticsTrafficSourceValidator,
} from "./lib/validators";

const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_ANALYZED_RESPONSES = 200;
const MAX_ANALYZED_VERSIONS = 20;
const MAX_QUESTIONS_PER_VERSION = 250;
const MAX_METRIC_BUCKETS_PER_RANGE = 7_200;
const MAX_DEVICE_BUCKETS_PER_RANGE = 2_000;
const MAX_SOURCE_BUCKETS_PER_RANGE = 3_500;
const MAX_QUESTION_EXIT_BUCKETS_PER_RANGE = 4_000;
const BREAKDOWN_SHARDS = 4;

const publicMetricValidator = v.union(
  v.literal("view"),
  v.literal("start"),
  v.literal("validation_error"),
  v.literal("abandonment"),
);

const analyticsRowValidator = v.object({
  date: v.string(),
  views: v.number(),
  starts: v.number(),
  submissions: v.number(),
  validationErrors: v.number(),
  abandonments: v.number(),
});

const comparisonMetricValidator = v.object({
  label: v.string(),
  current: v.number(),
  previous: v.number(),
  change: v.number(),
  percentChange: v.union(v.number(), v.null()),
});

const breakdownItemValidator = v.object({
  label: v.string(),
  count: v.number(),
  share: v.number(),
});

const breakdownValidator = v.object({
  items: v.array(breakdownItemValidator),
  measuredViews: v.number(),
  classifiedViews: v.number(),
  sampleLimited: v.boolean(),
  note: v.string(),
});

const questionExitValidator = v.object({
  question: v.string(),
  count: v.number(),
  share: v.number(),
});

const answerInsightValidator = v.object({
  question: v.string(),
  answerStyle: v.string(),
  answeredResponses: v.number(),
  answers: v.array(
    v.object({
      answer: v.string(),
      count: v.number(),
      share: v.number(),
    }),
  ),
});

const summaryValidator = v.object({
  form: v.object({
    name: v.string(),
    statusLabel: v.string(),
  }),
  fromDay: v.string(),
  toDay: v.string(),
  timeZone: v.string(),
  totals: v.object({
    views: v.number(),
    starts: v.number(),
    submissions: v.number(),
    validationErrors: v.number(),
    abandonments: v.number(),
  }),
  comparison: v.object({
    fromDay: v.string(),
    toDay: v.string(),
    metrics: v.array(comparisonMetricValidator),
    primaryRate: v.object({
      label: v.string(),
      current: v.union(v.number(), v.null()),
      previous: v.union(v.number(), v.null()),
      pointChange: v.union(v.number(), v.null()),
    }),
    note: v.string(),
  }),
  funnel: v.object({
    steps: v.array(
      v.object({
        label: v.string(),
        count: v.number(),
        rateFromPrevious: v.union(v.number(), v.null()),
      }),
    ),
    primaryRateLabel: v.string(),
    primaryRate: v.union(v.number(), v.null()),
    note: v.string(),
  }),
  series: v.array(analyticsRowValidator),
  breakdowns: v.object({
    devices: breakdownValidator,
    trafficSources: breakdownValidator,
  }),
  questionAbandonment: v.object({
    items: v.array(questionExitValidator),
    total: v.number(),
    attributed: v.number(),
    sampleLimited: v.boolean(),
    note: v.string(),
  }),
  topAnswers: v.array(answerInsightValidator),
  responseTiming: v.object({
    latestSubmittedAt: v.union(v.number(), v.null()),
    responsesInLastSevenDays: v.number(),
    medianGapMinutes: v.union(v.number(), v.null()),
    analyzedResponses: v.number(),
    sampleLimited: v.boolean(),
  }),
  privacy: v.object({
    rawEventsStored: v.boolean(),
    uniqueVisitorsTracked: v.boolean(),
    visitorDedupe: v.string(),
    referrersTracked: v.boolean(),
    rawReferrersStored: v.boolean(),
    rawDeviceDetailsStored: v.boolean(),
    questionAnswersStoredInEvents: v.boolean(),
    visitorDedupeRetentionDays: v.number(),
    aggregateRetention: v.string(),
  }),
});

type AnalyticsRow = {
  date: string;
  views: number;
  starts: number;
  submissions: number;
  validationErrors: number;
  abandonments: number;
};

type QuestionAccumulator = {
  label: string;
  answerStyle: string;
  answeredResponses: number;
  counts: Map<string, number>;
};

type AnalyticsTotals = {
  views: number;
  starts: number;
  submissions: number;
  validationErrors: number;
  abandonments: number;
};

type BreakdownKind = Doc<"formAnalyticsBreakdownBuckets">["kind"];

const DEVICE_LABELS = {
  desktop: "Desktop",
  tablet: "Tablet",
  mobile: "Mobile",
  unknown: "Not classified",
} as const;

const TRAFFIC_SOURCE_LABELS = {
  direct: "Direct",
  search: "Search",
  social: "Social",
  email: "Email",
  campaign: "Campaign",
  referral: "Other websites",
  unknown: "Not classified",
} as const;

function shardFor(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % 16;
}

function breakdownShardFor(seed: string): number {
  return shardFor(seed) % BREAKDOWN_SHARDS;
}

function assertDay(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ConvexError({ code: "INVALID_DATE_RANGE" });
  }
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    throw new ConvexError({ code: "INVALID_DATE_RANGE" });
  }
}

function formStatusLabel(status: Doc<"forms">["status"]): string {
  if (status === "published") return "Live";
  if (status === "closed") return "Closed";
  if (status === "deleted") return "Archived";
  return "Draft";
}

function fillDailySeries(
  fromDay: string,
  toDay: string,
  buckets: Array<Doc<"formMetricBuckets">>,
): AnalyticsRow[] {
  const byDay = new Map<string, AnalyticsRow>();
  for (
    let date = fromDay;
    date <= toDay;
    date = shiftAnalyticsDay(date, 1)
  ) {
    byDay.set(date, {
      date,
      views: 0,
      starts: 0,
      submissions: 0,
      validationErrors: 0,
      abandonments: 0,
    });
  }
  for (const bucket of buckets) {
    const row = byDay.get(bucket.day);
    if (!row) continue;
    if (bucket.metric === "view") row.views += bucket.count;
    if (bucket.metric === "start") row.starts += bucket.count;
    if (bucket.metric === "submission") row.submissions += bucket.count;
    if (bucket.metric === "validation_error") {
      row.validationErrors += bucket.count;
    }
    if (bucket.metric === "abandonment") {
      row.abandonments += bucket.count;
    }
  }
  return [...byDay.values()];
}

function sumSeries(series: AnalyticsRow[]): AnalyticsTotals {
  return series.reduce(
    (acc, row) => ({
      views: acc.views + row.views,
      starts: acc.starts + row.starts,
      submissions: acc.submissions + row.submissions,
      validationErrors: acc.validationErrors + row.validationErrors,
      abandonments: acc.abandonments + row.abandonments,
    }),
    {
      views: 0,
      starts: 0,
      submissions: 0,
      validationErrors: 0,
      abandonments: 0,
    },
  );
}

function completionRate(totals: AnalyticsTotals): number | null {
  if (totals.starts > 0) return totals.submissions / totals.starts;
  return totals.views > 0 ? totals.submissions / totals.views : null;
}

function comparisonMetric(
  label: string,
  current: number,
  previous: number,
) {
  return {
    label,
    current,
    previous,
    change: current - previous,
    percentChange:
      previous === 0 ? null : (current - previous) / previous,
  };
}

function buildComparison(
  current: AnalyticsTotals,
  previous: AnalyticsTotals,
  fromDay: string,
  toDay: string,
) {
  const compareFromStarts = current.starts > 0 || previous.starts > 0;
  const currentRate = compareFromStarts
    ? current.starts > 0
      ? current.submissions / current.starts
      : null
    : completionRate(current);
  const previousRate = compareFromStarts
    ? previous.starts > 0
      ? previous.submissions / previous.starts
      : null
    : completionRate(previous);
  const hasEarlierActivity =
    previous.views > 0 ||
    previous.starts > 0 ||
    previous.submissions > 0 ||
    previous.validationErrors > 0 ||
    previous.abandonments > 0;
  return {
    fromDay,
    toDay,
    metrics: [
      comparisonMetric("Unique views", current.views, previous.views),
      comparisonMetric("Form starts", current.starts, previous.starts),
      comparisonMetric("Submissions", current.submissions, previous.submissions),
      comparisonMetric(
        "Validation errors",
        current.validationErrors,
        previous.validationErrors,
      ),
      comparisonMetric(
        "Tracked exits",
        current.abandonments,
        previous.abandonments,
      ),
    ],
    primaryRate: {
      label:
        compareFromStarts
          ? "Completion from starts"
          : "Submission rate from views",
      current: currentRate,
      previous: previousRate,
      pointChange:
        currentRate === null || previousRate === null
          ? null
          : currentRate - previousRate,
    },
    note: hasEarlierActivity
      ? "Compared with the previous period of the same length."
      : "There was no activity in the previous period.",
  };
}

function buildFunnel(totals: AnalyticsTotals) {
  const startRate = totals.views > 0 ? totals.starts / totals.views : null;
  const completionRate =
    totals.starts > 0 ? totals.submissions / totals.starts : null;
  const submissionRate =
    totals.views > 0 ? totals.submissions / totals.views : null;
  const canShowCompletion = completionRate !== null;

  return {
    steps: [
      {
        label: "Unique views",
        count: totals.views,
        rateFromPrevious: null,
      },
      {
        label: "Started",
        count: totals.starts,
        rateFromPrevious: startRate,
      },
      {
        label: "Submitted",
        count: totals.submissions,
        rateFromPrevious: canShowCompletion ? completionRate : submissionRate,
      },
    ],
    primaryRateLabel: canShowCompletion
      ? "Completion from starts"
      : "Submission rate from views",
    primaryRate: canShowCompletion ? completionRate : submissionRate,
    note: canShowCompletion
      ? "Completion compares submitted responses with people who started the form."
      : totals.submissions > 0
        ? "Some responses were received without a recorded start, so the rate compares submissions with views instead."
        : "A completion rate will appear after someone starts and submits the form.",
  };
}

async function readMetricBuckets(
  ctx: QueryCtx,
  formId: Id<"forms">,
  fromDay: string,
  toDay: string,
): Promise<Array<Doc<"formMetricBuckets">>> {
  const buckets = await ctx.db
    .query("formMetricBuckets")
    .withIndex("by_form_and_day", (q) =>
      q.eq("formId", formId).gte("day", fromDay).lte("day", toDay),
    )
    .take(MAX_METRIC_BUCKETS_PER_RANGE + 1);
  if (buckets.length > MAX_METRIC_BUCKETS_PER_RANGE) {
    throw new ConvexError({ code: "ANALYTICS_RANGE_TOO_LARGE" });
  }
  return buckets;
}

async function readBreakdownBuckets(
  ctx: QueryCtx,
  formId: Id<"forms">,
  kind: BreakdownKind,
  fromDay: string,
  toDay: string,
  limit: number,
) {
  const rows = await ctx.db
    .query("formAnalyticsBreakdownBuckets")
    .withIndex("by_form_and_kind_and_day", (q) =>
      q
        .eq("formId", formId)
        .eq("kind", kind)
        .gte("day", fromDay)
        .lte("day", toDay),
    )
    .order("desc")
    .take(limit + 1);
  return {
    rows: rows.slice(0, limit),
    sampleLimited: rows.length > limit,
  };
}

function buildBreakdown(
  rows: Array<Doc<"formAnalyticsBreakdownBuckets">>,
  totalViews: number,
  labels: Record<string, string>,
  sampleLimited: boolean,
) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.dimension, (counts.get(row.dimension) ?? 0) + row.count);
  }
  const measuredViews = [...counts.values()].reduce(
    (total, count) => total + count,
    0,
  );
  const missingViews = Math.max(0, totalViews - measuredViews);
  if (missingViews > 0) {
    counts.set("unknown", (counts.get("unknown") ?? 0) + missingViews);
  }
  const classifiedViews = [...counts.entries()].reduce(
    (total, [dimension, count]) =>
      dimension === "unknown" ? total : total + count,
    0,
  );
  const denominator = Math.max(totalViews, measuredViews, 1);
  return {
    items: [...counts.entries()]
      .filter(([, count]) => count > 0)
      .map(([dimension, count]) => ({
        label: labels[dimension] ?? "Not classified",
        count,
        share: count / denominator,
      }))
      .sort(
        (left, right) =>
          right.count - left.count || left.label.localeCompare(right.label),
      ),
    measuredViews: Math.min(measuredViews, totalViews),
    classifiedViews: Math.min(classifiedViews, totalViews),
    sampleLimited,
    note:
      classifiedViews > 0
        ? "Visits are grouped into broad categories. Detailed browsing information is not kept."
        : totalViews > 0
          ? "Detailed categories were not collected for these visits."
          : "Categories will appear after the form receives visits.",
  };
}

function optionLabel(
  question: Doc<"formVersionFields">,
  optionId: string,
): string {
  const match = question.targetFieldConfig.options?.find(
    (option) => option.id === optionId,
  );
  return match?.label.trim() || "Former option";
}

function addQuestionAnswer(
  accumulator: QuestionAccumulator,
  question: Doc<"formVersionFields">,
  value: Doc<"records">["values"][Id<"fields">] | undefined,
): void {
  const rawAnswers =
    typeof value === "string"
      ? [value]
      : Array.isArray(value) && value.every((item) => typeof item === "string")
        ? value
        : [];
  const answers = [...new Set(rawAnswers)].map((answer) =>
    optionLabel(question, answer),
  );
  if (answers.length === 0) return;
  accumulator.answeredResponses += 1;
  for (const answer of answers) {
    accumulator.counts.set(answer, (accumulator.counts.get(answer) ?? 0) + 1);
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

async function incrementBreakdownBucket(
  ctx: MutationCtx,
  args: {
    orgId: string;
    formId: Id<"forms">;
    formVersionId: Id<"formVersions">;
    day: string;
    kind: BreakdownKind;
    dimension: string;
    visitorHash: string;
  },
): Promise<void> {
  const shard = breakdownShardFor(args.visitorHash);
  const existing = await ctx.db
    .query("formAnalyticsBreakdownBuckets")
    .withIndex(
      "by_form_and_day_and_kind_and_dimension_and_shard",
      (q) =>
        q
          .eq("formId", args.formId)
          .eq("day", args.day)
          .eq("kind", args.kind)
          .eq("dimension", args.dimension)
          .eq("shard", shard),
    )
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, {
      count: existing.count + 1,
      updatedAt: Date.now(),
    });
    return;
  }
  await ctx.db.insert("formAnalyticsBreakdownBuckets", {
    orgId: args.orgId,
    formId: args.formId,
    formVersionId: args.formVersionId,
    day: args.day,
    kind: args.kind,
    dimension: args.dimension,
    shard,
    count: 1,
    updatedAt: Date.now(),
  });
}

export const trackPublic = internalMutation({
  args: {
    slug: v.string(),
    formVersionId: v.id("formVersions"),
    metric: publicMetricValidator,
    visitorHash: v.string(),
    deviceCategory: v.optional(analyticsDeviceCategoryValidator),
    trafficSource: v.optional(analyticsTrafficSourceValidator),
    lastQuestionId: v.optional(v.id("formVersionFields")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const form = await resolveFormBySlug(ctx, args.slug);
    if (
      !form ||
      form.status !== "published" ||
      form.currentPublishedVersionId !== args.formVersionId ||
      !(await hasActiveFormParents(ctx, form))
    ) {
      return null;
    }
    await rateLimiter.limit(ctx, "publicFormAnalytics", {
      key: form._id,
      throws: true,
    });
    const timeZone = normalizeAnalyticsTimeZone(
      form.analyticsTimeZone ?? "UTC",
    );
    const day = analyticsDayAt(Date.now(), timeZone);
    if (
      (args.metric === "view" ||
        args.metric === "start" ||
        args.metric === "abandonment") &&
      /^[a-f0-9]{64}$/.test(args.visitorHash)
    ) {
      const dedupeMetric = args.metric as
        | "view"
        | "start"
        | "abandonment";
      const existingVisitor = await ctx.db
        .query("formMetricDedupe")
        .withIndex("by_form_day_metric_visitor", (q) =>
          q
            .eq("formId", form._id)
            .eq("day", day)
            .eq("metric", dedupeMetric)
            .eq("visitorHash", args.visitorHash),
        )
        .unique();
      if (existingVisitor) return null;
      await ctx.db.insert("formMetricDedupe", {
        orgId: form.orgId,
        formId: form._id,
        formVersionId: args.formVersionId,
        day,
        metric: dedupeMetric,
        visitorHash: args.visitorHash,
        createdAt: Date.now(),
      });
    }
    const shard = shardFor(args.visitorHash);
    const existing = await ctx.db
      .query("formMetricBuckets")
      .withIndex("by_form_and_day_and_metric_and_shard", (q) =>
        q
          .eq("formId", form._id)
          .eq("day", day)
          .eq("metric", args.metric)
          .eq("shard", shard),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        count: existing.count + 1,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("formMetricBuckets", {
        orgId: form.orgId,
        formId: form._id,
        formVersionId: args.formVersionId,
        day,
        metric: args.metric,
        shard,
        count: 1,
        updatedAt: Date.now(),
      });
    }
    if (args.metric === "view") {
      await incrementFormStat(ctx, {
        orgId: form.orgId,
        formId: form._id,
        metric: "view",
      });
    }
    if (args.metric === "view") {
      await incrementBreakdownBucket(ctx, {
        orgId: form.orgId,
        formId: form._id,
        formVersionId: args.formVersionId,
        day,
        kind: "device",
        dimension: args.deviceCategory ?? "unknown",
        visitorHash: args.visitorHash,
      });
      await incrementBreakdownBucket(ctx, {
        orgId: form.orgId,
        formId: form._id,
        formVersionId: args.formVersionId,
        day,
        kind: "traffic_source",
        dimension: args.trafficSource ?? "unknown",
        visitorHash: args.visitorHash,
      });
    }
    if (args.metric === "abandonment" && args.lastQuestionId) {
      const question = await ctx.db.get(args.lastQuestionId);
      if (
        question?.orgId === form.orgId &&
        question.formId === form._id &&
        question.formVersionId === args.formVersionId &&
        question.mode !== "hidden"
      ) {
        await incrementBreakdownBucket(ctx, {
          orgId: form.orgId,
          formId: form._id,
          formVersionId: args.formVersionId,
          day,
          kind: "question_exit",
          dimension: question._id,
          visitorHash: args.visitorHash,
        });
      }
    }
    return null;
  },
});

export const summary = query({
  args: {
    baseId: v.id("bases"),
    formId: v.id("forms"),
    fromDay: v.string(),
    toDay: v.string(),
  },
  returns: summaryValidator,
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireFeature(identity, FEATURE_SLUGS.formAnalytics);
    const form = await requireForm(ctx, identity.orgId, args.formId, true);
    if (form.baseId !== args.baseId) {
      throw new ConvexError({ code: "FORM_NOT_FOUND" });
    }
    assertDay(args.fromDay);
    assertDay(args.toDay);
    const timeZone = normalizeAnalyticsTimeZone(
      form.analyticsTimeZone ?? "UTC",
    );
    const from = startOfAnalyticsDay(args.fromDay, timeZone);
    const toExclusive = startOfAnalyticsDay(
      shiftAnalyticsDay(args.toDay, 1),
      timeZone,
    );
    const dayCount =
      Math.round(
        (Date.parse(`${args.toDay}T00:00:00.000Z`) -
          Date.parse(`${args.fromDay}T00:00:00.000Z`)) /
          DAY_MS,
      ) + 1;
    if (args.toDay < args.fromDay || dayCount > 90) {
      throw new ConvexError({ code: "INVALID_DATE_RANGE", maxDays: 90 });
    }
    const previousToDay = shiftAnalyticsDay(args.fromDay, -1);
    const previousFromDay = shiftAnalyticsDay(
      previousToDay,
      -(dayCount - 1),
    );
    const buckets = await readMetricBuckets(
      ctx,
      args.formId,
      args.fromDay,
      args.toDay,
    );
    const previousBuckets = await readMetricBuckets(
      ctx,
      args.formId,
      previousFromDay,
      previousToDay,
    );
    const series = fillDailySeries(args.fromDay, args.toDay, buckets);
    const totals = sumSeries(series);
    const previousSeries = fillDailySeries(
      previousFromDay,
      previousToDay,
      previousBuckets,
    );
    const previousTotals = sumSeries(previousSeries);

    const deviceBuckets = await readBreakdownBuckets(
      ctx,
      args.formId,
      "device",
      args.fromDay,
      args.toDay,
      MAX_DEVICE_BUCKETS_PER_RANGE,
    );
    const sourceBuckets = await readBreakdownBuckets(
      ctx,
      args.formId,
      "traffic_source",
      args.fromDay,
      args.toDay,
      MAX_SOURCE_BUCKETS_PER_RANGE,
    );
    const questionExitBuckets = await readBreakdownBuckets(
      ctx,
      args.formId,
      "question_exit",
      args.fromDay,
      args.toDay,
      MAX_QUESTION_EXIT_BUCKETS_PER_RANGE,
    );

    const submissionSample = await ctx.db
      .query("formSubmissions")
      .withIndex("by_form_and_submitted_at", (q) =>
        q
          .eq("formId", args.formId)
          .gte("submittedAt", from)
          .lt("submittedAt", toExclusive),
      )
      .order("desc")
      .take(MAX_ANALYZED_RESPONSES + 1);
    const sampledSubmissions = submissionSample
      .filter((submission) => submission.orgId === identity.orgId)
      .slice(0, MAX_ANALYZED_RESPONSES);
    const allVersionIds = [
      ...new Set([
        ...sampledSubmissions.map((submission) => submission.formVersionId),
        ...questionExitBuckets.rows
          .filter((row) => row.orgId === identity.orgId)
          .map((row) => row.formVersionId),
      ]),
    ];
    const versionIds = allVersionIds.slice(0, MAX_ANALYZED_VERSIONS);
    const versionSampleLimited =
      allVersionIds.length > MAX_ANALYZED_VERSIONS;
    const questionsByVersion = new Map<
      Id<"formVersions">,
      Array<Doc<"formVersionFields">>
    >();
    for (const formVersionId of versionIds) {
      const questions = await ctx.db
        .query("formVersionFields")
        .withIndex("by_version_and_rank", (q) =>
          q.eq("formVersionId", formVersionId),
        )
        .take(MAX_QUESTIONS_PER_VERSION);
      questionsByVersion.set(formVersionId, questions);
    }

    const answerAccumulators = new Map<Id<"fields">, QuestionAccumulator>();
    for (const submission of sampledSubmissions) {
      const record = await ctx.db.get(submission.recordId);
      if (!record || record.orgId !== identity.orgId) continue;
      const questions = questionsByVersion.get(submission.formVersionId) ?? [];
      for (const question of questions) {
        if (
          question.targetFieldType !== "singleSelect" &&
          question.targetFieldType !== "multiSelect"
        ) {
          continue;
        }
        const accumulator =
          answerAccumulators.get(question.targetFieldId) ??
          {
            label: question.label.trim() || "Untitled question",
            answerStyle:
              question.targetFieldType === "singleSelect"
                ? "Single choice"
                : "Multiple choice",
            answeredResponses: 0,
            counts: new Map<string, number>(),
          };
        addQuestionAnswer(
          accumulator,
          question,
          record.values[question.targetFieldId],
        );
        answerAccumulators.set(question.targetFieldId, accumulator);
      }
    }

    const topAnswers = [...answerAccumulators.values()]
      .filter((question) => question.answeredResponses > 0)
      .sort(
        (left, right) =>
          right.answeredResponses - left.answeredResponses ||
          left.label.localeCompare(right.label),
      )
      .slice(0, 6)
      .map((question) => ({
        question: question.label,
        answerStyle: question.answerStyle,
        answeredResponses: question.answeredResponses,
        answers: [...question.counts.entries()]
          .sort(
            ([leftLabel, leftCount], [rightLabel, rightCount]) =>
              rightCount - leftCount || leftLabel.localeCompare(rightLabel),
          )
          .slice(0, 5)
          .map(([answer, count]) => ({
            answer,
            count,
            share: count / question.answeredResponses,
          })),
      }));

    const questionLabels = new Map<string, string>();
    for (const questions of questionsByVersion.values()) {
      for (const question of questions) {
        if (question.mode === "hidden") continue;
        questionLabels.set(
          question._id,
          question.label.trim() || "Untitled question",
        );
      }
    }
    const questionExitCounts = new Map<string, number>();
    for (const row of questionExitBuckets.rows) {
      if (row.orgId !== identity.orgId) continue;
      const label = questionLabels.get(row.dimension);
      if (!label) continue;
      questionExitCounts.set(
        label,
        (questionExitCounts.get(label) ?? 0) + row.count,
      );
    }
    const attributedQuestionExits = [...questionExitCounts.values()].reduce(
      (total, count) => total + count,
      0,
    );
    const questionExitSampleLimited =
      questionExitBuckets.sampleLimited || versionSampleLimited;
    const questionAbandonment = {
      items: [...questionExitCounts.entries()]
        .map(([question, count]) => ({
          question,
          count,
          share: Math.min(
            1,
            count / Math.max(totals.abandonments, 1),
          ),
        }))
        .sort(
          (left, right) =>
            right.count - left.count ||
            left.question.localeCompare(right.question),
        )
        .slice(0, 10),
      total: totals.abandonments,
      attributed: attributedQuestionExits,
      sampleLimited: questionExitSampleLimited,
      note: questionExitSampleLimited
        ? "This view uses the most recent tracked exits in the selected period."
        : attributedQuestionExits > 0
          ? `${attributedQuestionExits} of ${totals.abandonments} tracked exits reached a named question. No answer contents are collected.`
          : totals.abandonments > 0
            ? "Some exits were recorded before a question could be identified."
            : "Question exits will appear after someone starts a form and leaves before submitting.",
    };

    const devices = buildBreakdown(
      deviceBuckets.rows.filter((row) => row.orgId === identity.orgId),
      totals.views,
      DEVICE_LABELS,
      deviceBuckets.sampleLimited,
    );
    const trafficSources = buildBreakdown(
      sourceBuckets.rows.filter((row) => row.orgId === identity.orgId),
      totals.views,
      TRAFFIC_SOURCE_LABELS,
      sourceBuckets.sampleLimited,
    );

    const submittedTimes = sampledSubmissions
      .map((submission) => submission.submittedAt)
      .sort((left, right) => left - right);
    const gaps = submittedTimes
      .slice(1)
      .map((submittedAt, index) => submittedAt - submittedTimes[index]!);
    const medianGap = median(gaps);
    const sevenDaysAgo = startOfAnalyticsDay(
      shiftAnalyticsDay(args.toDay, -6),
      timeZone,
    );

    return {
      form: {
        name: form.name,
        statusLabel: formStatusLabel(form.status),
      },
      fromDay: args.fromDay,
      toDay: args.toDay,
      timeZone,
      totals,
      comparison: buildComparison(
        totals,
        previousTotals,
        previousFromDay,
        previousToDay,
      ),
      funnel: buildFunnel(totals),
      series,
      breakdowns: {
        devices,
        trafficSources,
      },
      questionAbandonment,
      topAnswers,
      responseTiming: {
        latestSubmittedAt:
          sampledSubmissions[0]?.submittedAt ?? null,
        responsesInLastSevenDays: sampledSubmissions.filter(
          (submission) => submission.submittedAt >= sevenDaysAgo,
        ).length,
        medianGapMinutes:
          medianGap === null ? null : Math.round(medianGap / 60_000),
        analyzedResponses: sampledSubmissions.length,
        sampleLimited: submissionSample.length > MAX_ANALYZED_RESPONSES,
      },
      privacy: {
        rawEventsStored: false,
        uniqueVisitorsTracked: true,
        visitorDedupe: "best_effort_daily",
        referrersTracked: false,
        rawReferrersStored: false,
        rawDeviceDetailsStored: false,
        questionAnswersStoredInEvents: false,
        visitorDedupeRetentionDays: 100,
        aggregateRetention:
          "Aggregate counts remain available with the form.",
      },
    };
  },
});

export const cleanupDedupe = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const cutoff = new Date(Date.now() - 100 * 24 * 60 * 60 * 1_000)
      .toISOString()
      .slice(0, 10);
    const rows = await ctx.db
      .query("formMetricDedupe")
      .withIndex("by_day", (q) => q.lt("day", cutoff))
      .take(250);
    for (const row of rows) await ctx.db.delete(row._id);
    if (rows.length === 250) {
      await ctx.scheduler.runAfter(0, internal.analytics.cleanupDedupe, {});
    }
    return rows.length;
  },
});
