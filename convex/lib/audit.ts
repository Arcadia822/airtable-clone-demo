import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

import type { OrgIdentity } from "./auth";

type AuditActor = {
  type: "user" | "public_form" | "eve" | "system";
  id: string;
};

type AuditInput = {
  orgId: string;
  actor: AuditActor;
  action: string;
  resourceType:
    | "base"
    | "table"
    | "field"
    | "record"
    | "form"
    | "form_version"
    | "submission"
    | "attachment"
    | "ai_session";
  resourceId: string;
  baseId?: Id<"bases">;
  tableId?: Id<"tables">;
  changedFieldIds?: Id<"fields">[];
  revisionBefore?: number;
  revisionAfter?: number;
  sourceRunId?: string;
  sourceToolCallId?: string;
};

export function userActor(identity: OrgIdentity): AuditActor {
  return { type: "user", id: identity.userId };
}

export async function writeAudit(
  ctx: MutationCtx,
  input: AuditInput,
): Promise<Id<"auditEvents">> {
  return await ctx.db.insert("auditEvents", {
    orgId: input.orgId,
    actorType: input.actor.type,
    actorId: input.actor.id,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    baseId: input.baseId,
    tableId: input.tableId,
    changedFieldIds: input.changedFieldIds,
    revisionBefore: input.revisionBefore,
    revisionAfter: input.revisionAfter,
    sourceRunId: input.sourceRunId,
    sourceToolCallId: input.sourceToolCallId,
    createdAt: Date.now(),
  });
}
