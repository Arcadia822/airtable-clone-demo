import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import {
  fieldCount,
  formCount,
  recordCount,
  tableRecordCount,
} from "./lib/aggregates";
import { writeAudit } from "./lib/audit";
import {
  validateFieldConfiguration,
  validateRecordValues,
} from "./lib/cells";
import {
  createRank,
  requireBase,
  requireField,
  requireForm,
  requireRecord,
  requireTable,
} from "./lib/data";
import { createFriendlyFormSlug } from "./lib/formSlugs";
import {
  assertBelowQuota,
  PLAN_LIMITS,
} from "./lib/quotas";
import { addFieldToActiveViews } from "./lib/viewData";
import { recordTableViewChange } from "./lib/viewChanges";

type JsonObject = Record<string, unknown>;
type MutationResult = {
  status: "applied" | "replayed";
  operationId: string;
  summary: string;
  entityIds: Record<string, string>;
};
type StoredCellValue =
  Doc<"records">["values"][Id<"fields">];

const SUPPORTED_OPERATIONS = new Set([
  "create_record",
  "update_record",
  "delete_record",
  "create_field",
  "delete_field",
  "create_form",
  "update_form_settings",
]);

const SCHEMA_OPERATIONS = new Set([
  "create_field",
  "delete_field",
  "create_form",
  "update_form_settings",
]);

function objectValue(value: unknown, label = "input"): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ConvexError({ code: "INVALID_EVE_INPUT", field: label });
  }
  return value as JsonObject;
}

function stringValue(
  object: JsonObject,
  key: string,
  maximum = 256,
): string {
  const value = object[key];
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum
  ) {
    throw new ConvexError({ code: "INVALID_EVE_INPUT", field: key });
  }
  return value.trim();
}

function optionalString(
  object: JsonObject,
  key: string,
  maximum = 256,
): string | undefined {
  if (object[key] === undefined) return undefined;
  return stringValue(object, key, maximum);
}

function requiredVersion(object: JsonObject): number {
  const value = object.expectedVersion;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new ConvexError({
      code: "INVALID_EVE_INPUT",
      field: "expectedVersion",
    });
  }
  return value;
}

function arrayValue(
  object: JsonObject,
  key: string,
  maximum: number,
): unknown[] {
  const value = object[key];
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) {
    throw new ConvexError({ code: "INVALID_EVE_INPUT", field: key });
  }
  return value;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const object = value as JsonObject;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertSameSnapshot(
  expected: unknown,
  actual: unknown,
  field = "before",
): void {
  if (stableJson(expected) !== stableJson(actual)) {
    throw new ConvexError({ code: "STALE_WRITE", field });
  }
}

function requireAdminRole(role: string | undefined): void {
  if (role?.replace(/^org:/, "") !== "admin") {
    throw new ConvexError({ code: "ORG_ADMIN_REQUIRED" });
  }
}

