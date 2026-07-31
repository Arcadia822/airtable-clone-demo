import { describe, expect, it } from "vitest";

import { validateFieldConfiguration } from "./cells";

describe("field configuration boundaries", () => {
  it("accepts ordered numeric limits within the safe range", () => {
    expect(() =>
      validateFieldConfiguration("number", {
        min: -1_000_000,
        max: 1_000_000,
        precision: 2,
      }),
    ).not.toThrow();
  });

  it("rejects reversed or unsafe numeric limits", () => {
    expect(() =>
      validateFieldConfiguration("currency", { min: 20, max: 10 }),
    ).toThrow();
    expect(() =>
      validateFieldConfiguration("number", {
        max: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow();
  });

  it("uses the real maximum for each text-like column", () => {
    expect(() =>
      validateFieldConfiguration("email", { maxLength: 320 }),
    ).not.toThrow();
    expect(() =>
      validateFieldConfiguration("email", { maxLength: 321 }),
    ).toThrow();
    expect(() =>
      validateFieldConfiguration("longText", { maxLength: 100_000 }),
    ).not.toThrow();
  });
});
