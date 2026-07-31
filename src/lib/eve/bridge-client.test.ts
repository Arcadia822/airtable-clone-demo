import { afterEach, describe, expect, it, vi } from "vitest";

import { callEveReadBridge } from "./bridge-client";
import { describeTableOutputSchema } from "./contracts";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.EVE_CONVEX_BRIDGE_URL;
  delete process.env.EVE_CONVEX_HMAC_SECRET;
});

describe("EVE bridge caller context", () => {
  it("signs the durable turn ID into read requests", async () => {
    process.env.EVE_CONVEX_BRIDGE_URL =
      "https://convex.example.com/eve/assistant";
    process.env.EVE_CONVEX_HMAC_SECRET = "test-secret";

    const fetchMock = vi.fn(
      async (_input: URL | RequestInfo, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          actor: { turnId?: string };
        };
        expect(body.actor.turnId).toBe("turn_7");

        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              base: { id: "base_1", name: "Base" },
              table: {
                id: "table_1",
                name: "Table",
                recordCount: 0,
                fields: [],
              },
              truncated: false,
              source: {
                kind: "table",
                base: { id: "base_1", name: "Base" },
                table: { id: "table_1", name: "Table" },
                fields: [],
              },
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callEveReadBridge({
        caller: {
          organizationId: "org_1",
          userId: "user_1",
          sessionId: "session_1",
          turnId: "turn_7",
        },
        input: { baseId: "base_1", tableId: "table_1" },
        operation: "describe_table",
        outputSchema: describeTableOutputSchema,
      }),
    ).resolves.toMatchObject({
      table: { id: "table_1" },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
