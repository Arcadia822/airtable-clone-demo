import { httpRouter } from "convex/server";
import { ConvexError } from "convex/values";

import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";

const http = httpRouter();
const MAX_BODY_BYTES = 512 * 1_024;
const SIGNATURE_WINDOW_SECONDS = 5 * 60;

type JsonObject = Record<string, unknown>;

function jsonResponse(
  status: number,
  body: unknown,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function success(data: unknown): Response {
  return jsonResponse(200, { ok: true, data });
}

function failure(
  status: number,
  code: string,
  message: string,
): Response {
  return jsonResponse(status, {
    ok: false,
    error: {
      code: code.slice(0, 80),
      message: message.slice(0, 300),
    },
  });
}

function objectValue(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ConvexError({ code: "INVALID_REQUEST", field: label });
  }
  return value as JsonObject;
}

function stringValue(
  object: JsonObject,
  key: string,
  maximum = 256,
): string {
  const value = object[key];
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum
  ) {
    throw new ConvexError({ code: "INVALID_REQUEST", field: key });
  }
  return value;
}

function optionalString(
  object: JsonObject,
  key: string,
  maximum = 256,
): string | undefined {
  if (object[key] === undefined) return undefined;
  return stringValue(object, key, maximum);
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesToHex(new Uint8Array(digest));
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function verifySignedBody(
  request: Request,
): Promise<{ rawBody: string; nonce: string }> {
  const declaredLength = Number(
    request.headers.get("content-length") ?? "0",
  );
  if (
    !Number.isFinite(declaredLength) ||
    declaredLength < 0 ||
    declaredLength > MAX_BODY_BYTES
  ) {
    throw new ConvexError({ code: "REQUEST_TOO_LARGE" });
  }
  const rawBody = await request.text();
  if (
    rawBody.length === 0 ||
    new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES
  ) {
    throw new ConvexError({ code: "REQUEST_TOO_LARGE" });
  }

  const timestampHeader = request.headers.get("x-eve-timestamp");
  const nonce = request.headers.get("x-eve-nonce");
  const signatureHeader = request.headers.get("x-eve-signature");
  const keyId = request.headers.get("x-eve-key-id");
  const expectedKeyId =
    process.env.EVE_CONVEX_HMAC_KEY_ID ?? "primary";
  const secret = process.env.EVE_CONVEX_HMAC_SECRET;
  if (
    !secret ||
    !timestampHeader ||
    !/^\d{10}$/.test(timestampHeader) ||
    !signatureHeader ||
    !/^v1=[a-f0-9]{64}$/.test(signatureHeader) ||
    !nonce ||
    !/^[0-9a-f-]{36}$/i.test(nonce) ||
    keyId !== expectedKeyId
  ) {
    throw new ConvexError({ code: "INVALID_SIGNATURE" });
  }
  const timestamp = Number(timestampHeader);
  if (
    Math.abs(Math.floor(Date.now() / 1_000) - timestamp) >
    SIGNATURE_WINDOW_SECONDS
  ) {
    throw new ConvexError({ code: "SIGNATURE_EXPIRED" });
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(
      `${timestampHeader}.${nonce}.${request.method.toUpperCase()}.${new URL(request.url).pathname}.${rawBody}`,
    ),
  );
  const expected = `v1=${bytesToHex(new Uint8Array(signature))}`;
  if (!constantTimeEqual(signatureHeader, expected)) {
    throw new ConvexError({ code: "INVALID_SIGNATURE" });
  }
  return { rawBody, nonce };
}

async function parseSignedJson(
  ctx: ActionCtx,
  request: Request,
): Promise<JsonObject> {
  const { rawBody: raw, nonce } = await verifySignedBody(request);
  await ctx.runMutation(internal.aiSessions.consumeRequestNonce, {
    nonceHash: await sha256Hex(nonce),
    expiresAt: Date.now() + SIGNATURE_WINDOW_SECONDS * 1_000,
  });
  try {
    return objectValue(JSON.parse(raw), "body");
  } catch (error) {
    if (error instanceof ConvexError) throw error;
    throw new ConvexError({ code: "INVALID_JSON" });
  }
}

function errorCode(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data;
    if (
      data !== null &&
      typeof data === "object" &&
      "code" in data &&
      typeof data.code === "string"
    ) {
      return data.code.toLowerCase();
    }
  }
  return "request_failed";
}

