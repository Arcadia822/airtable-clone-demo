import type { z } from "zod";

import type {
  EveTenantCaller,
  ReadOperation,
  WriteOperation,
} from "./contracts";
import { sha256Hex } from "./hmac";
import { assertSafeToolInput, sanitizeAgentResult } from "./security";
import { signedEvePost } from "./signed-fetch";

type BridgeCallOptions<TOutput> = {
  caller: EveTenantCaller;
  input: unknown;
  operation: ReadOperation | WriteOperation;
  outputSchema: z.ZodType<TOutput>;
  signal?: AbortSignal;
};

export async function callEveReadBridge<TOutput>({
  caller,
  input,
  operation,
  outputSchema,
  signal,
}: BridgeCallOptions<TOutput>): Promise<TOutput> {
  assertSafeToolInput(input);
  const payload = await signedEvePost(
    requireBridgeUrl(),
    {
      version: 1,
      kind: "read",
      operation,
      scope: {
        organizationId: caller.organizationId,
      },
      actor: {
        userId: caller.userId,
        sessionId: caller.sessionId,
        turnId: caller.turnId,
        ...(caller.role ? { role: caller.role } : {}),
      },
      input,
    },
    { signal },
  );
  return parseBridgeResult(payload, outputSchema);
}

export async function callEveWriteBridge<TOutput>({
  caller,
  callId,
  input,
  operation,
  outputSchema,
  signal,
}: BridgeCallOptions<TOutput> & { callId: string }): Promise<TOutput> {
  assertSafeToolInput(input);
  const idempotencyKey = `eve:${caller.sessionId}:${callId}`;
  const hashInput = JSON.stringify({
    operation,
    organizationId: caller.organizationId,
    userId: caller.userId,
    input,
  });

  const payload = await signedEvePost(
    requireBridgeUrl(),
    {
      version: 1,
      kind: "write",
      operation,
      idempotencyKey,
      payloadHash: sha256Hex(hashInput),
      scope: {
        organizationId: caller.organizationId,
      },
      actor: {
        userId: caller.userId,
        sessionId: caller.sessionId,
        turnId: caller.turnId,
        callId,
        ...(caller.role ? { role: caller.role } : {}),
      },
      input,
    },
    { signal },
  );
  return parseBridgeResult(payload, outputSchema);
}

function requireBridgeUrl(): string {
  const endpoint = process.env.EVE_CONVEX_BRIDGE_URL;
  if (!endpoint) {
    throw new Error("EVE_CONVEX_BRIDGE_URL is not configured.");
  }
  return endpoint;
}

function parseBridgeResult<TOutput>(
  payload: unknown,
  outputSchema: z.ZodType<TOutput>,
): TOutput {
  if (payload === null || typeof payload !== "object") {
    throw new Error("The assistant bridge returned an invalid response.");
  }

  if (!("ok" in payload) || payload.ok !== true || !("data" in payload)) {
    throw new Error("The assistant bridge did not return a successful result.");
  }

  const parsed = outputSchema.parse(payload.data);
  return sanitizeAgentResult(parsed) as TOutput;
}
