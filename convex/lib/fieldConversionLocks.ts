import { ConvexError } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type ReadCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;

export async function activeFieldConversionJob(
  ctx: ReadCtx,
  fieldId: Id<"fields">,
) {
  return await ctx.db
    .query("fieldConversionJobs")
    .withIndex("by_field_and_lock_active", (q) =>
      q.eq("fieldId", fieldId).eq("lockActive", true),
    )
    .unique();
}

export async function assertFieldConversionUnlocked(
  ctx: ReadCtx,
  fieldId: Id<"fields">,
) {
  if (await activeFieldConversionJob(ctx, fieldId)) {
    throw new ConvexError({
      code: "FIELD_CONVERSION_IN_PROGRESS",
      message:
        "Finish or retry the column change before editing this column.",
    });
  }
}

export async function assertFieldConversionsUnlocked(
  ctx: ReadCtx,
  fieldIds: readonly Id<"fields">[],
) {
  for (const fieldId of new Set(fieldIds)) {
    await assertFieldConversionUnlocked(ctx, fieldId);
  }
}

export async function assertTableFieldConversionsUnlocked(
  ctx: ReadCtx,
  tableId: Id<"tables">,
) {
  const job = await ctx.db
    .query("fieldConversionJobs")
    .withIndex("by_table_and_lock_active", (q) =>
      q.eq("tableId", tableId).eq("lockActive", true),
    )
    .unique();
  if (job) {
    throw new ConvexError({
      code: "FIELD_CONVERSION_IN_PROGRESS",
      message:
        "Finish or retry the column change before moving records in or out of this table.",
    });
  }
}

export async function overlayFieldConversionSourceValues(
  ctx: ReadCtx,
  tableId: Id<"tables">,
  records: Doc<"records">[],
): Promise<Doc<"records">[]> {
  if (!records.length) return records;
  const job = await ctx.db
    .query("fieldConversionJobs")
    .withIndex("by_table_and_lock_active", (q) =>
      q.eq("tableId", tableId).eq("lockActive", true),
    )
    .unique();
  if (!job || job.phase !== "applying") return records;

  return await Promise.all(
    records.map(async (record) => {
      const shadow = await ctx.db
        .query("fieldConversionShadowValues")
        .withIndex("by_job_and_record", (q) =>
          q.eq("jobId", job._id).eq("recordId", record._id),
        )
        .unique();
      if (!shadow) return record;
      const values = { ...record.values };
      if (shadow.sourceHadValue && shadow.sourceValue !== null) {
        values[job.fieldId] = shadow.sourceValue;
      } else {
        delete values[job.fieldId];
      }
      return { ...record, values };
    }),
  );
}