function errorStatus(code: string): number {
  if (
    code.includes("signature") ||
    code === "invalid_json" ||
    code === "invalid_request" ||
    code === "request_too_large"
  ) {
    return 401;
  }
  if (
    code.includes("forbidden") ||
    code.includes("required") ||
    code.includes("not_entitled")
  ) {
    return 403;
  }
  if (code.includes("quota") || code.includes("rate")) return 429;
  if (code.includes("replay")) return 409;
  if (code.includes("billing_unavailable")) return 503;
  if (
    code.includes("stale") ||
    code.includes("conflict") ||
    code.includes("not_found") ||
    code.includes("invalid")
  ) {
    return 409;
  }
  return 400;
}

async function currentAiEntitlements(
  ctx: ActionCtx,
  organizationId: string,
) {
  const entitlements = await ctx.runAction(
    internal.billing.getCurrentOrganizationEntitlements,
    { orgId: organizationId },
  );
  if (
    entitlements.plan !== "pro" ||
    !entitlements.features.includes("ai_assistant")
  ) {
    throw new ConvexError({ code: "AI_NOT_ENTITLED" });
  }
  return entitlements;
}

async function assistantHandler(
  ctx: ActionCtx,
  request: Request,
): Promise<Response> {
  try {
    const body = await parseSignedJson(ctx, request);
    if (body.version !== 1) {
      throw new ConvexError({ code: "INVALID_REQUEST" });
    }
    const kind = stringValue(body, "kind", 16);
    if (kind !== "read" && kind !== "write" && kind !== "turn") {
      throw new ConvexError({ code: "INVALID_REQUEST" });
    }
    const operation = stringValue(body, "operation", 80);
    const scope = objectValue(body.scope, "scope");
    const actor = objectValue(body.actor, "actor");
    const organizationId = stringValue(
      scope,
      "organizationId",
    );
    const userId = stringValue(actor, "userId");
    const sessionId = stringValue(actor, "sessionId");
    const turnId = stringValue(actor, "turnId");
    const role = optionalString(actor, "role", 80);
    const entitlements = await currentAiEntitlements(
      ctx,
      organizationId,
    );
    if (
      operation === "form_analytics" &&
      !entitlements.features.includes("form_analytics")
    ) {
      throw new ConvexError({
        code: "FORM_ANALYTICS_NOT_ENTITLED",
      });
    }
    if (
      operation === "create_form" &&
      !entitlements.features.includes("custom_form_branding")
    ) {
      throw new ConvexError({
        code: "CUSTOM_FORM_BRANDING_NOT_ENTITLED",
      });
    }
    if (
      operation === "update_form_settings" &&
      !entitlements.features.includes("custom_form_branding")
    ) {
      const input = objectValue(body.input, "input");
      const changes = input.changes;
      if (
        Array.isArray(changes) &&
        changes.some((rawChange) => {
          if (
            rawChange === null ||
            typeof rawChange !== "object" ||
            Array.isArray(rawChange)
          ) {
            return false;
          }
          const property = (rawChange as JsonObject).property;
          return property === "accentColor";
        })
      ) {
        throw new ConvexError({
          code: "CUSTOM_FORM_BRANDING_NOT_ENTITLED",
        });
      }
    }

    const usage = await ctx.runMutation(internal.aiSessions.consumeTurn, {
      organizationId,
      userId,
      sessionId,
      requestId: turnId,
    });

    if (kind === "turn") {
      if (operation !== "consume_turn") {
        throw new ConvexError({ code: "INVALID_REQUEST" });
      }
      return success(usage);
    }

    if (kind === "read") {
      const data = await ctx.runQuery(internal.aiReads.read, {
        organizationId,
        userId,
        sessionId,
        operation,
        input: body.input,
      });
      return success(data);
    }

    const callId = stringValue(actor, "callId");
    const idempotencyKey = stringValue(
      body,
      "idempotencyKey",
    );
    const payloadHash = stringValue(body, "payloadHash", 64);
    if (
      !/^[a-f0-9]{64}$/.test(payloadHash) ||
      idempotencyKey !== `eve:${sessionId}:${callId}`
    ) {
      throw new ConvexError({ code: "INVALID_EVE_WRITE" });
    }
    const expectedPayloadHash = await sha256Hex(
      JSON.stringify({
        operation,
        organizationId,
        userId,
        input: body.input,
      }),
    );
    if (!constantTimeEqual(payloadHash, expectedPayloadHash)) {
      throw new ConvexError({ code: "PAYLOAD_HASH_MISMATCH" });
    }
    const data = await ctx.runMutation(internal.aiWrites.apply, {
      organizationId,
      userId,
      sessionId,
      callId,
      role,
      operation,
      idempotencyKey,
      payloadHash,
      input: body.input,
    });
    return success(data);
  } catch (error) {
    const code = errorCode(error);
    return failure(
      errorStatus(code),
      code,
      code === "request_failed"
        ? "The assistant bridge request failed."
        : code.replaceAll("_", " "),
    );
  }
}

