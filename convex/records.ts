import { paginationOptsValidator } from "convex/server";
import { ConvexError, getConvexSize, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { recordCount, tableRecordCount } from "./lib/aggregates";
import { requireOrgIdentity } from "./lib/auth";
import { userActor, writeAudit } from "./lib/audit";
import { validateCellValue, validateRecordValues } from "./lib/cells";
import { createRank, requireField, requireRecord, requireTable } from "./lib/data";
import {
  assertFieldConversionUnlocked,
  assertFieldConversionsUnlocked,
  assertTableFieldConversionsUnlocked,
  overlayFieldConversionSourceValues,
} from "./lib/fieldConversionLocks";
import {
  assertBelowQuota,
  MAX_BATCH_CELL_UPDATES,
  MAX_BATCH_RECORDS,
  MAX_GRID_PAGE_SIZE,
  MAX_RECORD_VALUE_BYTES,
  MAX_RECORD_MUTATION_IDEMPOTENCY_KEY_LENGTH,
  PLAN_LIMITS,
} from "./lib/quotas";
import {
  nullableCellValueValidator,
  recordValuesValidator,
} from "./lib/validators";
import { recordTableViewChange } from "./lib/viewChanges";

const recordRevisionValidator = v.object({
  recordId: v.id("records"),
  revision: v.number(),
});

const batchUpdateCellsResultValidator = v.object({
  appliedCount: v.number(),
  revisions: v.array(recordRevisionValidator),
  deduplicated: v.boolean(),
});

const bulkRemoveResultValidator = v.object({
  removedCount: v.number(),
  revisions: v.array(recordRevisionValidator),
  deduplicated: v.boolean(),
});

function assertIdempotencyKey(idempotencyKey: string): void {
  if (
    !idempotencyKey.trim() ||
    idempotencyKey.length > MAX_RECORD_MUTATION_IDEMPOTENCY_KEY_LENGTH
  ) {
    throw new ConvexError({
      code: "INVALID_IDEMPOTENCY_KEY",
      maxLength: MAX_RECORD_MUTATION_IDEMPOTENCY_KEY_LENGTH,
    });
  }
}

function assertExpectedRevision(
  recordId: Id<"records">,
  expectedRevision: number,
): void {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw new ConvexError({
      code: "INVALID_EXPECTED_REVISION",
      recordId,
    });
  }
}

function stableSerialize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (Number.isNaN(value)) return '"$number:NaN"';
    if (value === Number.POSITIVE_INFINITY) return '"$number:Infinity"';
    if (value === Number.NEGATIVE_INFINITY) return '"$number:-Infinity"';
    if (Object.is(value, -0)) return '"$number:-0"';
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableSerialize(object[key])}`,
      )
      .join(",")}}`;
  }
  throw new ConvexError({ code: "INVALID_IDEMPOTENCY_PAYLOAD" });
}

async function hashMutationRequest(
  operation: "batch_update_cells" | "bulk_remove",
  tableId: Id<"tables">,
  payload: unknown,
): Promise<string> {
  const encoded = new TextEncoder().encode(
    stableSerialize({ operation, tableId, payload }),
  );
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export const listPage = query({
  args: {
    tableId: v.id("tables"),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    await requireTable(ctx, identity.orgId, args.tableId);
    const result = await ctx.db
      .query("records")
      .withIndex("by_table_and_status_and_rank", (q) =>
        q.eq("tableId", args.tableId).eq("status", "active"),
      )
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(args.paginationOpts.numItems, MAX_GRID_PAGE_SIZE),
        maximumRowsRead: Math.min(
          args.paginationOpts.maximumRowsRead ?? MAX_GRID_PAGE_SIZE,
          MAX_GRID_PAGE_SIZE,
        ),
        maximumBytesRead: Math.min(
          args.paginationOpts.maximumBytesRead ?? 4 * 1024 * 1024,
          4 * 1024 * 1024,
        ),
      });
    return {
      ...result,
      page: await overlayFieldConversionSourceValues(
        ctx,
        args.tableId,
        result.page,
      ),
    };
  },
});

export const count = query({
  args: { tableId: v.id("tables") },
  returns: v.number(),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    await requireTable(ctx, identity.orgId, args.tableId);
    return await tableRecordCount.count(ctx, {
      namespace: args.tableId,
    });
  },
});

