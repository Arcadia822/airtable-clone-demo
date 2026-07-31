import { describe, expect, it, vi } from "vitest";

import { resolveEveBearerToken } from "./auth";

describe("resolveEveBearerToken", () => {
  it("uses the default Clerk session token after Convex validates auth", async () => {
    const getToken = vi.fn().mockResolvedValue("session-token");

    await expect(
      resolveEveBearerToken({ getToken, isAuthenticated: true }),
    ).resolves.toBe("session-token");
    expect(getToken).toHaveBeenCalledWith();
  });

  it("does not request a token before Convex authentication succeeds", async () => {
    const getToken = vi.fn().mockResolvedValue("session-token");

    await expect(
      resolveEveBearerToken({ getToken, isAuthenticated: false }),
    ).rejects.toThrow("Workspace authentication is not ready.");
    expect(getToken).not.toHaveBeenCalled();
  });

  it("fails clearly when Clerk cannot refresh the default session token", async () => {
    await expect(
      resolveEveBearerToken({
        getToken: vi.fn().mockResolvedValue(null),
        isAuthenticated: true,
      }),
    ).rejects.toThrow("Workspace authentication expired.");
  });
});