async function ownershipHandler(
  ctx: ActionCtx,
  request: Request,
): Promise<Response> {
  try {
    const body = await parseSignedJson(ctx, request);
    if (
      body.version !== 1 ||
      body.kind !== "session-ownership"
    ) {
      throw new ConvexError({ code: "INVALID_REQUEST" });
    }
    const input = objectValue(body.input, "input");
    const action = stringValue(input, "action", 32);
    const organizationId = stringValue(input, "organizationId");
    const userId = stringValue(input, "userId");
    await currentAiEntitlements(ctx, organizationId);

    if (action === "register") {
      const sessionId = stringValue(input, "sessionId");
      const continuationTokenHash = stringValue(
        input,
        "continuationTokenHash",
        64,
      );
      if (!/^[a-f0-9]{64}$/.test(continuationTokenHash)) {
        throw new ConvexError({ code: "INVALID_REQUEST" });
      }
      const data = await ctx.runMutation(
        internal.aiSessions.registerOwnership,
        {
          organizationId,
          userId,
          sessionId,
          continuationTokenHash,
        },
      );
      return success(data);
    }
    if (action === "assert") {
      const data = await ctx.runQuery(
        internal.aiSessions.assertOwnership,
        {
          organizationId,
          userId,
          sessionId: stringValue(input, "sessionId"),
        },
      );
      if (!data.allowed) {
        throw new ConvexError({ code: "EVE_SESSION_FORBIDDEN" });
      }
      return success({ allowed: true });
    }
    if (action === "assert-continuation") {
      const continuationTokenHash = stringValue(
        input,
        "continuationTokenHash",
        64,
      );
      if (!/^[a-f0-9]{64}$/.test(continuationTokenHash)) {
        throw new ConvexError({ code: "INVALID_REQUEST" });
      }
      const data = await ctx.runQuery(
        internal.aiSessions.assertContinuationOwnership,
        {
          organizationId,
          userId,
          continuationTokenHash,
        },
      );
      if (!data.allowed) {
        throw new ConvexError({ code: "EVE_SESSION_FORBIDDEN" });
      }
      return success({ allowed: true });
    }
    throw new ConvexError({ code: "INVALID_REQUEST" });
  } catch (error) {
    const code = errorCode(error);
    const status =
      code.includes("session_forbidden") ||
      code.includes("not_entitled")
        ? 403
        : errorStatus(code);
    return failure(
      status,
      code,
      status === 403
        ? "Session ownership was not verified."
        : "The session ownership request failed.",
    );
  }
}

http.route({
  path: "/eve/assistant",
  method: "POST",
  handler: httpAction(assistantHandler),
});

http.route({
  path: "/eve/session-ownership",
  method: "POST",
  handler: httpAction(ownershipHandler),
});

export default http;