export const get = query({
  args: { recordId: v.id("records") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    const record = await requireRecord(
      ctx,
      identity.orgId,
      args.recordId,
    );
    return (
      await overlayFieldConversionSourceValues(ctx, record.tableId, [
        record,
      ])
    )[0];
  },
});

export const create = mutation({
  args: {
    tableId: v.id("tables"),
    values: recordValuesValidator,
    afterRank: v.optional(v.string()),
  },
  returns: v.id("records"),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    const table = await requireTable(ctx, identity.orgId, args.tableId);
    await assertFieldConversionsUnlocked(
      ctx,
      Object.keys(args.values) as Id<"fields">[],
    );
    await validateRecordValues(
      ctx,
      identity.orgId,
      args.tableId,
      args.values,
    );
    const count = await recordCount.count(ctx, { namespace: identity.orgId });
    assertBelowQuota(
      count,
      PLAN_LIMITS[identity.plan].recordsPerOrg,
      "records_per_org",
    );

    const recordId = await ctx.db.insert("records", {
      orgId: identity.orgId,
      baseId: table.baseId,
      tableId: args.tableId,
      rank: createRank(args.afterRank),
      values: args.values,
      status: "active",
      revision: 1,
      createdByType: "user",
      createdById: identity.userId,
      updatedByType: "user",
      updatedById: identity.userId,
      updatedAt: Date.now(),
    });
    const record = await ctx.db.get(recordId);
    await recordCount.insert(ctx, record!);
    await tableRecordCount.insert(ctx, record!);
    await recordTableViewChange(ctx, {
      orgId: identity.orgId,
      baseId: table.baseId,
      tableId: args.tableId,
      recordIds: [recordId],
    });
    await writeAudit(ctx, {
      orgId: identity.orgId,
      actor: userActor(identity),
      action: "record.created",
      resourceType: "record",
      resourceId: recordId,
      baseId: table.baseId,
      tableId: args.tableId,
      changedFieldIds: Object.keys(args.values) as Id<"fields">[],
      revisionAfter: 1,
    });
    return recordId;
  },
});

export const updateCell = mutation({
  args: {
    recordId: v.id("records"),
    fieldId: v.id("fields"),
    value: nullableCellValueValidator,
  },
  returns: v.object({ revision: v.number() }),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    const record = await requireRecord(ctx, identity.orgId, args.recordId);
    const field = await requireField(ctx, identity.orgId, args.fieldId);
    await assertFieldConversionUnlocked(ctx, field._id);
    if (field.tableId !== record.tableId) {
      throw new ConvexError({ code: "FIELD_NOT_IN_RECORD_TABLE" });
    }
    if (args.value !== null) {
      await validateCellValue(ctx, field, args.value, {
        recordId: record._id,
      });
    }

    const values = { ...record.values };
    if (args.value === null) {
      delete values[args.fieldId];
    } else {
      values[args.fieldId] = args.value;
    }
    if (getConvexSize(values) > MAX_RECORD_VALUE_BYTES) {
      throw new ConvexError({
        code: "RECORD_TOO_LARGE",
        limitBytes: MAX_RECORD_VALUE_BYTES,
      });
    }
    const revision = record.revision + 1;
    await ctx.db.patch(args.recordId, {
      values,
      revision,
      updatedByType: "user",
      updatedById: identity.userId,
      updatedAt: Date.now(),
    });
    await recordTableViewChange(ctx, {
      orgId: identity.orgId,
      baseId: record.baseId,
      tableId: record.tableId,
      recordIds: [record._id],
    });
    await writeAudit(ctx, {
      orgId: identity.orgId,
      actor: userActor(identity),
      action: "record.cell_updated",
      resourceType: "record",
      resourceId: args.recordId,
      baseId: record.baseId,
      tableId: record.tableId,
      changedFieldIds: [args.fieldId],
      revisionBefore: record.revision,
      revisionAfter: revision,
    });
    return { revision };
  },
});

