import { describe, expect, it } from "vitest";

import {
  isAcceptedTurnstileResponse,
  TURNSTILE_ALWAYS_PASS_TEST_SECRET,
} from "./turnstileValidation";

describe("Turnstile response validation", () => {
  it("requires the configured production action and hostname", () => {
    expect(
      isAcceptedTurnstileResponse({
        expectedAction: "form-submit",
        expectedHostname: "forms.example.com",
        response: {
          success: true,
          action: "form-submit",
          hostname: "forms.example.com",
        },
        secret: "production-secret",
      }),
    ).toBe(true);
    expect(
      isAcceptedTurnstileResponse({
        expectedAction: "form-submit",
        expectedHostname: "forms.example.com",
        response: {
          success: true,
          action: "test",
          hostname: "forms.example.com",
        },
        secret: "production-secret",
      }),
    ).toBe(false);
  });

  it("accepts Cloudflare's current actionless success only with its test secret", () => {
    expect(
      isAcceptedTurnstileResponse({
        expectedAction: "form-submit",
        response: {
          success: true,
          hostname: "example.com",
        },
        secret: TURNSTILE_ALWAYS_PASS_TEST_SECRET,
      }),
    ).toBe(true);
    expect(
      isAcceptedTurnstileResponse({
        expectedAction: "form-submit",
        response: {
          success: false,
        },
        secret: TURNSTILE_ALWAYS_PASS_TEST_SECRET,
      }),
    ).toBe(false);
  });
});
