import { describe, expect, it, vi } from "vitest";

import {
  extractEveResetContinuationTokenHash,
  extractEveSessionId,
  isEveResetRequest,
  withSessionRegistrationGrace,
} from "./session-ownership";
import { sha256Hex } from "./hmac";
import { EveBridgeRequestError } from "./signed-fetch";

describe("EVE session route ownership selectors", () => {
  it.each([
    ["/eve/v1/session/session-123", "session-123"],
    ["/eve/v1/session/session-123/stream", "session-123"],
    ["/eve/v1/session/session-123/cancel", "session-123"],
    ["/eve/agents/analyst/eve/v1/session/session-123/cancel", "session-123"],
  ])("extracts the session id from %s", (path, expected) => {
    expect(extractEveSessionId(new Request(`https://app.example.com${path}`))).toBe(
      expected,
    );
  });

  it("does not mistake the reset route for a session id", () => {
    const request = new Request("https://app.example.com/eve/v1/session/reset");
    expect(isEveResetRequest(request)).toBe(true);
    expect(extractEveSessionId(request)).toBeUndefined();
  });

  it("hashes the reset capability without returning the raw token", async () => {
    const continuationToken = "eve:high-entropy-continuation-token";
    const request = new Request("https://app.example.com/eve/v1/session/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ continuationToken }),
    });

    const result = await extractEveResetContinuationTokenHash(request);
    expect(result).toBe(sha256Hex(continuationToken));
    expect(result).not.toContain(continuationToken);
  });

  it.each([
    "",
    "not-json",
    "{}",
    '{"continuationToken":""}',
    '{"continuationToken":42}',
  ])("fails closed for an invalid reset body", async (body) => {
    const request = new Request("https://app.example.com/eve/v1/session/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    await expect(extractEveResetContinuationTokenHash(request)).resolves.toBeUndefined();
  });

  it("allows a just-started session time to finish ownership registration", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(
        new EveBridgeRequestError("Session ownership was not verified.", 403),
      )
      .mockRejectedValueOnce(
        new EveBridgeRequestError("Session ownership was not verified.", 403),
      )
      .mockResolvedValue("owned");
    const waits: number[] = [];

    await expect(
      withSessionRegistrationGrace(operation, async (milliseconds) => {
        waits.push(milliseconds);
      }),
    ).resolves.toBe("owned");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([25, 50]);
  });

  it("does not retry unrelated ownership-service failures", async () => {
    const operation = vi.fn<() => Promise<void>>().mockRejectedValue(
      new EveBridgeRequestError("Assistant authentication failed.", 401),
    );

    await expect(
      withSessionRegistrationGrace(operation, async () => {}),
    ).rejects.toMatchObject({ status: 401 });
    expect(operation).toHaveBeenCalledOnce();
  });
});
