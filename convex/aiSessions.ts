import { ConvexError, v } from "convex/values";

import {
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { aiTurnCount } from "./lib/aggregates";
import { requireOrgIdentity } from "./lib/auth";
import { monthKey, PLAN_LIMITS } from "./lib/quotas";

const AI_ACTION_LABELS: Record<string, string> = {
  "field.created": "Added a column",
  "field.deleted": "Archived a column",
  "form.created": "Created a form",
  "form.settings_updated": "Updated form settings",
  "record.created": "Created a record",
  "record.deleted": "Deleted a record",
  "record.updated": "Updated a record",
};

export const getUsage = query({
  args: {},
  returns: v.object({
    eligible: v.boolean(),
    limit: v.number(),
    recentChanges: v.array(
      v.object({
        createdAt: v.number(),
        id: v.id("auditEvents"),
        label: v.string(),
        location: v.string(),
      }),
    ),
    remaining: v.number(),
    used: v.number(),
  }),
  handler: async (ctx) => {
    const identity = await requireOrgIdentity(ctx);
    const eligible =
      identity.features.has("ai_assistant") &&
      PLAN_LIMITS[identity.plan].aiTurnsPerMonth > 0;
    const limit = eligible
      ? PLAN_LIMITS[identity.plan].aiTurnsPerMonth
      : 0;
    const used = await aiTurnCount.count(ctx, {
      namespace: `${identity.orgId}:${monthKey()}`,
    });
    const recentAuditEvents = (
      await ctx.db
        .query("auditEvents")
        .withIndex("by_org", (q) => q.eq("orgId", identity.orgId))
        .order("desc")
        .take(100)
    )
      .filter(
        (event) =>
          event.actorType === "eve" &&
          AI_ACTION_LABELS[event.action] !== undefined,
      )
      .slice(0, 5);
    const tables = new Map(
      (
        await Promise.all(
          [...new Set(recentAuditEvents.flatMap((event) =>
            event.tableId ? [event.tableId] : [],
          ))].map((tableId) => ctx.db.get(tableId)),
        )
      )
        .filter((table) => table?.orgId === identity.orgId)
        .map((table) => [table!._id, table!] as const),
    );
    const bases = new Map(
      (
        await Promise.all(
          [...new Set(recentAuditEvents.flatMap((event) =>
            event.baseId ? [event.baseId] : [],
          ))].map((baseId) => ctx.db.get(baseId)),
        )
      )
        .filter((base) => base?.orgId === identity.orgId)
        .map((base) => [base!._id, base!] as const),
    );

    return {
      eligible,
      limit,
      recentChanges: recentAuditEvents.map((event) => ({
        createdAt: event.createdAt,
        id: event._id,
        label: AI_ACTION_LABELS[event.action]!,
        location:
          (event.tableId ? tables.get(event.tableId)?.name : undefined) ??
          (event.baseId ? bases.get(event.baseId)?.name : undefined) ??
          "Workspace",
      })),
      remaining: Math.max(0, limit - used),
      used,
    };
  },
});

const ownershipArgs = {
  organizationId: v.string(),
  userId: v.string(),
};

async function findOwnedSession(
  ctx: Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">,
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
  return session &&
    session.orgId === organizationId &&
    session.ownerUserId === userId &&
    session.status === "active"
    ? session
    : null;
}

async function requireOwnedSession(
  ctx: Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">,
  organizationId: string,
  userId: string,
  externalSessionId: string,
) {
  const session = await findOwnedSession(
    ctx,
    organizationId,
    userId,
    externalSessionId,
  );
  if (!session) {
    throw new ConvexError({ code: "EVE_SESSION_FORBIDDEN" });
  }
  return session;
}

export const registerOwnership = internalMutation({
  args: {
    ...ownershipArgs,
    sessionId: v.string(),
    continuationTokenHash: v.string(),
  },
  returns: v.object({ allowed: v.literal(true) }),
  handler: async (ctx, args) => {
    const bySession = await ctx.db
      .query("aiSessions")
      .withIndex("by_external_session", (q) =>
        q.eq("externalSessionId", args.sessionId),
      )
      .unique();
    const byContinuation = await ctx.db
      .query("aiSessions")
      .withIndex("by_continuation_token_hash", (q) =>
        q.eq("continuationTokenHash", args.continuationTokenHash),
      )
      .unique();

    if (bySession || byContinuation) {
      if (
        !bySession ||
        !byContinuation ||
        bySession._id !== byContinuation._id ||
        bySession.orgId !== args.organizationId ||
        bySession.ownerUserId !== args.userId ||
        bySession.continuationTokenHash !== args.continuationTokenHash ||
        bySession.status !== "active"
      ) {
        throw new ConvexError({ code: "EVE_SESSION_FORBIDDEN" });
      }
      return { allowed: true as const };
    }

    const now = Date.now();
    const sessionId = await ctx.db.insert("aiSessions", {
      orgId: args.organizationId,
      ownerUserId: args.userId,
      externalSessionId: args.sessionId,
      continuationTokenHash: args.continuationTokenHash,
      title: "AI assistant",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      orgId: args.organizationId,
      actorType: "eve",
      actorId: args.userId,
      action: "ai_session.registered",
      resourceType: "ai_session",
      resourceId: sessionId,
      sourceRunId: args.sessionId,
      createdAt: now,
    });
    return { allowed: true as const };
  },
});

export const assertOwnership = internalQuery({
  args: {
    ...ownershipArgs,
    sessionId: v.string(),
  },
  returns: v.object({ allowed: v.boolean() }),
  handler: async (ctx, args) => {
    const session = await findOwnedSession(
      ctx,
      args.organizationId,
      args.userId,
      args.sessionId,
    );
    return { allowed: session !== null };
  },
});

export const assertContinuationOwnership = internalQuery({
  args: {
    ...ownershipArgs,
    continuationTokenHash: v.string(),
  },
  returns: v.object({ allowed: v.boolean() }),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("aiSessions")
      .withIndex("by_continuation_token_hash", (q) =>
        q.eq("continuationTokenHash", args.continuationTokenHash),
      )
      .unique();
    return {
      allowed:
        session !== null &&
        session.orgId === args.organizationId &&
        session.ownerUserId === args.userId &&
        session.status === "active",
    };
  },
});

