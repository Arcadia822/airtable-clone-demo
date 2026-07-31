import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { query } from "./_generated/server";
import { requireOrgIdentity } from "./lib/auth";

export const listPage = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.any(),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    return await ctx.db
      .query("auditEvents")
      .withIndex("by_org", (q) => q.eq("orgId", identity.orgId))
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(args.paginationOpts.numItems, 100),
        maximumRowsRead: Math.min(
          args.paginationOpts.maximumRowsRead ?? 100,
          100,
        ),
        maximumBytesRead: Math.min(
          args.paginationOpts.maximumBytesRead ?? 2 * 1024 * 1024,
          2 * 1024 * 1024,
        ),
      });
  },
});
