import { Presence } from "@convex-dev/presence";
import { ConvexError, v } from "convex/values";

import { components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireOrgIdentity } from "./lib/auth";
import { requireField, requireRecord, requireTable } from "./lib/data";

const tableRoomPrefix = "table:";
const workspacePresence = new Presence(components.presence);

function presenceUserId(orgId: string, tokenIdentifier: string): string {
  return `${orgId}:${tokenIdentifier}`;
}

function tableIdFromRoom(roomId: string): Id<"tables"> {
  if (!roomId.startsWith(tableRoomPrefix)) {
    throw new ConvexError({ code: "PRESENCE_ROOM_NOT_FOUND" });
  }
  const tableId = roomId.slice(tableRoomPrefix.length);
  if (!tableId) {
    throw new ConvexError({ code: "PRESENCE_ROOM_NOT_FOUND" });
  }
  return tableId as Id<"tables">;
}

function optionalIdentityString(
  value: unknown,
  maxLength = 500,
): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : undefined;
}

function viewerProfile(raw: Record<string, unknown>) {
  const givenName = optionalIdentityString(raw.givenName, 120);
  const familyName = optionalIdentityString(raw.familyName, 120);
  const fullName = [givenName, familyName].filter(Boolean).join(" ");

  return {
    name:
      optionalIdentityString(raw.name, 240) ||
      fullName ||
      optionalIdentityString(raw.email, 240) ||
      "Workspace member",
    image:
      optionalIdentityString(raw.pictureUrl) ||
      optionalIdentityString(raw.imageUrl),
  };
}

export const viewer = query({
  args: {},
  returns: v.object({
    userId: v.string(),
    name: v.string(),
    image: v.optional(v.string()),
  }),
  handler: async (ctx) => {
    const identity = await requireOrgIdentity(ctx);
    const profile = viewerProfile(
      identity.raw as unknown as Record<string, unknown>,
    );
    return {
      userId: presenceUserId(
        identity.orgId,
        identity.raw.tokenIdentifier,
      ),
      ...profile,
    };
  },
});

export const heartbeat = mutation({
  args: {
    roomId: v.string(),
    userId: v.string(),
    sessionId: v.string(),
    interval: v.number(),
  },
  returns: v.object({
    roomToken: v.string(),
    sessionToken: v.string(),
  }),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    const expectedUserId = presenceUserId(
      identity.orgId,
      identity.raw.tokenIdentifier,
    );
    if (args.userId !== expectedUserId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }
    const tableId = tableIdFromRoom(args.roomId);
    await requireTable(ctx, identity.orgId, tableId);
    return await workspacePresence.heartbeat(
      ctx,
      args.roomId,
      expectedUserId,
      args.sessionId,
      Math.max(5_000, Math.min(args.interval, 60_000)),
    );
  },
});

export const list = query({
  args: { roomToken: v.string() },
  returns: v.array(
    v.object({
      userId: v.string(),
      online: v.boolean(),
      lastDisconnected: v.number(),
      data: v.optional(v.any()),
      name: v.optional(v.string()),
      image: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireOrgIdentity(ctx);
    const entries = await workspacePresence.list(ctx, args.roomToken, 50);
    return entries.map((entry) => {
      const data =
        typeof entry.data === "object" &&
        entry.data !== null &&
        !Array.isArray(entry.data)
          ? (entry.data as Record<string, unknown>)
          : undefined;
      return {
        ...entry,
        ...(optionalIdentityString(data?.name, 240)
          ? { name: optionalIdentityString(data?.name, 240) }
          : {}),
        ...(optionalIdentityString(data?.image)
          ? { image: optionalIdentityString(data?.image) }
          : {}),
      };
    });
  },
});

export const updateLocation = mutation({
  args: {
    tableId: v.id("tables"),
    fieldId: v.optional(v.id("fields")),
    recordId: v.optional(v.id("records")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    await requireTable(ctx, identity.orgId, args.tableId);

    const [field, record] = await Promise.all([
      args.fieldId
        ? requireField(ctx, identity.orgId, args.fieldId)
        : undefined,
      args.recordId
        ? requireRecord(ctx, identity.orgId, args.recordId)
        : undefined,
    ]);
    if (
      (field && field.tableId !== args.tableId) ||
      (record && record.tableId !== args.tableId)
    ) {
      throw new ConvexError({ code: "PRESENCE_LOCATION_NOT_FOUND" });
    }

    const userId = presenceUserId(
      identity.orgId,
      identity.raw.tokenIdentifier,
    );
    const profile = viewerProfile(
      identity.raw as unknown as Record<string, unknown>,
    );
    await workspacePresence.updateRoomUser(
      ctx,
      `${tableRoomPrefix}${args.tableId}`,
      userId,
      {
        ...profile,
        ...(args.fieldId ? { fieldId: args.fieldId } : {}),
        ...(args.recordId ? { recordId: args.recordId } : {}),
      },
    );
    return null;
  },
});

export const disconnect = mutation({
  args: { sessionToken: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await workspacePresence.disconnect(ctx, args.sessionToken);
    return null;
  },
});