export const updateCells = mutation({
  args: {
    recordId: v.id("records"),
    updates: v.array(
      v.object({
        fieldId: v.id("fields"),
        value: nullableCellValueValidator,
      }),
    ),
  },
  returns: v.object({ revision: v.number() }),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    if (args.updates.length < 1 || args.updates.length > 100) {
      throw new ConvexError({ code: "INVALID_BATCH_SIZE", limit: 100 });
    }
    await assertFieldConversionsUnlocked(
      ctx,
      args.updates.map((update) => update.fieldId),
    );
    const record = await requireRecord(ctx, identity.orgId, args.recordId);
    const values = { ...record.values };
    const fieldIds = new Set<Id<"fields">>();
    for (const update of args.updates) {
      if (fieldIds.has(update.fieldId)) {
        throw new ConvexError({ code: "DUPLICATE_FIELD_UPDATE" });
      }
      fieldIds.add(update.fieldId);
      const field = await requireField(ctx, identity.orgId, update.fieldId);
      if (field.tableId !== record.tableId) {
        throw new ConvexError({ code: "FIELD_NOT_IN_RECORD_TABLE" });
      }
      if (update.value === null) {
        delete values[update.fieldId];
      } else {
        await validateCellValue(ctx, field, update.value, {
          recordId: record._id,
        });
        values[update.fieldId] = update.value;
      }
    }
    if (getConvexSize(values) > MAX_RECORD_VALUE_BYTES) {
      throw new ConvexError({
        code: "RECORD_TOO_LARGE",
        limitBytes: MAX_RECORD_VALUE_BYTES,
      });
    }
    const revision = record.revision + 1;
    await ctx.db.patch(args.recordId, {
      values,
      revision,
      updatedByType: "user",
      updatedById: identity.userId,
      updatedAt: Date.now(),
    });
    await recordTableViewChange(ctx, {
      orgId: identity.orgId,
      baseId: record.baseId,
      tableId: record.tableId,
      recordIds: [record._id],
    });
    await writeAudit(ctx, {
      orgId: identity.orgId,
      actor: userActor(identity),
      action: "record.cells_updated",
      resourceType: "record",
      resourceId: args.recordId,
      baseId: record.baseId,
      tableId: record.tableId,
      changedFieldIds: [...fieldIds],
      revisionBefore: record.revision,
      revisionAfter: revision,
    });
    return { revision };
  },
});

