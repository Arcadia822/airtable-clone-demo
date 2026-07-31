import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { signEveRequest } from "./hmac";

describe("signEveRequest", () => {
  it("binds the timestamp, nonce, method, path, and exact body", () => {
    const body = JSON.stringify({ operation: "describe_table" });
    const timestamp = "1785427200";
    const nonce = "97dd75cc-b01f-4d01-8cc8-9f94644f465d";
    const method = "POST";
    const pathname = "/eve/assistant";
    const secret = "test-only-secret";
    const expected = createHmac("sha256", secret)
      .update(`${timestamp}.${nonce}.${method}.${pathname}.${body}`, "utf8")
      .digest("hex");

    expect(
      signEveRequest(
        body,
        timestamp,
        nonce,
        method,
        pathname,
        secret,
      ),
    ).toBe(
      `v1=${expected}`,
    );
    expect(
      signEveRequest(
        body,
        timestamp,
        "9c3de692-9905-40ca-ac2f-d859883648e0",
        method,
        pathname,
        secret,
      ),
    ).not.toBe(`v1=${expected}`);
    expect(
      signEveRequest(
        body,
        timestamp,
        nonce,
        method,
        "/eve/session-ownership",
        secret,
      ),
    ).not.toBe(`v1=${expected}`);
  });
});
