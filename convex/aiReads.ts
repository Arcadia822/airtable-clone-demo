import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { tableRecordCount } from "./lib/aggregates";
import {
  requireBase,
  requireForm,
  requireTable,
} from "./lib/data";
import { PLAN_LIMITS } from "./lib/quotas";

type JsonObject = Record<string, unknown>;

function objectValue(value: unknown, label = "input"): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ConvexError({ code: "INVALID_EVE_INPUT", field: label });
  }
  return value as JsonObject;
}

function stringValue(
  object: JsonObject,
  key: string,
  maxLength = 256,
): string {
  const value = object[key];
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maxLength
  ) {
    throw new ConvexError({ code: "INVALID_EVE_INPUT", field: key });
  }
  return value;
}

function optionalString(
  object: JsonObject,
  key: string,
  maxLength = 1_024,
): string | undefined {
  const value = object[key];
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maxLength
  ) {
    throw new ConvexError({ code: "INVALID_EVE_INPUT", field: key });
  }
  return value;
}

function integerValue(
  object: JsonObject,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = object[key] ?? fallback;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new ConvexError({ code: "INVALID_EVE_INPUT", field: key });
  }
  return value;
}

function stringArray(
  object: JsonObject,
  key: string,
  maximum: number,
  required = false,
): string[] | undefined {
  const value = object[key];
  if (value === undefined && !required) return undefined;
  if (
    !Array.isArray(value) ||
    (required && value.length === 0) ||
    value.length > maximum ||
    value.some(
      (item) =>
        typeof item !== "string" || !item.trim() || item.length > 256,
    )
  ) {
    throw new ConvexError({ code: "INVALID_EVE_INPUT", field: key });
  }
  return value as string[];
}

function friendlyRecordName(
  record: Doc<"records">,
  primaryField: Doc<"fields"> | undefined,
  index: number,
): string {
  if (!primaryField) return `Record ${index + 1}`;
  const value = recordFieldValue(record, primaryField);
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
  const normalized = readable?.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, 240) : `Record ${index + 1}`;
}

async function requireSession(
  ctx: QueryCtx,
  organizationId: string,
  userId: string,
  externalSessionId: string,
): Promise<Doc<"aiSessions">> {
  const session = await ctx.db
    .query("aiSessions")
    .withIndex("by_external_session", (q) =>
      q.eq("externalSessionId", externalSessionId),
    )
    .unique();
  if (
    !session ||
    session.orgId !== organizationId ||
    session.ownerUserId !== userId ||
    session.status !== "active"
  ) {
    throw new ConvexError({ code: "EVE_SESSION_FORBIDDEN" });
  }
  return session;
}

async function requireScopedTable(
  ctx: QueryCtx,
  organizationId: string,
  input: JsonObject,
) {
  const baseId = stringValue(input, "baseId") as Id<"bases">;
  const tableId = stringValue(input, "tableId") as Id<"tables">;
  const base = await requireBase(ctx, organizationId, baseId);
  const table = await requireTable(ctx, organizationId, tableId);
  if (table.baseId !== base._id) {
    throw new ConvexError({ code: "TABLE_NOT_IN_BASE" });
  }
  return { base, table };
}

async function optionalScopedView(
  ctx: QueryCtx,
  organizationId: string,
  baseId: Id<"bases">,
  tableId: Id<"tables">,
  input: JsonObject,
) {
  const viewId = optionalString(input, "viewId", 256);
  if (!viewId) return undefined;
  const view = await ctx.db.get(viewId as Id<"views">);
  if (
    !view ||
    view.orgId !== organizationId ||
    view.baseId !== baseId ||
    view.tableId !== tableId ||
    view.status === "deleted"
  ) {
    throw new ConvexError({ code: "VIEW_NOT_FOUND" });
  }
  return view;
}

