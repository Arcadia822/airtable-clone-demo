import { describe, expect, it } from "vitest"

import {
  DEMO_FEEDBACK_FORM,
  DEMO_SEED_COUNTS,
  DEMO_SEED_TABLES,
  demoAnalyticsDays,
} from "../../convex/lib/demoSeedData"
import { PLAN_LIMITS } from "../../convex/lib/quotas"

describe("demo seed fixture", () => {
  it("fits every Free-plan resource limit", () => {
    expect(DEMO_SEED_COUNTS.tables).toBeLessThanOrEqual(
      PLAN_LIMITS.free.tablesPerBase,
    )
    expect(DEMO_SEED_COUNTS.records).toBeLessThanOrEqual(
      PLAN_LIMITS.free.recordsPerOrg,
    )
    expect(DEMO_SEED_COUNTS.forms).toBeLessThanOrEqual(
      PLAN_LIMITS.free.formsPerBase,
    )
    for (const table of DEMO_SEED_TABLES) {
      expect(table.fields.length).toBeLessThanOrEqual(
        PLAN_LIMITS.free.fieldsPerTable,
      )
    }
  })

  it("uses unique fixture keys and only references fields in each table", () => {
    expect(new Set(DEMO_SEED_TABLES.map((table) => table.key)).size).toBe(
      DEMO_SEED_TABLES.length,
    )

    for (const table of DEMO_SEED_TABLES) {
      const fieldKeys = new Set(table.fields.map((field) => field.key))
      expect(fieldKeys.size).toBe(table.fields.length)
      expect(table.fields.filter((field) => field.isPrimary)).toHaveLength(1)
      for (const record of table.records) {
        for (const fieldKey of Object.keys(record.values)) {
          expect(fieldKeys.has(fieldKey)).toBe(true)
        }
      }
    }
  })

  it("maps the public form to real feedback fields", () => {
    const feedback = DEMO_SEED_TABLES.find(
      (table) => table.key === "feedback",
    )
    expect(feedback).toBeDefined()
    if (!feedback) throw new Error("Feedback seed table is missing.")

    const fieldKeys = new Set(feedback.fields.map((field) => field.key))
    const mappedKeys = DEMO_FEEDBACK_FORM.mappedFieldKeys.map(
      (mapping) => mapping.key,
    )
    expect(new Set(mappedKeys).size).toBe(mappedKeys.length)
    for (const key of mappedKeys) expect(fieldKeys.has(key)).toBe(true)
  })

  it("includes safe image and file upload examples without fake values", () => {
    const attachmentModes = new Set(
      DEMO_SEED_TABLES.flatMap((table) =>
        table.fields.flatMap((field) =>
          field.type === "attachment" && field.config.attachmentKind
            ? [field.config.attachmentKind]
            : [],
        ),
      ),
    )
    expect(attachmentModes).toEqual(new Set(["image", "file"]))

    for (const table of DEMO_SEED_TABLES) {
      const attachmentKeys = new Set(
        table.fields
          .filter((field) => field.type === "attachment")
          .map((field) => field.key),
      )
      for (const record of table.records) {
        for (const key of attachmentKeys) {
          expect(record.values).not.toHaveProperty(key)
        }
      }
    }
  })

  it("keeps seeded submission analytics aligned with stored submissions", () => {
    const now = Date.UTC(2026, 6, 30, 12)
    const analytics = demoAnalyticsDays(now)
    const feedback = DEMO_SEED_TABLES.find(
      (table) => table.key === "feedback",
    )
    expect(feedback).toBeDefined()
    if (!feedback) throw new Error("Feedback seed table is missing.")

    const storedSubmissions = feedback.records.filter(
      (record) => record.submittedDaysAgo !== undefined,
    ).length
    expect(analytics).toHaveLength(14)
    expect(new Set(analytics.map((day) => day.day)).size).toBe(14)
    expect(
      analytics.reduce((total, day) => total + day.submissions, 0),
    ).toBe(storedSubmissions)
    expect(analytics.every((day) => day.abandonments > 0)).toBe(true)
  })
})
