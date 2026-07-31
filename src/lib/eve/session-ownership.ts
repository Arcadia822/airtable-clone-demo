import {
  ownershipRequestSchema,
  ownershipResultSchema,
  type EveTenantCaller,
} from "./contracts";
import { sha256Hex } from "./hmac";
import {
  EveBridgeRequestError,
  signedEvePost,
} from "./signed-fetch";

const SESSION_REGISTRATION_RETRY_DELAYS_MS = [25, 50, 100, 200, 400] as const;

export function extractEveSessionId(request: Request): string | undefined {
  const pathname = new URL(request.url).pathname;
  if (pathname.endsWith("/eve/v1/session/reset")) {
    return undefined;
  }

  const match = pathname.match(
    /\/eve\/v1\/session\/([^/]+)(?:\/(?:stream|cancel))?\/?$/,
  );
  if (!match?.[1]) {
    return undefined;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

export function isEveResetRequest(request: Request): boolean {
  return new URL(request.url).pathname.endsWith("/eve/v1/session/reset");
}

export async function extractEveResetContinuationTokenHash(
  request: Request,
): Promise<string | undefined> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > 8_192) {
    return undefined;
  }

  let rawBody: string;
  try {
    rawBody = await request.clone().text();
  } catch {
    return undefined;
  }
  if (rawBody.length === 0 || rawBody.length > 8_192) {
    return undefined;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return undefined;
  }

  if (
    payload === null ||
    typeof payload !== "object" ||
    !("continuationToken" in payload) ||
    typeof payload.continuationToken !== "string" ||
    payload.continuationToken.length === 0 ||
    payload.continuationToken.length > 4_096
  ) {
    return undefined;
  }

  return sha256Hex(payload.continuationToken);
}

export async function registerEveSessionOwnership(
  caller: EveTenantCaller,
  continuationToken: string | undefined,
): Promise<void> {
  if (!continuationToken) {
    throw new Error("The EVE continuation token is unavailable; session registration was denied.");
  }

  const request = ownershipRequestSchema.parse({
    action: "register",
    sessionId: caller.sessionId,
    continuationTokenHash: sha256Hex(continuationToken),
    organizationId: caller.organizationId,
    userId: caller.userId,
  });
  await callOwnershipEndpoint(request);
}

export async function assertEveSessionOwnership(input: {
  sessionId: string;
  organizationId: string;
  userId: string;
}): Promise<void> {
  const request = ownershipRequestSchema.parse({
    action: "assert",
    ...input,
  });
  await withSessionRegistrationGrace(() => callOwnershipEndpoint(request));
}

export async function assertEveContinuationOwnership(input: {
  continuationTokenHash: string;
  organizationId: string;
  userId: string;
}): Promise<void> {
  const request = ownershipRequestSchema.parse({
    action: "assert-continuation",
    ...input,
  });
  await callOwnershipEndpoint(request);
}

async function callOwnershipEndpoint(input: unknown): Promise<void> {
  const endpoint = process.env.EVE_SESSION_OWNERSHIP_URL;
  if (!endpoint) {
    throw new Error("EVE_SESSION_OWNERSHIP_URL is not configured.");
  }

  const payload = await signedEvePost(endpoint, {
    version: 1,
    kind: "session-ownership",
    input,
  });

  if (payload === null || typeof payload !== "object" || !("data" in payload)) {
    throw new Error("The assistant session ownership service returned an invalid response.");
  }
  ownershipResultSchema.parse(payload.data);
}

export async function withSessionRegistrationGrace<T>(
  operation: () => Promise<T>,
  wait: (milliseconds: number) => Promise<void> = sleep,
): Promise<T> {
  for (
    let attempt = 0;
    attempt <= SESSION_REGISTRATION_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    try {
      return await operation();
    } catch (error) {
      const delay = SESSION_REGISTRATION_RETRY_DELAYS_MS[attempt];
      if (
        delay === undefined ||
        !(error instanceof EveBridgeRequestError) ||
        error.status !== 403
      ) {
        throw error;
      }
      await wait(delay);
    }
  }
  throw new Error("The assistant session could not be verified.");
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