async function describeTable(
  ctx: QueryCtx,
  organizationId: string,
  input: JsonObject,
) {
  const { base, table } = await requireScopedTable(
    ctx,
    organizationId,
    input,
  );
  const fields = await ctx.db
    .query("fields")
    .withIndex("by_table_and_status_and_rank", (q) =>
      q.eq("tableId", table._id).eq("status", "active"),
    )
    .take(101);
  const count = await tableRecordCount.count(ctx, {
    namespace: table._id,
  });
  return {
    base: { id: base._id, name: base.name },
    table: {
      id: table._id,
      name: table.name,
      recordCount: count,
      fields: fields.slice(0, 100).map((field) => ({
        id: field._id,
        name: field.name,
        type: field.type,
        revision: field.revision,
        config: field.config,
      })),
    },
    source: {
      kind: "table",
      base: { id: base._id, name: base.name },
      table: { id: table._id, name: table.name },
      fields: fields.slice(0, 100).map((field) => ({
        id: field._id,
        name: field.name,
      })),
    },
    truncated: fields.length > 100,
  };
}

async function listRecords(
  ctx: QueryCtx,
  organizationId: string,
  input: JsonObject,
) {
  const { base, table } = await requireScopedTable(
    ctx,
    organizationId,
    input,
  );
  const view = await optionalScopedView(
    ctx,
    organizationId,
    base._id,
    table._id,
    input,
  );
  if (input.search !== undefined || input.sort !== undefined) {
    throw new ConvexError({
      code: "EVE_FILTER_NOT_SUPPORTED",
      message: "Search and dynamic sorting are not available in this view.",
    });
  }
  const limit = integerValue(input, "limit", 25, 1, 50);
  const cursor = optionalString(input, "cursor");
  const requestedFieldIds = stringArray(input, "fieldIds", 20);
  const fields = await ctx.db
    .query("fields")
    .withIndex("by_table_and_status_and_rank", (q) =>
      q.eq("tableId", table._id).eq("status", "active"),
    )
    .take(PLAN_LIMITS.pro.fieldsPerTable + 1);
  const byId = new Map(fields.map((field) => [String(field._id), field]));
  const projectedIds =
    requestedFieldIds ??
    fields.slice(0, 20).map((field) => String(field._id));
  for (const fieldId of projectedIds) {
    if (!byId.has(fieldId)) {
      throw new ConvexError({ code: "FIELD_NOT_FOUND", fieldId });
    }
  }

  const result = await ctx.db
    .query("records")
    .withIndex("by_table_and_status_and_rank", (q) =>
      q.eq("tableId", table._id).eq("status", "active"),
    )
    .paginate({
      cursor: cursor ?? null,
      numItems: limit,
      maximumRowsRead: limit,
      maximumBytesRead: 4 * 1_024 * 1_024,
    });

  const records = [];
  const primaryField = table.primaryFieldId
    ? byId.get(String(table.primaryFieldId))
    : undefined;
  const sourceRecords = [];
  for (const [recordIndex, record] of result.page.entries()) {
    const values: Record<string, unknown> = {};
    const attachmentCounts: Record<string, number> = {};
    for (const fieldId of projectedIds) {
      const field = byId.get(fieldId)!;
      if (field.type === "createdTime") {
        values[fieldId] = record._creationTime;
        continue;
      }
      if (field.type === "createdBy") {
        values[fieldId] = record.createdById;
        continue;
      }
      const value = record.values[field._id];
      if (value === undefined) continue;
      if (field.type === "attachment") {
        attachmentCounts[fieldId] = Array.isArray(value)
          ? Math.min(value.length, 10)
          : 0;
        continue;
      }
      values[fieldId] = value;
    }
    records.push({
      id: record._id,
      version: record.revision,
      createdAt: record._creationTime,
      updatedAt: record.updatedAt,
      values,
      ...(Object.keys(attachmentCounts).length > 0
        ? { attachmentCounts }
        : {}),
    });
    sourceRecords.push({
      id: record._id,
      name: friendlyRecordName(record, primaryField, recordIndex),
    });
  }
  const projectedFieldNames = projectedIds.map(
    (fieldId) => byId.get(fieldId)!.name,
  );

  return {
    records,
    nextCursor: result.isDone ? null : result.continueCursor,
    source: {
      kind: view ? "view" : "table",
      base: { id: base._id, name: base.name },
      table: { id: table._id, name: table.name },
      ...(view
        ? { view: { id: view._id, name: view.name } }
        : {}),
      fields: projectedIds.map((fieldId) => {
        const field = byId.get(fieldId)!;
        return { id: field._id, name: field.name };
      }),
      records: sourceRecords,
      query: {
        kind: "recordList",
        description: `Returned ${records.length} record${
          records.length === 1 ? "" : "s"
        } from ${view ? `${view.name} in ` : ""}${table.name} using ${projectedFieldNames.join(
          ", ",
        )}.`,
        rowLimit: limit,
      },
    },
    truncated: !result.isDone,
  };
}