export const batchUpdateCells = mutation({
  args: {
    tableId: v.id("tables"),
    operations: v.array(
      v.object({
        recordId: v.id("records"),
        fieldId: v.id("fields"),
        value: nullableCellValueValidator,
        expectedRevision: v.number(),
      }),
    ),
    idempotencyKey: v.string(),
  },
  returns: batchUpdateCellsResultValidator,
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    assertIdempotencyKey(args.idempotencyKey);
    if (
      args.operations.length < 1 ||
      args.operations.length > MAX_BATCH_CELL_UPDATES
    ) {
      throw new ConvexError({
        code: "INVALID_BATCH_SIZE",
        limit: MAX_BATCH_CELL_UPDATES,
      });
    }

    type GroupedUpdate = {
      recordId: Id<"records">;
      expectedRevision: number;
      updates: Array<{
        fieldId: Id<"fields">;
        value: (typeof args.operations)[number]["value"];
      }>;
      fieldIds: Set<Id<"fields">>;
    };
    const groups = new Map<Id<"records">, GroupedUpdate>();
    for (const operation of args.operations) {
      assertExpectedRevision(
        operation.recordId,
        operation.expectedRevision,
      );
      const existing = groups.get(operation.recordId);
      if (existing) {
        if (existing.expectedRevision !== operation.expectedRevision) {
          throw new ConvexError({
            code: "INCONSISTENT_EXPECTED_REVISION",
            recordId: operation.recordId,
          });
        }
        if (existing.fieldIds.has(operation.fieldId)) {
          throw new ConvexError({
            code: "DUPLICATE_CELL_UPDATE",
            recordId: operation.recordId,
            fieldId: operation.fieldId,
          });
        }
        existing.fieldIds.add(operation.fieldId);
        existing.updates.push({
          fieldId: operation.fieldId,
          value: operation.value,
        });
      } else {
        groups.set(operation.recordId, {
          recordId: operation.recordId,
          expectedRevision: operation.expectedRevision,
          updates: [
            {
              fieldId: operation.fieldId,
              value: operation.value,
            },
          ],
          fieldIds: new Set([operation.fieldId]),
        });
      }
    }
    if (groups.size > MAX_BATCH_RECORDS) {
      throw new ConvexError({
        code: "TOO_MANY_BATCH_RECORDS",
        limit: MAX_BATCH_RECORDS,
      });
    }

    const requestHash = await hashMutationRequest(
      "batch_update_cells",
      args.tableId,
      args.operations,
    );
    const receipt = await ctx.db
      .query("recordMutationReceipts")
      .withIndex("by_org_and_idempotency_key", (q) =>
        q
          .eq("orgId", identity.orgId)
          .eq("idempotencyKey", args.idempotencyKey),
      )
      .unique();
    if (receipt) {
      if (
        receipt.operation !== "batch_update_cells" ||
        receipt.requestHash !== requestHash
      ) {
        throw new ConvexError({ code: "IDEMPOTENCY_CONFLICT" });
      }
      return {
        appliedCount: receipt.affectedCount,
        revisions: receipt.revisions,
        deduplicated: true,
      };
    }

    const table = await requireTable(ctx, identity.orgId, args.tableId);
    const recordIds = [...groups.keys()];
    const fieldIds = [
      ...new Set(args.operations.map((operation) => operation.fieldId)),
    ];
    await assertFieldConversionsUnlocked(ctx, fieldIds);
    const [records, fields] = await Promise.all([
      Promise.all(recordIds.map((recordId) => ctx.db.get(recordId))),
      Promise.all(fieldIds.map((fieldId) => ctx.db.get(fieldId))),
    ]);
    const recordById = new Map<Id<"records">, Doc<"records">>();
    for (let index = 0; index < recordIds.length; index += 1) {
      const recordId = recordIds[index];
      const record = records[index];
      if (
        !record ||
        record.orgId !== identity.orgId ||
        record.status !== "active"
      ) {
        throw new ConvexError({ code: "RECORD_NOT_FOUND", recordId });
      }
      if (
        record.tableId !== args.tableId ||
        record.baseId !== table.baseId
      ) {
        throw new ConvexError({
          code: "RECORD_NOT_IN_TABLE",
          recordId,
          tableId: args.tableId,
        });
      }
      recordById.set(recordId, record);
    }
    const fieldById = new Map<Id<"fields">, Doc<"fields">>();
    for (let index = 0; index < fieldIds.length; index += 1) {
      const fieldId = fieldIds[index];
      const field = fields[index];
      if (
        !field ||
        field.orgId !== identity.orgId ||
        field.status !== "active"
      ) {
        throw new ConvexError({ code: "FIELD_NOT_FOUND", fieldId });
      }
      if (
        field.tableId !== args.tableId ||
        field.baseId !== table.baseId
      ) {
        throw new ConvexError({
          code: "FIELD_NOT_IN_RECORD_TABLE",
          fieldId,
        });
      }
      fieldById.set(fieldId, field);
    }

    const plans: Array<{
      record: Doc<"records">;
      values: Doc<"records">["values"];
      revision: number;
      changedFieldIds: Id<"fields">[];
    }> = [];
    for (const group of groups.values()) {
      const record = recordById.get(group.recordId)!;
      if (record.revision !== group.expectedRevision) {
        throw new ConvexError({
          code: "RECORD_REVISION_CONFLICT",
          recordId: record._id,
          expectedRevision: group.expectedRevision,
          actualRevision: record.revision,
        });
      }
      const values = { ...record.values };
      for (const update of group.updates) {
        if (update.value === null) {
          delete values[update.fieldId];
        } else {
          await validateCellValue(
            ctx,
            fieldById.get(update.fieldId)!,
            update.value,
            { recordId: record._id },
          );
          values[update.fieldId] = update.value;
        }
      }
      if (getConvexSize(values) > MAX_RECORD_VALUE_BYTES) {
        throw new ConvexError({
          code: "RECORD_TOO_LARGE",
          recordId: record._id,
          limitBytes: MAX_RECORD_VALUE_BYTES,
        });
      }
      plans.push({
        record,
        values,
        revision: record.revision + 1,
        changedFieldIds: [...group.fieldIds],
      });
    }

    const now = Date.now();
    const revisions: Array<{
      recordId: Id<"records">;
      revision: number;
    }> = [];
    for (const plan of plans) {
      await ctx.db.patch(plan.record._id, {
        values: plan.values,
        revision: plan.revision,
        updatedByType: "user",
        updatedById: identity.userId,
        updatedAt: now,
      });
      await writeAudit(ctx, {
        orgId: identity.orgId,
        actor: userActor(identity),
        action: "record.cells_updated",
        resourceType: "record",
        resourceId: plan.record._id,
        baseId: plan.record.baseId,
        tableId: plan.record.tableId,
        changedFieldIds: plan.changedFieldIds,
        revisionBefore: plan.record.revision,
        revisionAfter: plan.revision,
      });
      revisions.push({
        recordId: plan.record._id,
        revision: plan.revision,
      });
    }
    await recordTableViewChange(ctx, {
      orgId: identity.orgId,
      baseId: table.baseId,
      tableId: args.tableId,
      recordIds: plans.map((plan) => plan.record._id),
    });
    await ctx.db.insert("recordMutationReceipts", {
      orgId: identity.orgId,
      idempotencyKey: args.idempotencyKey,
      operation: "batch_update_cells",
      requestHash,
      tableId: args.tableId,
      affectedCount: args.operations.length,
      revisions,
      createdAt: now,
    });
    return {
      appliedCount: args.operations.length,
      revisions,
      deduplicated: false,
    };
  },
});

