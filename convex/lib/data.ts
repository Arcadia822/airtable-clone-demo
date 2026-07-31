import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { ConvexError } from "convex/values";
import { generateKeyBetween } from "jittered-fractional-indexing";

type ReadCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;

export async function hasActiveFormParents(
  ctx: ReadCtx,
  form: Pick<Doc<"forms">, "orgId" | "baseId" | "tableId">,
): Promise<boolean> {
  const [base, table] = await Promise.all([
    ctx.db.get(form.baseId),
    ctx.db.get(form.tableId),
  ]);
  return (
    base?.orgId === form.orgId &&
    base.status === "active" &&
    table?.orgId === form.orgId &&
    table.baseId === form.baseId &&
    table.status === "active"
  );
}

export async function requireBase(
  ctx: ReadCtx,
  orgId: string,
  baseId: string,
  allowDeleted = false,
) {
  const normalizedBaseId = ctx.db.normalizeId("bases", baseId);
  if (!normalizedBaseId) {
    throw new ConvexError({ code: "BASE_NOT_FOUND" });
  }
  const base = await ctx.db.get(normalizedBaseId);
  if (
    !base ||
    base.orgId !== orgId ||
    (!allowDeleted && base.status !== "active")
  ) {
    throw new ConvexError({ code: "BASE_NOT_FOUND" });
  }
  return base;
}

export async function requireTable(
  ctx: ReadCtx,
  orgId: string,
  tableId: string,
  allowDeleted = false,
) {
  const normalizedTableId = ctx.db.normalizeId("tables", tableId);
  if (!normalizedTableId) {
    throw new ConvexError({ code: "TABLE_NOT_FOUND" });
  }
  const table = await ctx.db.get(normalizedTableId);
  if (
    !table ||
    table.orgId !== orgId ||
    (!allowDeleted && table.status !== "active")
  ) {
    throw new ConvexError({ code: "TABLE_NOT_FOUND" });
  }
  if (!allowDeleted) {
    await requireBase(ctx, orgId, table.baseId);
  }
  return table;
}

export async function requireField(
  ctx: ReadCtx,
  orgId: string,
  fieldId: string,
  allowDeleted = false,
) {
  const normalizedFieldId = ctx.db.normalizeId("fields", fieldId);
  if (!normalizedFieldId) {
    throw new ConvexError({ code: "FIELD_NOT_FOUND" });
  }
  const field = await ctx.db.get(normalizedFieldId);
  if (
    !field ||
    field.orgId !== orgId ||
    (!allowDeleted && field.status !== "active")
  ) {
    throw new ConvexError({ code: "FIELD_NOT_FOUND" });
  }
  if (!allowDeleted) {
    await requireTable(ctx, orgId, field.tableId);
  }
  return field;
}

export async function requireRecord(
  ctx: ReadCtx,
  orgId: string,
  recordId: string,
  allowDeleted = false,
) {
  const normalizedRecordId = ctx.db.normalizeId("records", recordId);
  if (!normalizedRecordId) {
    throw new ConvexError({ code: "RECORD_NOT_FOUND" });
  }
  const record = await ctx.db.get(normalizedRecordId);
  if (
    !record ||
    record.orgId !== orgId ||
    (!allowDeleted && record.status !== "active")
  ) {
    throw new ConvexError({ code: "RECORD_NOT_FOUND" });
  }
  if (!allowDeleted) {
    await requireTable(ctx, orgId, record.tableId);
  }
  return record;
}

export async function requireForm(
  ctx: ReadCtx,
  orgId: string,
  formId: string,
  allowDeleted = false,
) {
  const normalizedFormId = ctx.db.normalizeId("forms", formId);
  if (!normalizedFormId) {
    throw new ConvexError({ code: "FORM_NOT_FOUND" });
  }
  const form = await ctx.db.get(normalizedFormId);
  if (
    !form ||
    form.orgId !== orgId ||
    (!allowDeleted && form.status === "deleted")
  ) {
    throw new ConvexError({ code: "FORM_NOT_FOUND" });
  }
  if (!allowDeleted) {
    await requireBase(ctx, orgId, form.baseId);
    await requireTable(ctx, orgId, form.tableId);
  }
  return form;
}

export function createRank(after?: string): string {
  return generateKeyBetween(after ?? null, null, {
    jitterBits: 48,
    getRandomBit: () => {
      const random = new Uint8Array(1);
      crypto.getRandomValues(random);
      return (random[0] & 1) === 1;
    },
  });
}

export function compareRanks(
  left: { rank: string },
  right: { rank: string },
): number {
  if (left.rank < right.rank) return -1;
  if (left.rank > right.rank) return 1;
  return 0;
}