function comparableKey(value: unknown): string {
  return JSON.stringify(value);
}

function recordFieldValue(
  record: Doc<"records">,
  field: Doc<"fields">,
): unknown {
  if (field.type === "createdTime") return record._creationTime;
  if (field.type === "createdBy") return record.createdById;
  return record.values[field._id];
}

function safeSummaryValue(
  field: Doc<"fields">,
  value: unknown,
): unknown {
  if (field.type === "attachment") {
    return Array.isArray(value) ? Math.min(value.length, 10) : 0;
  }
  return value;
}

async function summarizeTable(
  ctx: QueryCtx,
  organizationId: string,
  input: JsonObject,
) {
  const { base, table } = await requireScopedTable(
    ctx,
    organizationId,
    input,
  );
  const fieldIds = stringArray(input, "fieldIds", 10, true)!;
  const topValueLimit = integerValue(input, "topValues", 10, 1, 20);
  const groupByFieldId = optionalString(input, "groupByFieldId", 256);
  const fields = [];
  for (const fieldId of new Set([
    ...fieldIds,
    ...(groupByFieldId ? [groupByFieldId] : []),
  ])) {
    const field = await ctx.db.get(fieldId as Id<"fields">);
    if (
      !field ||
      field.orgId !== organizationId ||
      field.tableId !== table._id ||
      field.status !== "active"
    ) {
      throw new ConvexError({ code: "FIELD_NOT_FOUND", fieldId });
    }
    fields.push(field);
  }
  const byId = new Map(fields.map((field) => [String(field._id), field]));
  const page = await ctx.db
    .query("records")
    .withIndex("by_table_and_status_and_rank", (q) =>
      q.eq("tableId", table._id).eq("status", "active"),
    )
    .paginate({
      cursor: null,
      numItems: 500,
      maximumRowsRead: 500,
      maximumBytesRead: 8 * 1_024 * 1_024,
    });
  const exactCount = await tableRecordCount.count(ctx, {
    namespace: table._id,
  });

  const summaries = fieldIds.map((fieldId) => {
    const field = byId.get(fieldId)!;
    const values = page.page
      .map((record) => recordFieldValue(record, field))
      .filter(
        (value) =>
          value !== undefined &&
          value !== "" &&
          (!Array.isArray(value) || value.length > 0),
      )
      .map((value) => safeSummaryValue(field, value));
    const counts = new Map<string, { value: unknown; count: number }>();
    for (const value of values) {
      const key = comparableKey(value);
      const current = counts.get(key);
      counts.set(key, {
        value,
        count: (current?.count ?? 0) + 1,
      });
    }
    const numbers = values.filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value),
    );
    const topValues = [...counts.values()]
      .sort(
        (left, right) =>
          right.count - left.count ||
          comparableKey(left.value).localeCompare(
            comparableKey(right.value),
          ),
      )
      .slice(0, topValueLimit);
    return {
      fieldId: field._id,
      fieldName: field.name,
      fieldType: field.type,
      populatedCount: values.length,
      emptyCount: page.page.length - values.length,
      distinctCount: counts.size,
      ...(numbers.length > 0
        ? {
            minimum: Math.min(...numbers),
            maximum: Math.max(...numbers),
            average:
              numbers.reduce((sum, value) => sum + value, 0) /
              numbers.length,
          }
        : {}),
      ...(topValues.length > 0 ? { topValues } : {}),
    };
  });

  let grouped:
    | Array<{ group: unknown; count: number }>
    | undefined;
  if (groupByFieldId) {
    const groupField = byId.get(groupByFieldId)!;
    const counts = new Map<string, { group: unknown; count: number }>();
    for (const record of page.page) {
      const rawValue = recordFieldValue(record, groupField);
      const value =
        rawValue === undefined
          ? null
          : safeSummaryValue(groupField, rawValue);
      const key = comparableKey(value);
      const current = counts.get(key);
      counts.set(key, {
        group: value,
        count: (current?.count ?? 0) + 1,
      });
    }
    grouped = [...counts.values()]
      .sort(
        (left, right) =>
          right.count - left.count ||
          comparableKey(left.group).localeCompare(
            comparableKey(right.group),
          ),
      )
      .slice(0, 20);
  }

  return {
    recordCount: exactCount,
    summaries,
    ...(grouped ? { grouped } : {}),
    source: {
      kind: "table",
      base: { id: base._id, name: base.name },
      table: { id: table._id, name: table.name },
      fields: fields.map((field) => ({
        id: field._id,
        name: field.name,
      })),
      query: {
        kind: "tableSummary",
        description: `Summarized ${page.page.length} record${
          page.page.length === 1 ? "" : "s"
        } from ${table.name} using ${fieldIds
          .map((fieldId) => byId.get(fieldId)!.name)
          .join(", ")}${
          groupByFieldId
            ? `, grouped by ${byId.get(groupByFieldId)!.name}`
            : ""
        }, keeping up to ${topValueLimit} top values.`,
        rowLimit: 500,
      },
    },
    truncated: !page.isDone,
  };
}

