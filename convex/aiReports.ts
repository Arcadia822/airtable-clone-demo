import { ConvexError, v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { requireFeature, requireOrgIdentity } from "./lib/auth";
import {
  requireBase,
  requireField,
  requireForm,
  requireRecord,
  requireTable,
} from "./lib/data";

const MAX_REPORT_NAME_LENGTH = 120;
const MAX_SCOPE_LABEL_LENGTH = 240;
const MAX_REPORT_CONTENT_LENGTH = 50_000;
const MAX_REPORTS_PER_STATUS = 50;
const MAX_REPORT_SOURCES = 12;
const MAX_REPORT_SOURCE_FIELDS = 100;
const MAX_REPORT_SOURCE_RECORDS = 50;
const MAX_REPORT_QUERY_DESCRIPTIONS = 12;
const MAX_REPORT_QUERY_DESCRIPTION_LENGTH = 500;
const MAX_CHART_POINTS = 90;
const MAX_CHART_LABEL_LENGTH = 120;

const reportFormatValidator = v.union(
  v.literal("report"),
  v.literal("chart"),
);

const reportCitationKindValidator = v.union(
  v.literal("table"),
  v.literal("view"),
  v.literal("form"),
  v.literal("formAnalytics"),
);

const reportCitationValidator = v.object({
  kind: reportCitationKindValidator,
  label: v.string(),
  href: v.string(),
});

const reportChartValidator = v.object({
  type: v.union(v.literal("bar"), v.literal("line")),
  title: v.string(),
  xLabel: v.string(),
  yLabel: v.string(),
  data: v.array(
    v.object({
      label: v.string(),
      value: v.number(),
    }),
  ),
});

const reportSourceInputValidator = v.object({
  kind: reportCitationKindValidator,
  baseId: v.id("bases"),
  tableId: v.optional(v.id("tables")),
  viewId: v.optional(v.id("views")),
  formId: v.optional(v.id("forms")),
  fieldIds: v.array(v.id("fields")),
  recordIds: v.optional(v.array(v.id("records"))),
  queryDescriptions: v.optional(v.array(v.string())),
});

const reportStatusValidator = v.union(
  v.literal("active"),
  v.literal("archived"),
);

const reportSummaryValidator = v.object({
  id: v.id("aiReports"),
  name: v.string(),
  scopeLabel: v.string(),
  format: reportFormatValidator,
  sourceCount: v.number(),
  status: reportStatusValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
  canArchive: v.boolean(),
});

const reportDetailValidator = v.object({
  name: v.string(),
  content: v.string(),
  scopeLabel: v.string(),
  format: reportFormatValidator,
  chart: v.union(reportChartValidator, v.null()),
  citations: v.array(reportCitationValidator),
  status: reportStatusValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const list = query({
  args: {},
  returns: v.object({
    active: v.array(reportSummaryValidator),
    archived: v.array(reportSummaryValidator),
  }),
  handler: async (ctx) => {
    const identity = await requireOrgIdentity(ctx);
    const [active, archived] = await Promise.all([
      ctx.db
        .query("aiReports")
        .withIndex("by_org_and_status", (q) =>
          q.eq("orgId", identity.orgId).eq("status", "active"),
        )
        .order("desc")
        .take(MAX_REPORTS_PER_STATUS),
      ctx.db
        .query("aiReports")
        .withIndex("by_org_and_status", (q) =>
          q.eq("orgId", identity.orgId).eq("status", "archived"),
        )
        .order("desc")
        .take(MAX_REPORTS_PER_STATUS),
    ]);

    const isAdmin = identity.orgRole?.replace(/^org:/, "") === "admin";
    const summarize = (report: (typeof active)[number]) => ({
      id: report._id,
      name: report.name,
      scopeLabel: report.scopeLabel,
      format: report.format ?? "report" as const,
      sourceCount: report.citations?.length ?? 0,
      status: report.status,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
      canArchive:
        report.status === "active" &&
        (isAdmin || report.createdByUserId === identity.userId),
    });

    return {
      active: active.map(summarize),
      archived: archived.map(summarize),
    };
  },
});

export const get = query({
  args: { reportId: v.id("aiReports") },
  returns: v.union(reportDetailValidator, v.null()),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    const report = await ctx.db.get(args.reportId);
    if (!report || report.orgId !== identity.orgId) {
      return null;
    }
    return {
      name: report.name,
      content: report.content,
      scopeLabel: report.scopeLabel,
      format: report.format ?? "report",
      chart: report.chart ?? null,
      citations: report.citations ?? [],
      status: report.status,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    };
  },
});

export const save = mutation({
  args: {
    name: v.string(),
    content: v.string(),
    scopeLabel: v.string(),
    format: v.optional(reportFormatValidator),
    chart: v.optional(reportChartValidator),
    sources: v.array(reportSourceInputValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireFeature(identity, "ai_assistant");

    const name = normalizeFriendlyText(
      args.name,
      MAX_REPORT_NAME_LENGTH,
      "REPORT_NAME_REQUIRED",
    );
    const scopeLabel = normalizeFriendlyText(
      args.scopeLabel,
      MAX_SCOPE_LABEL_LENGTH,
      "REPORT_SCOPE_REQUIRED",
    );
    const content = normalizeAnalysis(args.content);
    const format = args.format ?? "report";
    const chart =
      format === "chart" ? normalizeChart(args.chart) : undefined;
    const sources = args.sources ?? [];
    if (sources.length < 1) {
      throw new ConvexError({ code: "REPORT_SOURCE_REQUIRED" });
    }
    if (sources.length > MAX_REPORT_SOURCES) {
      throw new ConvexError({
        code: "REPORT_SOURCE_LIMIT_EXCEEDED",
        limit: MAX_REPORT_SOURCES,
      });
    }
    const activeReports = await ctx.db
      .query("aiReports")
      .withIndex("by_org_and_status", (q) =>
        q.eq("orgId", identity.orgId).eq("status", "active"),
      )
      .take(MAX_REPORTS_PER_STATUS);
    if (activeReports.length >= MAX_REPORTS_PER_STATUS) {
      throw new ConvexError({
        code: "REPORT_LIMIT_REACHED",
        limit: MAX_REPORTS_PER_STATUS,
      });
    }

    const resolvedSources = [];
    for (const source of sources) {
      resolvedSources.push(
        await resolveReportSource(ctx, identity.orgId, source),
      );
    }
    const citations = [
      ...new Map(
        resolvedSources
          .flatMap((source) => source.citations)
          .map((citation) => [
            `${citation.kind}:${citation.href}`,
            citation,
          ]),
      ).values(),
    ];
    const fieldReferences = [
      ...new Map(
        resolvedSources
          .flatMap((source) => source.fieldReferences)
          .map((reference) => [String(reference.fieldId), reference]),
      ).values(),
    ];
    if (fieldReferences.length > MAX_REPORT_SOURCE_FIELDS) {
      throw new ConvexError({
        code: "REPORT_FIELD_SOURCE_LIMIT_EXCEEDED",
        limit: MAX_REPORT_SOURCE_FIELDS,
      });
    }
    const now = Date.now();

    const reportId = await ctx.db.insert("aiReports", {
      orgId: identity.orgId,
      createdByUserId: identity.userId,
      name,
      content,
      scopeLabel,
      format,
      ...(chart ? { chart } : {}),
      citations,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    for (const reference of fieldReferences) {
      await ctx.db.insert("aiReportFieldRefs", {
        orgId: identity.orgId,
        reportId,
        ...reference,
        createdAt: now,
      });
    }
    return null;
  },
});

export const archive = mutation({
  args: { reportId: v.id("aiReports") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    const report = await ctx.db.get(args.reportId);
    if (!report || report.orgId !== identity.orgId) {
      throw new ConvexError({ code: "REPORT_NOT_FOUND" });
    }
    if (report.status === "archived") {
      return null;
    }

    const isAdmin = identity.orgRole?.replace(/^org:/, "") === "admin";
    if (!isAdmin && report.createdByUserId !== identity.userId) {
      throw new ConvexError({ code: "FORBIDDEN" });
    }

    const fieldReferences = await ctx.db
      .query("aiReportFieldRefs")
      .withIndex("by_report", (q) => q.eq("reportId", args.reportId))
      .take(MAX_REPORT_SOURCE_FIELDS + 1);
    if (fieldReferences.length > MAX_REPORT_SOURCE_FIELDS) {
      throw new ConvexError({ code: "REPORT_FIELD_SOURCE_LIMIT_EXCEEDED" });
    }
    const now = Date.now();
    await ctx.db.patch(args.reportId, {
      status: "archived",
      archivedAt: now,
      updatedAt: now,
    });
    for (const reference of fieldReferences) {
      await ctx.db.delete(reference._id);
    }
    return null;
  },
});

type ReportSourceInput = {
  kind: "table" | "view" | "form" | "formAnalytics";
  baseId: Id<"bases">;
  tableId?: Id<"tables">;
  viewId?: Id<"views">;
  formId?: Id<"forms">;
  fieldIds: Id<"fields">[];
  recordIds?: Id<"records">[];
  queryDescriptions?: string[];
};

type ReportChart = {
  type: "bar" | "line";
  title: string;
  xLabel: string;
  yLabel: string;
  data: Array<{ label: string; value: number }>;
};

async function resolveReportSource(
  ctx: MutationCtx,
  orgId: string,
  source: ReportSourceInput,
) {
  if (source.fieldIds.length > MAX_REPORT_SOURCE_FIELDS) {
    throw new ConvexError({
      code: "REPORT_FIELD_SOURCE_LIMIT_EXCEEDED",
      limit: MAX_REPORT_SOURCE_FIELDS,
    });
  }
  if ((source.recordIds?.length ?? 0) > MAX_REPORT_SOURCE_RECORDS) {
    throw new ConvexError({
      code: "REPORT_RECORD_SOURCE_LIMIT_EXCEEDED",
      limit: MAX_REPORT_SOURCE_RECORDS,
    });
  }
  if (
    (source.queryDescriptions?.length ?? 0) >
    MAX_REPORT_QUERY_DESCRIPTIONS
  ) {
    throw new ConvexError({
      code: "REPORT_QUERY_SOURCE_LIMIT_EXCEEDED",
      limit: MAX_REPORT_QUERY_DESCRIPTIONS,
    });
  }

  const base = await requireBase(ctx, orgId, source.baseId);
  const suppliedTable = source.tableId
    ? await requireTable(ctx, orgId, source.tableId)
    : undefined;
  if (suppliedTable && suppliedTable.baseId !== base._id) {
    throw new ConvexError({ code: "REPORT_SOURCE_SCOPE_INVALID" });
  }

  const form =
    source.kind === "form" || source.kind === "formAnalytics"
      ? source.formId
        ? await requireForm(ctx, orgId, source.formId)
        : undefined
      : undefined;
  if (!form && (source.kind === "form" || source.kind === "formAnalytics")) {
    throw new ConvexError({ code: "REPORT_SOURCE_SCOPE_INVALID" });
  }
  if (form && form.baseId !== base._id) {
    throw new ConvexError({ code: "REPORT_SOURCE_SCOPE_INVALID" });
  }

  const table = form
    ? await requireTable(ctx, orgId, form.tableId)
    : suppliedTable;
  if (!table) {
    throw new ConvexError({ code: "REPORT_SOURCE_SCOPE_INVALID" });
  }
  if (suppliedTable && suppliedTable._id !== table._id) {
    throw new ConvexError({ code: "REPORT_SOURCE_SCOPE_INVALID" });
  }

  const view =
    source.kind === "view" && source.viewId
      ? await ctx.db.get(source.viewId)
      : undefined;
  if (
    source.kind === "view" &&
    (!view ||
      view.orgId !== orgId ||
      view.baseId !== base._id ||
      view.tableId !== table._id ||
      view.status === "deleted")
  ) {
    throw new ConvexError({ code: "REPORT_SOURCE_SCOPE_INVALID" });
  }

  const fieldReferences = [];
  for (const fieldId of new Set(source.fieldIds)) {
    const field = await requireField(ctx, orgId, fieldId, true);
    if (field.baseId !== base._id || field.tableId !== table._id) {
      throw new ConvexError({ code: "REPORT_SOURCE_SCOPE_INVALID" });
    }
    fieldReferences.push({
      baseId: base._id,
      tableId: table._id,
      fieldId: field._id,
    });
  }

  const queryDescriptions = [
    ...new Set(
      (source.queryDescriptions ?? []).map((description) =>
        normalizeFriendlyText(
          description,
          MAX_REPORT_QUERY_DESCRIPTION_LENGTH,
          "REPORT_QUERY_SOURCE_INVALID",
        ),
      ),
    ),
  ];
  const resourceHref =
    source.kind === "view" && view
      ? `/bases/${routeSegment(base._id)}/tables/${routeSegment(
          table._id,
        )}?view=${encodeURIComponent(view._id)}`
      : source.kind === "form" || source.kind === "formAnalytics"
        ? `/bases/${routeSegment(base._id)}/forms/${routeSegment(
            form!._id,
          )}${source.kind === "formAnalytics" ? "/analytics" : ""}`
        : `/bases/${routeSegment(base._id)}/tables/${routeSegment(table._id)}`;
  const citations = queryDescriptions.map((description) => ({
    kind: source.kind,
    label: `Query · ${description}`,
    href: resourceHref,
  }));
  const recordIds = [...new Set(source.recordIds ?? [])];
  const primaryField = table.primaryFieldId
    ? await ctx.db.get(table.primaryFieldId)
    : undefined;
  for (const [index, recordId] of recordIds.entries()) {
    const record = await requireRecord(ctx, orgId, recordId);
    if (record.baseId !== base._id || record.tableId !== table._id) {
      throw new ConvexError({ code: "REPORT_SOURCE_SCOPE_INVALID" });
    }
    const params = new URLSearchParams();
    if (view) params.set("view", view._id);
    params.set("record", record._id);
    citations.push({
      kind: source.kind,
      label: `Record · ${friendlyRecordName(record, primaryField, index)}`,
      href: `/bases/${routeSegment(base._id)}/tables/${routeSegment(
        table._id,
      )}?${params.toString()}`,
    });
  }

  if (source.kind === "view" && view) {
    return {
      citations: citations.length
        ? citations
        : [
            {
              kind: source.kind,
              label: `View · ${friendlyResourceName(view.name)}`,
              href: resourceHref,
            },
          ],
      fieldReferences,
    };
  }
  if (source.kind === "table") {
    return {
      citations: citations.length
        ? citations
        : [
            {
              kind: source.kind,
              label: `Table · ${friendlyResourceName(table.name)}`,
              href: resourceHref,
            },
          ],
      fieldReferences,
    };
  }
  if (form) {
    return {
      citations: citations.length
        ? citations
        : [
            {
              kind: source.kind,
              label:
                source.kind === "formAnalytics"
                  ? `Form analytics · ${friendlyResourceName(form.name)}`
                  : `Form · ${friendlyResourceName(form.name)}`,
              href: resourceHref,
            },
          ],
      fieldReferences,
    };
  }
  throw new ConvexError({ code: "REPORT_SOURCE_SCOPE_INVALID" });
}

function friendlyRecordName(
  record: Awaited<ReturnType<typeof requireRecord>>,
  primaryField: Awaited<ReturnType<typeof requireField>> | null | undefined,
  index: number,
): string {
  if (!primaryField) return `Record ${index + 1}`;
  const value = record.values[primaryField._id];
  const optionLabel = (optionId: unknown) =>
    typeof optionId === "string"
      ? primaryField.config.options?.find((option) => option.id === optionId)
          ?.label
      : undefined;
  const readable =
    primaryField.type === "singleSelect"
      ? optionLabel(value)
      : primaryField.type === "multiSelect" && Array.isArray(value)
        ? value.map(optionLabel).filter(Boolean).join(", ")
        : typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean"
          ? String(value)
          : undefined;
  return readable?.trim()
    ? friendlyResourceName(readable)
    : `Record ${index + 1}`;
}

function normalizeChart(value: ReportChart | undefined): ReportChart {
  if (!value || value.data.length < 1 || value.data.length > MAX_CHART_POINTS) {
    throw new ConvexError({
      code: "REPORT_CHART_INVALID",
      maxPoints: MAX_CHART_POINTS,
    });
  }
  const data = value.data.map((point) => {
    if (!Number.isFinite(point.value) || point.value < 0) {
      throw new ConvexError({ code: "REPORT_CHART_INVALID" });
    }
    return {
      label: normalizeFriendlyText(
        point.label,
        MAX_CHART_LABEL_LENGTH,
        "REPORT_CHART_INVALID",
      ),
      value: point.value,
    };
  });
  return {
    type: value.type,
    title: normalizeFriendlyText(
      value.title,
      MAX_REPORT_NAME_LENGTH,
      "REPORT_CHART_INVALID",
    ),
    xLabel: normalizeFriendlyText(
      value.xLabel,
      MAX_CHART_LABEL_LENGTH,
      "REPORT_CHART_INVALID",
    ),
    yLabel: normalizeFriendlyText(
      value.yLabel,
      MAX_CHART_LABEL_LENGTH,
      "REPORT_CHART_INVALID",
    ),
    data,
  };
}

function friendlyResourceName(value: string): string {
  return value.trim().slice(0, MAX_SCOPE_LABEL_LENGTH) || "Untitled";
}

function routeSegment(value: string): string {
  return encodeURIComponent(value);
}

function normalizeFriendlyText(
  value: string,
  maxLength: number,
  errorCode: string,
): string {
  const normalized = redactInternalReferences(value).trim();
  if (!normalized || normalized.length > maxLength) {
    throw new ConvexError({ code: errorCode, maxLength });
  }
  return normalized;
}

function normalizeAnalysis(value: string): string {
  const normalized = redactInternalReferences(value).trim();
  if (!normalized || normalized.length > MAX_REPORT_CONTENT_LENGTH) {
    throw new ConvexError({
      code: "REPORT_CONTENT_INVALID",
      maxLength: MAX_REPORT_CONTENT_LENGTH,
    });
  }
  return normalized;
}

function redactInternalReferences(value: string): string {
  return value
    .replace(
      /```(?:json|javascript|typescript|js|ts)?\s*[\s\S]*?```/gi,
      "Technical details hidden.",
    )
    .replace(
      /\b(?:baseId|tableId|formId|formFieldId|fieldId|recordId|viewId|operationId|organizationId|userId|sessionId|turnId|callId|requestId|continuationToken|idempotencyKey|payloadHash|proofHash)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|`[^`]*`|[^\s,;)}\]]+)/gi,
      "the selected item",
    )
    .replace(
      /\b(?:org|user|session|turn|base|table|form|field|record|view|operation)_[a-z0-9_-]+\b/gi,
      "the selected item",
    )
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      "the selected item",
    )
    .replace(/\b[a-z0-9]{30,40}\b/gi, "the selected item")
    .replace(
      /\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/g,
      "a secure credential",
    )
    .replace(
      /\b(?:baseId|tableId|formId|formFieldId|fieldId|recordId|viewId|operationId|organizationId|userId|sessionId|turnId|callId|requestId|continuationToken|idempotencyKey|payloadHash|proofHash)\b/gi,
      "the selected item",
    );
}
