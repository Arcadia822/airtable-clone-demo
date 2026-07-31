import { describe, expect, it } from "vitest"

import {
  analyticsDeviceCategory,
  analyticsRange,
  analyticsTrafficSource,
  createFormAnalyticsCsv,
  customAnalyticsRangeIssue,
  formAnalyticsCsvFileName,
} from "@/lib/form-analytics"

describe("form analytics helpers", () => {
  it("builds bounded preset and custom date ranges", () => {
    expect(
      analyticsRange(
        7,
        new Date("2026-07-30T20:00:00.000Z"),
        "UTC",
      ),
    ).toEqual({
      fromDay: "2026-07-24",
      toDay: "2026-07-30",
    })
    expect(
      customAnalyticsRangeIssue(
        { fromDay: "2026-07-01", toDay: "2026-07-30" },
        "2026-07-30",
      ),
    ).toBeNull()
    expect(
      customAnalyticsRangeIssue(
        { fromDay: "2026-07-30", toDay: "2026-07-01" },
        "2026-07-30",
      ),
    ).toMatch(/end date/i)
    expect(
      customAnalyticsRangeIssue(
        { fromDay: "2026-01-01", toDay: "2026-07-30" },
        "2026-07-30",
      ),
    ).toMatch(/90 days/i)
  })

  it("uses the selected workspace timezone at the UTC day boundary", () => {
    const boundary = new Date("2026-07-30T20:30:00.000Z")
    expect(analyticsRange(1, boundary, "UTC")).toEqual({
      fromDay: "2026-07-30",
      toDay: "2026-07-30",
    })
    expect(analyticsRange(1, boundary, "Asia/Dubai")).toEqual({
      fromDay: "2026-07-31",
      toDay: "2026-07-31",
    })
  })

  it("reduces browser context to broad privacy-safe categories", () => {
    expect(analyticsDeviceCategory(390)).toBe("mobile")
    expect(analyticsDeviceCategory(820)).toBe("tablet")
    expect(analyticsDeviceCategory(1_440)).toBe("desktop")
    expect(analyticsDeviceCategory(undefined)).toBe("unknown")

    expect(
      analyticsTrafficSource({
        currentUrl: "https://forms.example.com/f/customer-feedback",
        referrer: "",
      }),
    ).toBe("direct")
    expect(
      analyticsTrafficSource({
        currentUrl:
          "https://forms.example.com/f/customer-feedback?utm_campaign=launch",
        referrer: "https://sensitive.example/path?person=sam",
      }),
    ).toBe("campaign")
    expect(
      analyticsTrafficSource({
        currentUrl: "https://forms.example.com/f/customer-feedback",
        referrer: "https://www.google.com/search?q=private+words",
      }),
    ).toBe("search")
    expect(
      analyticsTrafficSource({
        currentUrl: "https://forms.example.com/f/customer-feedback",
        referrer: "https://www.linkedin.com/feed/",
      }),
    ).toBe("social")
    expect(
      analyticsTrafficSource({
        currentUrl: "https://forms.example.com/f/customer-feedback",
        referrer: "https://partner.example/private/customer",
      }),
    ).toBe("referral")
  })

  it("exports only friendly aggregate results and neutralizes spreadsheet formulas", () => {
    const report = {
      form: { name: "Customer feedback / Q3" },
      fromDay: "2026-07-24",
      toDay: "2026-07-30",
      comparison: {
        metrics: [
          {
            label: "Unique views",
            current: 15,
            previous: 12,
            change: 3,
            percentChange: 0.25,
          },
        ],
      },
      series: [
        {
          date: "2026-07-30",
          views: 15,
          starts: 9,
          submissions: 2,
          validationErrors: 1,
          abandonments: 3,
        },
      ],
      breakdowns: {
        devices: {
          items: [{ label: "Desktop", count: 10, share: 2 / 3 }],
        },
        trafficSources: {
          items: [{ label: "Search", count: 8, share: 8 / 15 }],
        },
      },
      questionAbandonment: {
        items: [{ question: "=Private formula", count: 2, share: 2 / 3 }],
      },
    }

    const csv = createFormAnalyticsCsv(report)
    expect(csv).toContain("Overview,Unique views,,15,12,3,25.0%")
    expect(csv).toContain("Device category,Desktop,,10,,,66.7%")
    expect(csv).toContain("Question exits,'=Private formula,,2,,,66.7%")
    expect(csv).not.toMatch(/form_private|field_private|record_private|referrer|file/)
    expect(formAnalyticsCsvFileName(report)).toBe(
      "customer-feedback-q3-analytics-2026-07-24-to-2026-07-30.csv",
    )
  })
})