async function inspectForm(
  ctx: QueryCtx,
  organizationId: string,
  input: JsonObject,
) {
  const baseId = stringValue(input, "baseId") as Id<"bases">;
  const formId = stringValue(input, "formId") as Id<"forms">;
  const base = await requireBase(ctx, organizationId, baseId);
  const form = await requireForm(ctx, organizationId, formId);
  if (form.baseId !== baseId) {
    throw new ConvexError({ code: "FORM_NOT_IN_BASE" });
  }
  const table = await requireTable(ctx, organizationId, form.tableId);
  const mappings = await ctx.db
    .query("formDraftFields")
    .withIndex("by_form_and_rank", (q) => q.eq("formId", form._id))
    .take(101);
  const fields = [];
  for (const [position, mapping] of mappings.slice(0, 100).entries()) {
    const field = await ctx.db.get(mapping.targetFieldId);
    if (!field || field.orgId !== organizationId) continue;
    fields.push({
      formFieldId: mapping._id,
      fieldId: field._id,
      fieldName: field.name,
      label: mapping.label,
      ...(mapping.description
        ? { description: mapping.description.slice(0, 1_000) }
        : {}),
      required: mapping.required,
      position,
    });
  }
  return {
      form: {
      id: form._id,
      baseId: form.baseId,
      tableId: form.tableId,
      title: form.title,
      ...(form.description
        ? { description: form.description.slice(0, 2_000) }
        : {}),
      isOpen: form.status === "published",
      submitButtonLabel: form.appearance.submitLabel,
      successMessage: form.thankYou.message,
        accentColor: form.appearance.primaryColor,
        version: form.draftRevision,
        fields,
      },
    source: {
      kind: "form",
      base: { id: base._id, name: base.name },
      table: { id: table._id, name: table.name },
      form: { id: form._id, name: form.name },
      fields: fields.map((field) => ({
        id: field.fieldId,
        name: field.fieldName,
      })),
    },
  };
}

