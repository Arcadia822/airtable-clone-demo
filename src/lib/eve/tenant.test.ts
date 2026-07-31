import type { SessionContext } from "eve/tools";
import { describe, expect, it } from "vitest";

import { requireEveTenantCaller } from "./tenant";

function contextForTurn(turnId: string): SessionContext {
  const auth = {
    authenticator: "clerk",
    principalId: "user_1",
    principalType: "user" as const,
    subject: "user_1",
    attributes: {
      organizationId: "org_1",
      organizationRole: "org:member",
      aiAccess: "granted",
    },
  };

  return {
    session: {
      id: "session_1",
      auth: {
        current: auth,
        initiator: auth,
      },
      turn: {
        id: turnId,
        sequence: 3,
      },
    },
  } as unknown as SessionContext;
}

describe("EVE tenant caller", () => {
  it("carries the durable turn ID used for usage metering", () => {
    expect(requireEveTenantCaller(contextForTurn("turn_3"))).toEqual({
      organizationId: "org_1",
      userId: "user_1",
      sessionId: "session_1",
      turnId: "turn_3",
      role: "org:member",
    });
  });

  it("fails closed when the runtime does not supply a valid turn ID", () => {
    expect(() => requireEveTenantCaller(contextForTurn(""))).toThrow(
      /authenticated Pro organization member/i,
    );
  });
});
