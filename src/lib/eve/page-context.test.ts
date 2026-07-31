import { describe, expect, it } from "vitest";

import { buildAssistantClientContext } from "./page-context";

describe("assistant page context", () => {
  it("keeps secure references in dedicated structured fields", () => {
    expect(
      buildAssistantClientContext({
        base: { id: "base_123", name: "Product operations" },
        form: { id: "form_456", name: "Product feedback" },
      }),
    ).toEqual({
      kind: "workspace-page-context",
      activeScope: {
        base: { id: "base_123", name: "Product operations" },
        form: { id: "form_456", name: "Product feedback" },
      },
    });
  });

  it("omits empty page context instead of sending ambiguous prose", () => {
    expect(buildAssistantClientContext()).toBeUndefined();
    expect(buildAssistantClientContext({})).toBeUndefined();
  });
});