export const bulkRemove = mutation({
  args: {
    tableId: v.id("tables"),
    records: v.array(
      v.object({
        recordId: v.id("records"),
        expectedRevision: v.number(),
      }),
    ),
    idempotencyKey: v.string(),
  },
  returns: bulkRemoveResultValidator,
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    assertIdempotencyKey(args.idempotencyKey);
    if (
      args.records.length < 1 ||
      args.records.length > MAX_BATCH_RECORDS
    ) {
      throw new ConvexError({
        code: "INVALID_BATCH_SIZE",
        limit: MAX_BATCH_RECORDS,
      });
    }
    const recordIds = new Set<Id<"records">>();
    for (const record of args.records) {
      assertExpectedRevision(record.recordId, record.expectedRevision);
      if (recordIds.has(record.recordId)) {
        throw new ConvexError({
          code: "DUPLICATE_RECORD",
          recordId: record.recordId,
        });
      }
      recordIds.add(record.recordId);
    }

    const requestHash = await hashMutationRequest(
      "bulk_remove",
      args.tableId,
      args.records,
    );
    const receipt = await ctx.db
      .query("recordMutationReceipts")
      .withIndex("by_org_and_idempotency_key", (q) =>
        q
          .eq("orgId", identity.orgId)
          .eq("idempotencyKey", args.idempotencyKey),
      )
      .unique();
    if (receipt) {
      if (
        receipt.operation !== "bulk_remove" ||
        receipt.requestHash !== requestHash
      ) {
        throw new ConvexError({ code: "IDEMPOTENCY_CONFLICT" });
      }
      return {
        removedCount: receipt.affectedCount,
        revisions: receipt.revisions,
        deduplicated: true,
      };
    }

    const table = await requireTable(ctx, identity.orgId, args.tableId);
    await assertTableFieldConversionsUnlocked(ctx, table._id);
    const records = await Promise.all(
      args.records.map(({ recordId }) => ctx.db.get(recordId)),
    );
    const plans: Array<{
      record: Doc<"records">;
      revision: number;
    }> = [];
    for (let index = 0; index < args.records.length; index += 1) {
      const expected = args.records[index];
      const record = records[index];
      if (
        !record ||
        record.orgId !== identity.orgId ||
        record.status !== "active"
      ) {
        throw new ConvexError({
          code: "RECORD_NOT_FOUND",
          recordId: expected.recordId,
        });
      }
      if (
        record.tableId !== args.tableId ||
        record.baseId !== table.baseId
      ) {
        throw new ConvexError({
          code: "RECORD_NOT_IN_TABLE",
          recordId: record._id,
          tableId: args.tableId,
        });
      }
      if (record.revision !== expected.expectedRevision) {
        throw new ConvexError({
          code: "RECORD_REVISION_CONFLICT",
          recordId: record._id,
          expectedRevision: expected.expectedRevision,
          actualRevision: record.revision,
        });
      }
      plans.push({
        record,
        revision: record.revision + 1,
      });
    }

    const now = Date.now();
    const revisions: Array<{
      recordId: Id<"records">;
      revision: number;
    }> = [];
    for (const plan of plans) {
      await ctx.db.patch(plan.record._id, {
        status: "deleted",
        deletedAt: now,
        revision: plan.revision,
        updatedByType: "user",
        updatedById: identity.userId,
        updatedAt: now,
      });
      await recordCount.delete(ctx, plan.record);
      await tableRecordCount.delete(ctx, plan.record);
      await writeAudit(ctx, {
        orgId: identity.orgId,
        actor: userActor(identity),
        action: "record.deleted",
        resourceType: "record",
        resourceId: plan.record._id,
        baseId: plan.record.baseId,
        tableId: plan.record.tableId,
        revisionBefore: plan.record.revision,
        revisionAfter: plan.revision,
      });
      revisions.push({
        recordId: plan.record._id,
        revision: plan.revision,
      });
    }
    await recordTableViewChange(ctx, {
      orgId: identity.orgId,
      baseId: table.baseId,
      tableId: args.tableId,
      recordIds: plans.map((plan) => plan.record._id),
    });
    await ctx.db.insert("recordMutationReceipts", {
      orgId: identity.orgId,
      idempotencyKey: args.idempotencyKey,
      operation: "bulk_remove",
      requestHash,
      tableId: args.tableId,
      affectedCount: plans.length,
      revisions,
      createdAt: now,
    });
    return {
      removedCount: plans.length,
      revisions,
      deduplicated: false,
    };
  },
});

