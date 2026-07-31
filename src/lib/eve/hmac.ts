import { createHash, createHmac } from "node:crypto";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function signEveRequest(
  rawBody: string,
  timestamp: string,
  nonce: string,
  method: string,
  pathname: string,
  secret: string,
): string {
  const digest = createHmac("sha256", secret)
    .update(
      `${timestamp}.${nonce}.${method.toUpperCase()}.${pathname}.${rawBody}`,
      "utf8",
    )
    .digest("hex");
  return `v1=${digest}`;
}