export const consumeTurn = internalMutation({
  args: {
    ...ownershipArgs,
    sessionId: v.string(),
    requestId: v.string(),
  },
  returns: v.object({
    duplicate: v.boolean(),
    used: v.number(),
    limit: v.number(),
  }),
  handler: async (ctx, args) => {
    const session = await requireOwnedSession(
      ctx,
      args.organizationId,
      args.userId,
      args.sessionId,
    );
    const existing = await ctx.db
      .query("aiUsageEvents")
      .withIndex("by_session_and_request", (q) =>
        q.eq("sessionId", session._id).eq("requestId", args.requestId),
      )
      .unique();
    const month = monthKey();
    const limit = PLAN_LIMITS.pro.aiTurnsPerMonth;
    const used = await aiTurnCount.count(ctx, {
      namespace: `${args.organizationId}:${month}`,
    });
    if (existing) return { duplicate: true, used, limit };
    if (used >= limit) {
      throw new ConvexError({
        code: "AI_QUOTA_EXCEEDED",
        current: used,
        limit,
      });
    }
    const eventId = await ctx.db.insert("aiUsageEvents", {
      orgId: args.organizationId,
      sessionId: session._id,
      requestId: args.requestId,
      month,
      createdAt: Date.now(),
    });
    const event = await ctx.db.get(eventId);
    await aiTurnCount.insert(ctx, event!);
    return { duplicate: false, used: used + 1, limit };
  },
});

export const consumeRequestNonce = internalMutation({
  args: {
    nonceHash: v.string(),
    expiresAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (
      !/^[a-f0-9]{64}$/.test(args.nonceHash) ||
      args.expiresAt <= Date.now()
    ) {
      throw new ConvexError({ code: "INVALID_EVE_NONCE" });
    }
    const existing = await ctx.db
      .query("aiRequestNonces")
      .withIndex("by_nonce_hash", (q) =>
        q.eq("nonceHash", args.nonceHash),
      )
      .unique();
    if (existing) {
      throw new ConvexError({ code: "EVE_REQUEST_REPLAY" });
    }
    await ctx.db.insert("aiRequestNonces", {
      nonceHash: args.nonceHash,
      expiresAt: args.expiresAt,
      createdAt: Date.now(),
    });
    return null;
  },
});

export const cleanupRequestNonces = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("aiRequestNonces")
      .withIndex("by_expires_at", (q) =>
        q.lt("expiresAt", Date.now()),
      )
      .take(500);
    for (const nonce of expired) {
      await ctx.db.delete(nonce._id);
    }
    return expired.length;
  },
});