async function requireSession(
  ctx: MutationCtx,
  organizationId: string,
  userId: string,
  externalSessionId: string,
) {
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
  ctx: MutationCtx,
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

function eveAudit(
  organizationId: string,
  userId: string,
  sessionId: string,
  callId: string,
) {
  return {
    orgId: organizationId,
    actor: { type: "eve" as const, id: userId },
    sourceRunId: sessionId,
    sourceToolCallId: callId,
  };
}

async function createRecord(
  ctx: MutationCtx,
  scope: {
    organizationId: string;
    userId: string;
    sessionId: string;
    callId: string;
  },
  input: JsonObject,
): Promise<Omit<MutationResult, "status" | "operationId">> {
  const { table } = await requireScopedTable(
    ctx,
    scope.organizationId,
    input,
  );
  const proposed = arrayValue(input, "values", 50);
  const values: Record<string, StoredCellValue> = {};
  for (const rawEntry of proposed) {
    const entry = objectValue(rawEntry, "values");
    const fieldId = stringValue(entry, "fieldId") as Id<"fields">;
    const fieldName = stringValue(entry, "fieldName", 240);
    const field = await requireField(ctx, scope.organizationId, fieldId);
    if (field.tableId !== table._id || field.name !== fieldName) {
      throw new ConvexError({ code: "FIELD_SNAPSHOT_MISMATCH", fieldId });
    }
    if (field.type === "attachment") {
      throw new ConvexError({
        code: "EVE_ATTACHMENT_WRITE_NOT_SUPPORTED",
        fieldId,
      });
    }
    if (Object.hasOwn(values, fieldId)) {
      throw new ConvexError({ code: "DUPLICATE_FIELD_UPDATE", fieldId });
    }
    if (entry.value !== null) {
      values[fieldId] = entry.value as StoredCellValue;
    }
  }
  await validateRecordValues(
    ctx,
    scope.organizationId,
    table._id,
    values,
  );
  const used = await recordCount.count(ctx, {
    namespace: scope.organizationId,
  });
  assertBelowQuota(
    used,
    PLAN_LIMITS.pro.recordsPerOrg,
    "records_per_org",
  );

  const recordId = await ctx.db.insert("records", {
    orgId: scope.organizationId,
    baseId: table.baseId,
    tableId: table._id,
    rank: createRank(),
    values,
    status: "active",
    revision: 1,
    createdByType: "eve",
    createdById: scope.userId,
    updatedByType: "eve",
    updatedById: scope.userId,
    updatedAt: Date.now(),
  });
  const record = await ctx.db.get(recordId);
  await recordCount.insert(ctx, record!);
  await tableRecordCount.insert(ctx, record!);
  await recordTableViewChange(ctx, {
    orgId: scope.organizationId,
    baseId: table.baseId,
    tableId: table._id,
    recordIds: [recordId],
  });
  await writeAudit(ctx, {
    ...eveAudit(
      scope.organizationId,
      scope.userId,
      scope.sessionId,
      scope.callId,
    ),
    action: "record.created",
    resourceType: "record",
    resourceId: recordId,
    baseId: table.baseId,
    tableId: table._id,
    changedFieldIds: Object.keys(values) as Id<"fields">[],
    revisionAfter: 1,
  });
  return {
    summary: `Created one record in ${table.name}.`,
    entityIds: { recordId },
  };
}

async function updateRecord(
  ctx: MutationCtx,
  scope: {
    organizationId: string;
    userId: string;
    sessionId: string;
    callId: string;
  },
  input: JsonObject,
): Promise<Omit<MutationResult, "status" | "operationId">> {
  const { table } = await requireScopedTable(
    ctx,
    scope.organizationId,
    input,
  );
  const recordId = stringValue(input, "recordId") as Id<"records">;
  const record = await requireRecord(
    ctx,
    scope.organizationId,
    recordId,
  );
  if (record.tableId !== table._id) {
    throw new ConvexError({ code: "RECORD_NOT_IN_TABLE" });
  }
  const expectedVersion = requiredVersion(input);
  if (record.revision !== expectedVersion) {
    throw new ConvexError({
      code: "STALE_WRITE",
      expectedVersion,
      actualVersion: record.revision,
    });
  }
  const changes = arrayValue(input, "changes", 50);
  const values = { ...record.values };
  const changedFieldIds = new Set<Id<"fields">>();
  for (const rawChange of changes) {
    const change = objectValue(rawChange, "changes");
    const fieldId = stringValue(change, "fieldId") as Id<"fields">;
    const fieldName = stringValue(change, "fieldName", 240);
    if (changedFieldIds.has(fieldId)) {
      throw new ConvexError({ code: "DUPLICATE_FIELD_UPDATE", fieldId });
    }
    const field = await requireField(ctx, scope.organizationId, fieldId);
    if (field.tableId !== table._id || field.name !== fieldName) {
      throw new ConvexError({ code: "FIELD_SNAPSHOT_MISMATCH", fieldId });
    }
    if (field.type === "attachment") {
      throw new ConvexError({
        code: "EVE_ATTACHMENT_WRITE_NOT_SUPPORTED",
        fieldId,
      });
    }
    const current = values[fieldId] ?? null;
    assertSameSnapshot(change.before, current, fieldId);
    if (change.after === null) delete values[fieldId];
    else {
      values[fieldId] = change.after as StoredCellValue;
    }
    changedFieldIds.add(fieldId);
  }
  await validateRecordValues(
    ctx,
    scope.organizationId,
    table._id,
    values,
    { recordId: record._id },
  );
  await ctx.db.patch(record._id, {
    values,
    revision: record.revision + 1,
    updatedByType: "eve",
    updatedById: scope.userId,
    updatedAt: Date.now(),
  });
  await recordTableViewChange(ctx, {
    orgId: scope.organizationId,
    baseId: record.baseId,
    tableId: record.tableId,
    recordIds: [record._id],
  });
  await writeAudit(ctx, {
    ...eveAudit(
      scope.organizationId,
      scope.userId,
      scope.sessionId,
      scope.callId,
    ),
    action: "record.updated",
    resourceType: "record",
    resourceId: record._id,
    baseId: record.baseId,
    tableId: record.tableId,
    changedFieldIds: [...changedFieldIds],
    revisionBefore: record.revision,
    revisionAfter: record.revision + 1,
  });
  return {
    summary: `Updated ${changedFieldIds.size} field${changedFieldIds.size === 1 ? "" : "s"} on one record.`,
    entityIds: { recordId: record._id },
  };
}

async function deleteRecord(
  ctx: MutationCtx,
  scope: {
    organizationId: string;
    userId: string;
    sessionId: string;
    callId: string;
  },
  input: JsonObject,
): Promise<Omit<MutationResult, "status" | "operationId">> {
  const { table } = await requireScopedTable(
    ctx,
    scope.organizationId,
    input,
  );
  const recordId = stringValue(input, "recordId") as Id<"records">;
  const record = await requireRecord(
    ctx,
    scope.organizationId,
    recordId,
  );
  if (record.tableId !== table._id) {
    throw new ConvexError({ code: "RECORD_NOT_IN_TABLE" });
  }
  const expectedVersion = requiredVersion(input);
  if (expectedVersion !== record.revision) {
    throw new ConvexError({
      code: "STALE_WRITE",
      expectedVersion,
      actualVersion: record.revision,
    });
  }
  const primaryValue = table.primaryFieldId
    ? record.values[table.primaryFieldId] ?? null
    : null;
  assertSameSnapshot(
    input.expectedPrimaryValue,
    primaryValue,
    "expectedPrimaryValue",
  );
  arrayValue(input, "deletionSummary", 20);

  await ctx.db.patch(record._id, {
    status: "deleted",
    deletedAt: Date.now(),
    revision: record.revision + 1,
    updatedByType: "eve",
    updatedById: scope.userId,
    updatedAt: Date.now(),
  });
  await recordCount.delete(ctx, record);
  await tableRecordCount.delete(ctx, record);
  await recordTableViewChange(ctx, {
    orgId: scope.organizationId,
    baseId: record.baseId,
    tableId: record.tableId,
    recordIds: [record._id],
  });
  await writeAudit(ctx, {
    ...eveAudit(
      scope.organizationId,
      scope.userId,
      scope.sessionId,
      scope.callId,
    ),
    action: "record.deleted",
    resourceType: "record",
    resourceId: record._id,
    baseId: record.baseId,
    tableId: record.tableId,
    revisionBefore: record.revision,
    revisionAfter: record.revision + 1,
  });
  return {
    summary: `Deleted one record from ${table.name}.`,
    entityIds: { recordId: record._id },
  };
}

function normalizeFieldType(value: unknown): Doc<"fields">["type"] {
  const supported = new Set<Doc<"fields">["type"]>([
    "singleLineText",
    "longText",
    "number",
    "currency",
    "percent",
    "rating",
    "checkbox",
    "date",
    "email",
    "phone",
    "url",
    "singleSelect",
    "multiSelect",
    "attachment",
    "createdTime",
    "createdBy",
  ]);
  if (typeof value !== "string" || !supported.has(value as never)) {
    throw new ConvexError({
      code: "UNSUPPORTED_FIELD_TYPE",
      fieldType: String(value),
    });
  }
  return value as Doc<"fields">["type"];
}

function normalizeFieldConfig(
  raw: unknown,
): Doc<"fields">["config"] {
  const source = raw === undefined ? {} : objectValue(raw, "config");
  const config: Doc<"fields">["config"] = {};
  for (const key of [
    "maxLength",
    "min",
    "max",
    "precision",
  ] as const) {
    if (source[key] !== undefined) {
      if (
        typeof source[key] !== "number" ||
        !Number.isFinite(source[key])
      ) {
        throw new ConvexError({
          code: "INVALID_FIELD_CONFIG",
          key,
        });
      }
      config[key] = source[key] as number;
    }
  }
  for (const key of ["currency"] as const) {
    if (source[key] !== undefined) {
      if (
        typeof source[key] !== "string" ||
        source[key].length > 16
      ) {
        throw new ConvexError({
          code: "INVALID_FIELD_CONFIG",
          key,
        });
      }
      config[key] = source[key] as string;
    }
  }
  if (
    source.dateStyle === "date" ||
    source.dateStyle === "dateTime"
  ) {
    config.dateStyle = source.dateStyle;
  }
  if (
    source.attachmentKind === "image" ||
    source.attachmentKind === "file" ||
    source.attachmentKind === "any"
  ) {
    config.attachmentKind = source.attachmentKind;
  }
  if (typeof source.includeTime === "boolean") {
    config.includeTime = source.includeTime;
  }
  if (source.acceptedMimeTypes !== undefined) {
    if (
      !Array.isArray(source.acceptedMimeTypes) ||
      source.acceptedMimeTypes.length > 50 ||
      source.acceptedMimeTypes.some(
        (entry) =>
          typeof entry !== "string" ||
          !entry.trim() ||
          entry.length > 160,
      )
    ) {
      throw new ConvexError({
        code: "INVALID_FIELD_CONFIG",
        key: "acceptedMimeTypes",
      });
    }
    config.acceptedMimeTypes = source.acceptedMimeTypes as string[];
  }
  if (source.options !== undefined) {
    if (!Array.isArray(source.options) || source.options.length > 250) {
      throw new ConvexError({
        code: "INVALID_FIELD_CONFIG",
        key: "options",
      });
    }
    config.options = source.options.map((rawOption, index) => {
      const option = objectValue(rawOption, "options");
      return {
        id:
          typeof option.id === "string" && option.id
            ? option.id.slice(0, 120)
            : crypto.randomUUID(),
        label: stringValue(option, "label", 120),
        color:
          typeof option.color === "string" && option.color.length <= 64
            ? option.color
            : "#64748b",
        rank: String(index).padStart(4, "0"),
      };
    });
  }
  return config;
}

async function createField(
  ctx: MutationCtx,
  scope: {
    organizationId: string;
    userId: string;
    sessionId: string;
    callId: string;
  },
  input: JsonObject,
): Promise<Omit<MutationResult, "status" | "operationId">> {
  const { table } = await requireScopedTable(
    ctx,
    scope.organizationId,
    input,
  );
  const proposed = objectValue(input.field, "field");
  const name = stringValue(proposed, "name", 120);
  const configSource =
    proposed.config === undefined
      ? {}
      : objectValue(proposed.config, "config");
  const type = normalizeFieldType(proposed.type);
  const config = normalizeFieldConfig(configSource);
  validateFieldConfiguration(type, config);
  const count = await fieldCount.count(ctx, { namespace: table._id });
  assertBelowQuota(
    count,
    PLAN_LIMITS.pro.fieldsPerTable,
    "fields_per_table",
  );
  const insertAfterFieldId = optionalString(
    input,
    "insertAfterFieldId",
  ) as Id<"fields"> | undefined;
  let afterRank: string | undefined;
  if (insertAfterFieldId) {
    const after = await requireField(
      ctx,
      scope.organizationId,
      insertAfterFieldId,
    );
    if (after.tableId !== table._id) {
      throw new ConvexError({ code: "FIELD_NOT_IN_TABLE" });
    }
    afterRank = after.rank;
  }
  const fieldId = await ctx.db.insert("fields", {
    orgId: scope.organizationId,
    baseId: table.baseId,
    tableId: table._id,
    name,
    type,
    config,
    rank: createRank(afterRank),
    width: 180,
    isPrimary: false,
    status: "active",
    revision: 1,
    createdByUserId: scope.userId,
    updatedAt: Date.now(),
  });
  const field = await ctx.db.get(fieldId);
  await fieldCount.insert(ctx, field!);
  await addFieldToActiveViews(ctx, field!, insertAfterFieldId);
  await writeAudit(ctx, {
    ...eveAudit(
      scope.organizationId,
      scope.userId,
      scope.sessionId,
      scope.callId,
    ),
    action: "field.created",
    resourceType: "field",
    resourceId: fieldId,
    baseId: table.baseId,
    tableId: table._id,
    revisionAfter: 1,
  });
  return {
    summary: `Created the ${name} field.`,
    entityIds: { fieldId },
  };
}

async function deleteField(
  ctx: MutationCtx,
  scope: {
    organizationId: string;
    userId: string;
    sessionId: string;
    callId: string;
  },
  input: JsonObject,
): Promise<Omit<MutationResult, "status" | "operationId">> {
  const { table } = await requireScopedTable(
    ctx,
    scope.organizationId,
    input,
  );
  const fieldId = stringValue(input, "fieldId") as Id<"fields">;
  const expectedName = stringValue(input, "expectedName", 240);
  const expectedType = stringValue(input, "expectedType", 80);
  const expectedVersion = requiredVersion(input);
  stringValue(input, "dataLossSummary", 500);
  const field = await requireField(ctx, scope.organizationId, fieldId);
  if (
    field.tableId !== table._id ||
    field.name !== expectedName ||
    field.type !== expectedType
  ) {
    throw new ConvexError({ code: "FIELD_SNAPSHOT_MISMATCH" });
  }
  if (field.revision !== expectedVersion) {
    throw new ConvexError({
      code: "STALE_WRITE",
      expectedVersion,
      actualVersion: field.revision,
    });
  }
  if (field.isPrimary || table.primaryFieldId === field._id) {
    throw new ConvexError({ code: "PRIMARY_FIELD_CANNOT_BE_DELETED" });
  }
  const publishedReference = await ctx.db
    .query("formPublishedFieldRefs")
    .withIndex("by_target_field", (q) =>
      q.eq("targetFieldId", field._id),
    )
    .first();
  if (publishedReference) {
    throw new ConvexError({
      code: "FIELD_USED_BY_PUBLISHED_FORM",
      formId: publishedReference.formId,
    });
  }
  const drafts = await ctx.db
    .query("formDraftFields")
    .withIndex("by_target_field", (q) =>
      q.eq("targetFieldId", field._id),
    )
    .take(PLAN_LIMITS.pro.formsPerBase + 1);
  for (const draft of drafts) await ctx.db.delete(draft._id);
  await ctx.db.patch(field._id, {
    status: "deleted",
    deletedAt: Date.now(),
    revision: field.revision + 1,
    updatedAt: Date.now(),
  });
  await fieldCount.delete(ctx, field);
  await writeAudit(ctx, {
    ...eveAudit(
      scope.organizationId,
      scope.userId,
      scope.sessionId,
      scope.callId,
    ),
    action: "field.deleted",
    resourceType: "field",
    resourceId: field._id,
    baseId: field.baseId,
    tableId: field.tableId,
    revisionBefore: field.revision,
    revisionAfter: field.revision + 1,
  });
  return {
    summary: `Deleted the ${field.name} field.`,
    entityIds: { fieldId: field._id },
  };
}

function validHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

async function createForm(
  ctx: MutationCtx,
  scope: {
    organizationId: string;
    userId: string;
    sessionId: string;
    callId: string;
  },
  input: JsonObject,
): Promise<Omit<MutationResult, "status" | "operationId">> {
  const { table } = await requireScopedTable(
    ctx,
    scope.organizationId,
    input,
  );
  const title = stringValue(input, "title", 160);
  const description =
    typeof input.description === "string" &&
    input.description.length <= 2_000
      ? input.description
      : "";
  const appearanceInput = objectValue(input.appearance, "appearance");
  const accentColor = appearanceInput.accentColor;
  const submitButtonLabel = stringValue(
    appearanceInput,
    "submitButtonLabel",
    80,
  );
  const successMessage = stringValue(
    appearanceInput,
    "successMessage",
    2_000,
  );
  if (!validHexColor(accentColor)) {
    throw new ConvexError({
      code: "INVALID_FORM_APPEARANCE",
      field: "accentColor",
    });
  }
  const fields = arrayValue(input, "fields", 100)
    .map((raw) => objectValue(raw, "fields"))
    .sort((left, right) => {
      const leftPosition =
        typeof left.position === "number" ? left.position : -1;
      const rightPosition =
        typeof right.position === "number" ? right.position : -1;
      return leftPosition - rightPosition;
    });
  const count = await formCount.count(ctx, {
    namespace: table.baseId,
  });
  assertBelowQuota(
    count,
    PLAN_LIMITS.pro.formsPerBase,
    "forms_per_base",
  );

  const mappings: Array<{
    field: Doc<"fields">;
    label: string;
    description?: string;
    required: boolean;
    rank: string;
  }> = [];
  const seen = new Set<string>();
  for (const [index, proposed] of fields.entries()) {
    const fieldId = stringValue(proposed, "fieldId") as Id<"fields">;
    const fieldName = stringValue(proposed, "fieldName", 240);
    const label = stringValue(proposed, "label", 160);
    const required = proposed.required;
    const position = proposed.position;
    if (
      typeof required !== "boolean" ||
      typeof position !== "number" ||
      !Number.isInteger(position) ||
      position < 0 ||
      seen.has(fieldId)
    ) {
      throw new ConvexError({ code: "INVALID_EVE_INPUT", field: "fields" });
    }
    const field = await requireField(ctx, scope.organizationId, fieldId);
    if (
      field.tableId !== table._id ||
      field.name !== fieldName ||
      field.type === "createdTime" ||
      field.type === "createdBy"
    ) {
      throw new ConvexError({ code: "FIELD_SNAPSHOT_MISMATCH", fieldId });
    }
    seen.add(fieldId);
    mappings.push({
      field,
      label,
      description:
        typeof proposed.description === "string"
          ? proposed.description.slice(0, 1_000) || undefined
          : undefined,
      required,
      rank: String(index).padStart(4, "0"),
    });
  }
  const now = Date.now();
  const name = title.slice(0, 120);
  const slug = await createFriendlyFormSlug(ctx, name);
  const formId = await ctx.db.insert("forms", {
    orgId: scope.organizationId,
    baseId: table.baseId,
    tableId: table._id,
    name,
    slug,
    title,
    description,
    rank: createRank(),
    status: "draft",
    appearance: {
      primaryColor: accentColor,
      backgroundColor: "#ffffff",
      submitLabel: submitButtonLabel,
      showPoweredBy: true,
    },
    thankYou: {
      title: "Thank you for your submission",
      message: successMessage,
    },
    allowMultipleSubmissions: true,
    draftRevision: 1,
    createdByUserId: scope.userId,
    updatedAt: now,
  });
  for (const mapping of mappings) {
    await ctx.db.insert("formDraftFields", {
      orgId: scope.organizationId,
      formId,
      targetFieldId: mapping.field._id,
      label: mapping.label,
      description: mapping.description,
      required: mapping.required,
      rank: mapping.rank,
    });
  }
  const form = await ctx.db.get(formId);
  await formCount.insert(ctx, form!);
  await writeAudit(ctx, {
    ...eveAudit(
      scope.organizationId,
      scope.userId,
      scope.sessionId,
      scope.callId,
    ),
    action: "form.created",
    resourceType: "form",
    resourceId: formId,
    baseId: table.baseId,
    tableId: table._id,
    changedFieldIds: mappings.map((mapping) => mapping.field._id),
    revisionAfter: 1,
  });
  return {
    summary: `Created the ${title} form as a draft.`,
    entityIds: { formId },
  };
}

function formPropertyValue(
  form: Doc<"forms">,
  property: string,
): unknown {
  switch (property) {
    case "title":
      return form.title;
    case "description":
      return form.description;
    case "submitButtonLabel":
      return form.appearance.submitLabel;
    case "successMessage":
      return form.thankYou.message;
    case "accentColor":
      return form.appearance.primaryColor;
    case "isOpen":
      return form.status === "published";
    case "allowMultipleSubmissions":
      return form.allowMultipleSubmissions ?? true;
    default:
      throw new ConvexError({
        code: "INVALID_EVE_INPUT",
        field: "property",
      });
  }
}

async function publishFormSnapshot(
  ctx: MutationCtx,
  form: Doc<"forms">,
  userId: string,
): Promise<Id<"formVersions">> {
  const drafts = await ctx.db
    .query("formDraftFields")
    .withIndex("by_form_and_rank", (q) => q.eq("formId", form._id))
    .take(PLAN_LIMITS.pro.fieldsPerTable + 1);
  if (drafts.length < 1 || drafts.length > PLAN_LIMITS.pro.fieldsPerTable) {
    throw new ConvexError({ code: "INVALID_FORM_FIELD_COUNT" });
  }
  const latest = await ctx.db
    .query("formVersions")
    .withIndex("by_form_and_version", (q) => q.eq("formId", form._id))
    .order("desc")
    .first();
  const version = (latest?.version ?? 0) + 1;
  const now = Date.now();
  const formVersionId = await ctx.db.insert("formVersions", {
    orgId: form.orgId,
    formId: form._id,
    baseId: form.baseId,
    tableId: form.tableId,
    version,
    title: form.title,
    description: form.description,
    appearance: form.appearance,
    thankYou: form.thankYou,
    publishedByUserId: userId,
    publishedAt: now,
  });
  const oldRefs = await ctx.db
    .query("formPublishedFieldRefs")
    .withIndex("by_form", (q) => q.eq("formId", form._id))
    .take(PLAN_LIMITS.pro.fieldsPerTable + 1);
  for (const ref of oldRefs) await ctx.db.delete(ref._id);

  const draftIndexByTarget = new Map(
    drafts.map((draft, index) => [draft.targetFieldId, index]),
  );
  const targetFields = new Map<Id<"fields">, Doc<"fields">>();
  for (const [draftIndex, draft] of drafts.entries()) {
    const field = await ctx.db.get(draft.targetFieldId);
    if (
      !field ||
      field.orgId !== form.orgId ||
      field.tableId !== form.tableId ||
      field.status !== "active" ||
      field.type === "createdTime" ||
      field.type === "createdBy"
    ) {
      throw new ConvexError({ code: "FORM_TARGET_FIELD_NOT_FOUND" });
    }
    for (const condition of draft.visibility?.conditions ?? []) {
      const sourceIndex = draftIndexByTarget.get(condition.sourceFieldId);
      if (sourceIndex === undefined || sourceIndex >= draftIndex) {
        throw new ConvexError({ code: "INVALID_FORM_VISIBILITY_RULE" });
      }
    }
    targetFields.set(field._id, field);
  }

  const versionFieldIdsByTarget = new Map<
    Id<"fields">,
    Id<"formVersionFields">
  >();
  for (const draft of drafts) {
    const field = targetFields.get(draft.targetFieldId)!;
    const versionFieldId = await ctx.db.insert("formVersionFields", {
      orgId: form.orgId,
      formId: form._id,
      formVersionId,
      targetFieldId: field._id,
      targetFieldType: field.type,
      targetFieldConfig: field.config,
      label: draft.label,
      description: draft.description,
      placeholder: draft.placeholder,
      required: draft.required,
      rank: draft.rank,
    });
    versionFieldIdsByTarget.set(field._id, versionFieldId);
    await ctx.db.insert("formPublishedFieldRefs", {
      orgId: form.orgId,
      formId: form._id,
      formVersionId,
      targetFieldId: field._id,
    });
  }
  for (const draft of drafts) {
    if (!draft.visibility?.conditions.length) continue;
    await ctx.db.patch(
      versionFieldIdsByTarget.get(draft.targetFieldId)!,
      {
        visibility: {
          conjunction: draft.visibility.conjunction,
          conditions: draft.visibility.conditions.map((condition) => ({
            id: condition.id,
            sourceQuestionId: versionFieldIdsByTarget.get(
              condition.sourceFieldId,
            )!,
            sourceFieldId: condition.sourceFieldId,
            operator: condition.operator,
            value: condition.value,
          })),
        },
      },
    );
  }
  await ctx.db.patch(form._id, {
    currentPublishedVersionId: formVersionId,
    status: "published",
    publishedAt: now,
    updatedAt: now,
  });
  return formVersionId;
}

async function updateFormSettings(
  ctx: MutationCtx,
  scope: {
    organizationId: string;
    userId: string;
    sessionId: string;
    callId: string;
  },
  input: JsonObject,
): Promise<Omit<MutationResult, "status" | "operationId">> {
  const baseId = stringValue(input, "baseId") as Id<"bases">;
  const formId = stringValue(input, "formId") as Id<"forms">;
  await requireBase(ctx, scope.organizationId, baseId);
  const form = await requireForm(ctx, scope.organizationId, formId);
  if (form.baseId !== baseId) {
    throw new ConvexError({ code: "FORM_NOT_IN_BASE" });
  }
  const expectedVersion = requiredVersion(input);
  if (form.draftRevision !== expectedVersion) {
    throw new ConvexError({
      code: "STALE_WRITE",
      expectedVersion,
      actualVersion: form.draftRevision,
    });
  }
  const changes = arrayValue(input, "changes", 20);
  const properties = new Set<string>();
  const patch: {
    title?: string;
    description?: string;
    appearance?: Doc<"forms">["appearance"];
    thankYou?: Doc<"forms">["thankYou"];
    allowMultipleSubmissions?: boolean;
    draftRevision: number;
    updatedAt: number;
  } = {
    draftRevision: form.draftRevision + 1,
    updatedAt: Date.now(),
  };
  const appearance = { ...form.appearance };
  const thankYou = { ...form.thankYou };
  let appearanceChanged = false;
  let thankYouChanged = false;
  let isOpenAfter: boolean | undefined;
  for (const rawChange of changes) {
    const change = objectValue(rawChange, "changes");
    const property = stringValue(change, "property", 80);
    if (properties.has(property)) {
      throw new ConvexError({
        code: "DUPLICATE_FORM_PROPERTY",
        property,
      });
    }
    properties.add(property);
    assertSameSnapshot(
      change.before,
      formPropertyValue(form, property),
      property,
    );
    switch (property) {
      case "title":
        if (
          typeof change.after !== "string" ||
          !change.after.trim() ||
          change.after.length > 160
        ) {
          throw new ConvexError({
            code: "INVALID_FORM_TITLE",
          });
        }
        patch.title = change.after.trim();
        break;
      case "description":
        if (
          typeof change.after !== "string" ||
          change.after.length > 2_000
        ) {
          throw new ConvexError({
            code: "INVALID_FORM_DESCRIPTION",
          });
        }
        patch.description = change.after;
        break;
      case "submitButtonLabel":
        if (
          typeof change.after !== "string" ||
          !change.after.trim() ||
          change.after.length > 80
        ) {
          throw new ConvexError({
            code: "INVALID_FORM_APPEARANCE",
          });
        }
        appearance.submitLabel = change.after.trim();
        appearanceChanged = true;
        break;
      case "successMessage":
        if (
          typeof change.after !== "string" ||
          !change.after.trim() ||
          change.after.length > 2_000
        ) {
          throw new ConvexError({
            code: "INVALID_THANK_YOU",
          });
        }
        thankYou.message = change.after.trim();
        thankYouChanged = true;
        break;
      case "accentColor":
        if (!validHexColor(change.after)) {
          throw new ConvexError({
            code: "INVALID_FORM_APPEARANCE",
          });
        }
        appearance.primaryColor = change.after;
        appearanceChanged = true;
        break;
      case "isOpen":
        if (typeof change.after !== "boolean") {
          throw new ConvexError({
            code: "INVALID_EVE_INPUT",
            field: property,
          });
        }
        isOpenAfter = change.after;
        break;
      case "allowMultipleSubmissions":
        if (typeof change.after !== "boolean") {
          throw new ConvexError({
            code: "INVALID_EVE_INPUT",
            field: property,
          });
        }
        patch.allowMultipleSubmissions = change.after;
        break;
      default:
        throw new ConvexError({
          code: "INVALID_EVE_INPUT",
          field: property,
        });
    }
  }
  if (appearanceChanged) patch.appearance = appearance;
  if (thankYouChanged) patch.thankYou = thankYou;
  await ctx.db.patch(form._id, patch);

  let publishedVersionId: Id<"formVersions"> | undefined;
  if (isOpenAfter === false && form.status === "published") {
    const refs = await ctx.db
      .query("formPublishedFieldRefs")
      .withIndex("by_form", (q) => q.eq("formId", form._id))
      .take(PLAN_LIMITS.pro.fieldsPerTable + 1);
    for (const ref of refs) await ctx.db.delete(ref._id);
    await ctx.db.patch(form._id, {
      status: "closed",
      updatedAt: Date.now(),
    });
  } else if (
    isOpenAfter === true ||
    (isOpenAfter !== false && form.status === "published")
  ) {
    const updated = await ctx.db.get(form._id);
    publishedVersionId = await publishFormSnapshot(
      ctx,
      updated!,
      scope.userId,
    );
  }
  await writeAudit(ctx, {
    ...eveAudit(
      scope.organizationId,
      scope.userId,
      scope.sessionId,
      scope.callId,
    ),
    action: "form.settings_updated",
    resourceType: "form",
    resourceId: form._id,
    baseId: form.baseId,
    tableId: form.tableId,
    revisionBefore: form.draftRevision,
    revisionAfter: form.draftRevision + 1,
  });
  return {
    summary: `Updated ${properties.size} setting${properties.size === 1 ? "" : "s"} on ${form.title}.`,
    entityIds: {
      formId: form._id,
      ...(publishedVersionId
        ? { formVersionId: publishedVersionId }
        : {}),
    },
  };
}

export const apply = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    sessionId: v.string(),
    callId: v.string(),
    role: v.optional(v.string()),
    operation: v.string(),
    idempotencyKey: v.string(),
    payloadHash: v.string(),
    input: v.any(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<MutationResult> => {
    if (
      !SUPPORTED_OPERATIONS.has(args.operation) ||
      !args.callId ||
      args.callId.length > 256 ||
      !args.idempotencyKey ||
      args.idempotencyKey.length > 256 ||
      !/^[a-f0-9]{64}$/.test(args.payloadHash)
    ) {
      throw new ConvexError({ code: "INVALID_EVE_WRITE" });
    }
    const session = await requireSession(
      ctx,
      args.organizationId,
      args.userId,
      args.sessionId,
    );
    if (SCHEMA_OPERATIONS.has(args.operation)) {
      requireAdminRole(args.role);
    }
    const receipt = await ctx.db
      .query("aiCommandReceipts")
      .withIndex("by_org_and_idempotency_key", (q) =>
        q
          .eq("orgId", args.organizationId)
          .eq("idempotencyKey", args.idempotencyKey),
      )
      .unique();
    if (receipt) {
      if (receipt.payloadHash !== args.payloadHash) {
        throw new ConvexError({ code: "IDEMPOTENCY_CONFLICT" });
      }
      const previous = objectValue(receipt.result, "receipt");
      return {
        status: "replayed",
        operationId: stringValue(previous, "operationId"),
        summary: stringValue(previous, "summary", 1_000),
        entityIds: objectValue(previous.entityIds, "entityIds") as Record<
          string,
          string
        >,
      };
    }

    const scope = {
      organizationId: args.organizationId,
      userId: args.userId,
      sessionId: args.sessionId,
      callId: args.callId,
    };
    const input = objectValue(args.input);
    let operationResult: Omit<
      MutationResult,
      "status" | "operationId"
    >;
    switch (args.operation) {
      case "create_record":
        operationResult = await createRecord(ctx, scope, input);
        break;
      case "update_record":
        operationResult = await updateRecord(ctx, scope, input);
        break;
      case "delete_record":
        operationResult = await deleteRecord(ctx, scope, input);
        break;
      case "create_field":
        operationResult = await createField(ctx, scope, input);
        break;
      case "delete_field":
        operationResult = await deleteField(ctx, scope, input);
        break;
      case "create_form":
        operationResult = await createForm(ctx, scope, input);
        break;
      case "update_form_settings":
        operationResult = await updateFormSettings(ctx, scope, input);
        break;
      default:
        throw new ConvexError({ code: "EVE_OPERATION_NOT_ALLOWED" });
    }
    const result: MutationResult = {
      status: "applied",
      operationId: args.idempotencyKey,
      ...operationResult,
    };
    await ctx.db.insert("aiCommandReceipts", {
      orgId: args.organizationId,
      sessionId: session._id,
      idempotencyKey: args.idempotencyKey,
      toolCallId: args.callId,
      operation: args.operation,
      payloadHash: args.payloadHash,
      result,
      createdAt: Date.now(),
    });
    return result;
  },
});
