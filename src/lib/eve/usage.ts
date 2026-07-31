import type { EveTenantCaller } from "./contracts";
import { signedEvePost } from "./signed-fetch";

export async function consumeEveTurn(
  caller: EveTenantCaller,
): Promise<void> {
  const endpoint = process.env.EVE_CONVEX_BRIDGE_URL;
  if (!endpoint) {
    throw new Error("EVE_CONVEX_BRIDGE_URL is not configured.");
  }

  await signedEvePost(endpoint, {
    version: 1,
    kind: "turn",
    operation: "consume_turn",
    scope: {
      organizationId: caller.organizationId,
    },
    actor: {
      userId: caller.userId,
      sessionId: caller.sessionId,
      turnId: caller.turnId,
      ...(caller.role ? { role: caller.role } : {}),
    },
    input: {},
  });
}
