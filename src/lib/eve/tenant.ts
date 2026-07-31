import type { SessionContext } from "eve/tools";

import type { EveTenantCaller } from "./contracts";

export function requireEveTenantCaller(ctx: SessionContext): EveTenantCaller {
  const current = ctx.session.auth.current;
  const initiator = ctx.session.auth.initiator;
  const turnId = ctx.session.turn.id;
  const currentOrganizationId = current?.attributes.organizationId;
  const initiatorOrganizationId = initiator?.attributes.organizationId;

  if (
    current?.principalType !== "user" ||
    initiator?.principalType !== "user" ||
    typeof turnId !== "string" ||
    !turnId.trim() ||
    turnId.length > 256 ||
    typeof currentOrganizationId !== "string" ||
    typeof initiatorOrganizationId !== "string" ||
    current.attributes.aiAccess !== "granted" ||
    initiator.attributes.aiAccess !== "granted"
  ) {
    throw new Error("An authenticated Pro organization member is required.");
  }

  if (
    current.principalId !== initiator.principalId ||
    currentOrganizationId !== initiatorOrganizationId
  ) {
    throw new Error("This assistant session belongs to a different organization or user.");
  }

  const role = current.attributes.organizationRole;
  return {
    organizationId: currentOrganizationId,
    userId: current.principalId,
    sessionId: ctx.session.id,
    turnId,
    ...(typeof role === "string" ? { role } : {}),
  };
}

export function requireEveryWriteApproval(ctx: SessionContext): "user-approval" {
  requireEveTenantCaller(ctx);
  return "user-approval";
}
