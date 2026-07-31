import type { Doc, Id } from "../_generated/dataModel";
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
  baseId: Id<"bases">,
  allowDeleted = false,
) {
  const base = await ctx.db.get(baseId);
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
  tableId: Id<"tables">,
  allowDeleted = false,
) {
  const table = await ctx.db.get(tableId);
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
  fieldId: Id<"fields">,
  allowDeleted = false,
) {
  const field = await ctx.db.get(fieldId);
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
  recordId: Id<"records">,
  allowDeleted = false,
) {
  const record = await ctx.db.get(recordId);
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
  formId: Id<"forms">,
  allowDeleted = false,
) {
  const form = await ctx.db.get(formId);
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
