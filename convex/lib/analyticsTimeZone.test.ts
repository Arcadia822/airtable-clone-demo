import { describe, expect, it } from "vitest";

import {
  analyticsDayAt,
  normalizeAnalyticsTimeZone,
  shiftAnalyticsDay,
  startOfAnalyticsDay,
} from "./analyticsTimeZone";

describe("analytics timezone boundaries", () => {
  it("buckets a Dubai event into the next local day while UTC stays unchanged", () => {
    const timestamp = Date.parse("2026-07-30T20:30:00.000Z");
    expect(analyticsDayAt(timestamp, "UTC")).toBe("2026-07-30");
    expect(analyticsDayAt(timestamp, "Asia/Dubai")).toBe("2026-07-31");
    expect(startOfAnalyticsDay("2026-07-31", "Asia/Dubai")).toBe(
      Date.parse("2026-07-30T20:00:00.000Z"),
    );
  });

  it("uses calendar days for previous periods and rejects invalid IANA zones", () => {
    expect(shiftAnalyticsDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(() => normalizeAnalyticsTimeZone("Not/A_Timezone")).toThrow();
  });

  it("uses local midnights across daylight-saving changes", () => {
    const start = startOfAnalyticsDay(
      "2026-03-08",
      "America/New_York",
    );
    const next = startOfAnalyticsDay(
      "2026-03-09",
      "America/New_York",
    );

    expect(next - start).toBe(23 * 60 * 60 * 1_000);
    expect(analyticsDayAt(start, "America/New_York")).toBe(
      "2026-03-08",
    );
  });
});
