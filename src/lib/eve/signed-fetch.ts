import { signEveRequest } from "./hmac";

const MAX_REQUEST_BYTES = 128_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 20_000;

type SignedFetchOptions = {
  signal?: AbortSignal;
};

export class EveBridgeRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "EveBridgeRequestError";
    this.status = status;
  }
}

export async function signedEvePost(
  endpoint: string,
  body: unknown,
  options: SignedFetchOptions = {},
): Promise<unknown> {
  const url = validateEndpoint(endpoint);
  const rawBody = JSON.stringify(body);
  if (rawBody.length > MAX_REQUEST_BYTES) {
    throw new Error("The assistant bridge request exceeded its size limit.");
  }

  const secret = process.env.EVE_CONVEX_HMAC_SECRET;
  if (!secret) {
    throw new Error("EVE_CONVEX_HMAC_SECRET is not configured.");
  }

  const timestamp = Math.floor(Date.now() / 1_000).toString();
  const nonce = crypto.randomUUID();
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-eve-key-id": process.env.EVE_CONVEX_HMAC_KEY_ID ?? "primary",
      "x-eve-nonce": nonce,
      "x-eve-signature": signEveRequest(
        rawBody,
        timestamp,
        nonce,
        "POST",
        url.pathname,
        secret,
      ),
      "x-eve-timestamp": timestamp,
    },
    body: rawBody,
    cache: "no-store",
    redirect: "error",
    signal,
  });

  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("The assistant bridge returned an oversized response.");
  }

  const rawResponse = await response.text();
  if (rawResponse.length > MAX_RESPONSE_BYTES) {
    throw new Error("The assistant bridge returned an oversized response.");
  }

  let payload: unknown;
  try {
    payload = rawResponse.length > 0 ? JSON.parse(rawResponse) : null;
  } catch {
    throw new Error(`The assistant bridge returned invalid JSON (${response.status}).`);
  }

  if (!response.ok) {
    const message = extractSafeError(payload);
    throw new EveBridgeRequestError(
      message ?? `The assistant bridge rejected the request (${response.status}).`,
      response.status,
    );
  }

  return payload;
}

function validateEndpoint(endpoint: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("The assistant bridge URL is invalid.");
  }

  const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !isLoopback) {
    throw new Error("The assistant bridge must use HTTPS.");
  }
  return url;
}

function extractSafeError(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== "object") {
    return undefined;
  }

  const error = "error" in payload ? payload.error : undefined;
  if (typeof error === "string") {
    return error.slice(0, 300);
  }
  if (error !== null && typeof error === "object" && "message" in error) {
    const message = error.message;
    return typeof message === "string" ? message.slice(0, 300) : undefined;
  }
  return undefined;
}