function datesForRange(days: number): string[] {
  const dates: string[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    dates.push(
      new Date(today.getTime() - offset * 24 * 60 * 60 * 1_000)
        .toISOString()
        .slice(0, 10),
    );
  }
  return dates;
}

async function formAnalytics(
  ctx: QueryCtx,
  organizationId: string,
  input: JsonObject,
) {
  const baseId = stringValue(input, "baseId") as Id<"bases">;
  const formId = stringValue(input, "formId") as Id<"forms">;
  const days = integerValue(input, "days", 30, 1, 90);
  const base = await requireBase(ctx, organizationId, baseId);
  const form = await requireForm(ctx, organizationId, formId);
  if (form.baseId !== baseId) {
    throw new ConvexError({ code: "FORM_NOT_IN_BASE" });
  }
  const table = await requireTable(ctx, organizationId, form.tableId);
  const dates = datesForRange(days);
  const buckets = await ctx.db
    .query("formMetricBuckets")
    .withIndex("by_form_and_day", (q) =>
      q
        .eq("formId", form._id)
        .gte("day", dates[0]!)
        .lte("day", dates.at(-1)!),
    )
    .take(6_000);
  if (buckets.length >= 6_000) {
    throw new ConvexError({ code: "ANALYTICS_RANGE_TOO_LARGE" });
  }
  const byDay = new Map(
    dates.map((date) => [
      date,
      { date, views: 0, starts: 0, submissions: 0 },
    ]),
  );
  for (const bucket of buckets) {
    const row = byDay.get(bucket.day);
    if (!row) continue;
    if (bucket.metric === "view") row.views += bucket.count;
    if (bucket.metric === "start") row.starts += bucket.count;
    if (bucket.metric === "submission") row.submissions += bucket.count;
  }
  const series = [...byDay.values()];
  const totals = series.reduce(
    (result, row) => ({
      views: result.views + row.views,
      starts: result.starts + row.starts,
      submissions: result.submissions + row.submissions,
    }),
    { views: 0, starts: 0, submissions: 0 },
  );
  return {
    range: {
      from: dates[0]!,
      to: dates.at(-1)!,
      timezone: "UTC",
    },
    totals: {
      ...totals,
      completionRate:
        totals.starts === 0
          ? 0
          : Math.min(1, totals.submissions / totals.starts),
    },
    series,
    topReferrers: [],
    source: {
      kind: "formAnalytics",
      base: { id: base._id, name: base.name },
      table: { id: table._id, name: table.name },
      form: { id: form._id, name: form.name },
      fields: [],
      query: {
        kind: "formAnalytics",
        description: `Measured ${form.name} from ${dates[0]} to ${dates.at(-1)} in UTC.`,
        rowLimit: 6_000,
      },
    },
    truncated: false,
  };
}

export const read = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    sessionId: v.string(),
    operation: v.string(),
    input: v.any(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireSession(
      ctx,
      args.organizationId,
      args.userId,
      args.sessionId,
    );
    const input = objectValue(args.input);
    switch (args.operation) {
      case "describe_table":
        return await describeTable(ctx, args.organizationId, input);
      case "list_records":
        return await listRecords(ctx, args.organizationId, input);
      case "summarize_table":
        return await summarizeTable(ctx, args.organizationId, input);
      case "inspect_form":
        return await inspectForm(ctx, args.organizationId, input);
      case "form_analytics":
        return await formAnalytics(ctx, args.organizationId, input);
      default:
        throw new ConvexError({ code: "EVE_OPERATION_NOT_ALLOWED" });
    }
  },
});
