import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export type FormStatMetric = "view" | "submission";

export async function incrementFormStat(
  ctx: Pick<MutationCtx, "db">,
  args: {
    orgId: string;
    formId: Id<"forms">;
    metric: FormStatMetric;
  },
): Promise<void> {
  const existing = await ctx.db
    .query("formStats")
    .withIndex("by_form", (q) => q.eq("formId", args.formId))
    .unique();
  const now = Date.now();
  if (existing) {
    await ctx.db.patch(existing._id, {
      views: existing.views + (args.metric === "view" ? 1 : 0),
      submissions:
        existing.submissions +
        (args.metric === "submission" ? 1 : 0),
      updatedAt: now,
    });
    return;
  }
  await ctx.db.insert("formStats", {
    orgId: args.orgId,
    formId: args.formId,
    views: args.metric === "view" ? 1 : 0,
    submissions: args.metric === "submission" ? 1 : 0,
    updatedAt: now,
  });
}