export const move = mutation({
  args: { recordId: v.id("records"), rank: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    const record = await requireRecord(ctx, identity.orgId, args.recordId);
    await ctx.db.patch(args.recordId, {
      rank: args.rank,
      revision: record.revision + 1,
      updatedByType: "user",
      updatedById: identity.userId,
      updatedAt: Date.now(),
    });
    await recordTableViewChange(ctx, {
      orgId: identity.orgId,
      baseId: record.baseId,
      tableId: record.tableId,
      recordIds: [record._id],
    });
    return null;
  },
});

export const remove = mutation({
  args: { recordId: v.id("records") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    const record = await requireRecord(ctx, identity.orgId, args.recordId);
    await assertTableFieldConversionsUnlocked(ctx, record.tableId);
    await ctx.db.patch(args.recordId, {
      status: "deleted",
      deletedAt: Date.now(),
      revision: record.revision + 1,
      updatedByType: "user",
      updatedById: identity.userId,
      updatedAt: Date.now(),
    });
    await recordCount.delete(ctx, record);
    await tableRecordCount.delete(ctx, record);
    await recordTableViewChange(ctx, {
      orgId: identity.orgId,
      baseId: record.baseId,
      tableId: record.tableId,
      recordIds: [record._id],
    });
    await writeAudit(ctx, {
      orgId: identity.orgId,
      actor: userActor(identity),
      action: "record.deleted",
      resourceType: "record",
      resourceId: args.recordId,
      baseId: record.baseId,
      tableId: record.tableId,
      revisionBefore: record.revision,
      revisionAfter: record.revision + 1,
    });
    return null;
  },
});

export const restore = mutation({
  args: { recordId: v.id("records") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    const record = await requireRecord(ctx, identity.orgId, args.recordId, true);
    await assertTableFieldConversionsUnlocked(ctx, record.tableId);
    await requireTable(ctx, identity.orgId, record.tableId);
    if (record.status === "active") return null;
    const count = await recordCount.count(ctx, { namespace: identity.orgId });
    assertBelowQuota(
      count,
      PLAN_LIMITS[identity.plan].recordsPerOrg,
      "records_per_org",
    );
    await ctx.db.patch(args.recordId, {
      status: "active",
      deletedAt: undefined,
      revision: record.revision + 1,
      updatedByType: "user",
      updatedById: identity.userId,
      updatedAt: Date.now(),
    });
    const restored = await ctx.db.get(args.recordId);
    await recordCount.insert(ctx, restored!);
    await tableRecordCount.insert(ctx, restored!);
    await recordTableViewChange(ctx, {
      orgId: identity.orgId,
      baseId: record.baseId,
      tableId: record.tableId,
      recordIds: [record._id],
    });
    await writeAudit(ctx, {
      orgId: identity.orgId,
      actor: userActor(identity),
      action: "record.restored",
      resourceType: "record",
      resourceId: args.recordId,
      baseId: record.baseId,
      tableId: record.tableId,
      revisionBefore: record.revision,
      revisionAfter: record.revision + 1,
    });
    return null;
  },
});
