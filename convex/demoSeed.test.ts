/// <reference types="vite/client" />

import aggregateTest from "@convex-dev/aggregate/test"
import { convexTest } from "convex-test"
import type { UserIdentity } from "convex/server"
import { describe, expect, it } from "vitest"

import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import {
  baseCount,
  fieldCount,
  formCount,
  recordCount,
  submissionCount,
  tableCount,
  tableRecordCount,
} from "./lib/aggregates"
import schema from "./schema"

const modules = import.meta.glob("./**/*.ts")
const aggregateNames = [
  "baseCount",
  "tableCount",
  "fieldCount",
  "recordCount",
  "tableRecordCount",
  "formCount",
  "submissionCount",
] as const

const orgId = "org_demoSeedTest123456"
const adminIdentity = {
  subject: "user_demoSeedAdmin123456",
  tokenIdentifier: "test|user_demoSeedAdmin123456",
  org_id: orgId,
  org_role: "org:admin",
  pla: "o:free",
} satisfies Partial<UserIdentity> & Record<string, unknown>

function setup() {
  const test = convexTest(schema, modules)
  for (const name of aggregateNames) aggregateTest.register(test, name)
  return test
}

describe("demoSeed.install", () => {
  it("rejects unauthenticated users and non-admin organization members", async () => {
    const test = setup()
    await expect(test.mutation(api.demoSeed.install, {})).rejects.toThrow()

    const member = test.withIdentity({
      ...adminIdentity,
      subject: "user_demoSeedMember123456",
      tokenIdentifier: "test|user_demoSeedMember123456",
      org_role: "org:member",
    })
    await expect(member.mutation(api.demoSeed.install, {})).rejects.toThrow()
  })

  it("persists a complete fixture, updates aggregates, and is idempotent", async () => {
    const test = setup()
    const admin = test.withIdentity(adminIdentity)

    const created = await admin.mutation(api.demoSeed.install, {})
    expect(created).toMatchObject({
      state: "created",
      counts: { tables: 3, fields: 26, records: 19, forms: 1 },
    })
    expect(created.publicFormSlug).toBe("product-feedback")
    expect(created.publicFormSlug).not.toContain(String(created.baseId))
    expect(created.publicFormSlug).not.toContain(String(created.formId))

    const persisted = await test.run(async (ctx) => ({
      bases: await ctx.db.query("bases").take(10),
      tables: await ctx.db.query("tables").take(10),
      fields: await ctx.db.query("fields").take(50),
      views: await ctx.db.query("views").take(10),
      viewFieldConfigs: await ctx.db.query("viewFieldConfigs").take(50),
      records: await ctx.db.query("records").take(50),
      forms: await ctx.db.query("forms").take(10),
      formVersions: await ctx.db.query("formVersions").take(10),
      formDraftFields: await ctx.db.query("formDraftFields").take(20),
      formVersionFields: await ctx.db.query("formVersionFields").take(20),
      publishedRefs: await ctx.db.query("formPublishedFieldRefs").take(20),
      submissions: await ctx.db.query("formSubmissions").take(20),
      metricBuckets: await ctx.db.query("formMetricBuckets").take(100),
      formStats: await ctx.db.query("formStats").take(10),
      analyticsBreakdowns: await ctx.db
        .query("formAnalyticsBreakdownBuckets")
        .take(200),
      formSlugAliases: await ctx.db.query("formSlugAliases").take(10),
      markers: await ctx.db.query("demoSeedInstalls").take(10),
    }))
    expect(persisted.bases).toHaveLength(1)
    expect(persisted.tables).toHaveLength(3)
    expect(persisted.fields).toHaveLength(26)
    expect(persisted.views).toHaveLength(3)
    expect(persisted.viewFieldConfigs).toHaveLength(26)
    expect(persisted.records).toHaveLength(19)
    expect(persisted.forms).toHaveLength(1)
    expect(persisted.formVersions).toHaveLength(1)
    expect(persisted.formDraftFields).toHaveLength(7)
    expect(persisted.formVersionFields).toHaveLength(7)
    expect(persisted.publishedRefs).toHaveLength(7)
    expect(persisted.submissions).toHaveLength(6)
    expect(persisted.metricBuckets).toHaveLength(70)
    expect(persisted.formStats).toHaveLength(1)
    expect(persisted.analyticsBreakdowns).toHaveLength(126)
    expect(persisted.formSlugAliases).toHaveLength(0)
    expect(persisted.markers).toHaveLength(1)
    for (const table of persisted.tables) {
      const view = persisted.views.find(
        (candidate) => candidate._id === table.defaultViewId,
      )
      expect(view).toMatchObject({
        tableId: table._id,
        baseId: table.baseId,
        orgId,
        name: "Grid view",
        type: "grid",
        status: "active",
        visibility: "collaborators",
        isDefault: true,
      })
      const fields = persisted.fields.filter(
        (field) => field.tableId === table._id,
      )
      const configs = persisted.viewFieldConfigs.filter(
        (config) => config.viewId === view?._id,
      )
      expect(configs).toHaveLength(fields.length)
      for (const field of fields) {
        expect(
          configs.find((config) => config.fieldId === field._id),
        ).toMatchObject({
          tableId: table._id,
          baseId: table.baseId,
          orgId,
          width: field.width,
          hidden: false,
          frozen: field.isPrimary,
        })
      }
    }
    expect(
      persisted.metricBuckets
        .filter((bucket) => bucket.metric === "submission")
        .reduce((total, bucket) => total + bucket.count, 0),
    ).toBe(persisted.submissions.length)
    expect(persisted.formStats[0]).toMatchObject({
      orgId,
      formId: created.formId,
      views: persisted.metricBuckets
        .filter((bucket) => bucket.metric === "view")
        .reduce((total, bucket) => total + bucket.count, 0),
      submissions: persisted.submissions.length,
    })

    const earliestMetricDay = persisted.metricBuckets
      .map((bucket) => bucket.day)
      .sort()[0]
    expect(earliestMetricDay).toBeDefined()
    expect(persisted.forms[0]?.publishedAt).toBeLessThanOrEqual(
      Date.parse(`${earliestMetricDay}T00:00:00.000Z`),
    )

    const aggregateTotals = await test.run(async (ctx) => ({
      bases: await baseCount.count(ctx, { namespace: orgId }),
      tables: await tableCount.count(ctx, { namespace: created.baseId }),
      fields: await Promise.all(
        persisted.tables.map((table) =>
          fieldCount.count(ctx, { namespace: table._id }),
        ),
      ),
      records: await recordCount.count(ctx, { namespace: orgId }),
      tableRecords: await Promise.all(
        persisted.tables.map((table) =>
          tableRecordCount.count(ctx, { namespace: table._id }),
        ),
      ),
      forms: await formCount.count(ctx, { namespace: created.baseId }),
      submissions: await Promise.all(
        [...new Set(persisted.submissions.map((row) => row.submittedMonth))].map(
          (month) =>
            submissionCount.count(ctx, { namespace: `${orgId}:${month}` }),
        ),
      ),
    }))
    expect(aggregateTotals.bases).toBe(1)
    expect(aggregateTotals.tables).toBe(3)
    expect(aggregateTotals.fields.reduce((total, count) => total + count, 0)).toBe(
      26,
    )
    expect(aggregateTotals.records).toBe(19)
    expect(
      aggregateTotals.tableRecords.reduce((total, count) => total + count, 0),
    ).toBe(19)
    expect(aggregateTotals.forms).toBe(1)
    expect(
      aggregateTotals.submissions.reduce((total, count) => total + count, 0),
    ).toBe(6)

    const existing = await admin.mutation(api.demoSeed.install, {})
    expect(existing).toMatchObject({
      state: "existing",
      baseId: created.baseId,
      formId: created.formId,
    })
    const afterRerun = await test.run(async (ctx) => ({
      bases: await ctx.db.query("bases").take(10),
      markers: await ctx.db.query("demoSeedInstalls").take(10),
      records: await ctx.db.query("records").take(50),
      views: await ctx.db.query("views").take(10),
      viewFieldConfigs: await ctx.db.query("viewFieldConfigs").take(50),
      formStats: await ctx.db.query("formStats").take(10),
      formSlugAliases: await ctx.db.query("formSlugAliases").take(10),
    }))
    expect(afterRerun.bases).toHaveLength(1)
    expect(afterRerun.markers).toHaveLength(1)
    expect(afterRerun.records).toHaveLength(19)
    expect(afterRerun.views).toHaveLength(3)
    expect(afterRerun.viewFieldConfigs).toHaveLength(26)
    expect(afterRerun.formStats).toHaveLength(1)
    expect(afterRerun.formSlugAliases).toHaveLength(0)
  })

  it("migrates an opaque demo link once and keeps the previously shared link working", async () => {
    const test = setup()
    const admin = test.withIdentity(adminIdentity)
    const created = await admin.mutation(api.demoSeed.install, {})
    const legacySlug = `product-feedback-${created.baseId}`

    await test.run(async (ctx) => {
      await ctx.db.patch(created.formId, { slug: legacySlug })
      const marker = await ctx.db
        .query("demoSeedInstalls")
        .withIndex("by_org_id_and_template_key", (q) =>
          q.eq("orgId", orgId).eq("templateKey", "product-operations"),
        )
        .unique()
      expect(marker).not.toBeNull()
      await ctx.db.patch(marker!._id, {
        publicFormSlug: legacySlug,
      })
    })

    const migrated = await admin.mutation(api.demoSeed.install, {})
    expect(migrated.publicFormSlug).toBe("product-feedback")
    expect(migrated.publicFormSlug).not.toContain(String(created.baseId))
    expect(
      await test.query(internal.forms.getPublic, {
        slug: migrated.publicFormSlug,
      }),
    ).not.toBeNull()
    expect(
      await test.query(internal.forms.getPublic, { slug: legacySlug }),
    ).not.toBeNull()

    const firstAliases = await test.run(async (ctx) => {
      return await ctx.db.query("formSlugAliases").take(10)
    })
    expect(firstAliases).toEqual([
      expect.objectContaining({
        slug: legacySlug,
        formId: created.formId,
        orgId,
      }),
    ])

    const rerun = await admin.mutation(api.demoSeed.install, {})
    expect(rerun.publicFormSlug).toBe("product-feedback")
    const aliasesAfterRerun = await test.run(async (ctx) => {
      return await ctx.db.query("formSlugAliases").take(10)
    })
    expect(aliasesAfterRerun).toHaveLength(1)
  })

  it("rolls back cleanly when the Free base quota is already full", async () => {
    const test = setup()
    const admin = test.withIdentity(adminIdentity)
    await admin.mutation(api.bases.create, { name: "Existing base" })

    await expect(admin.mutation(api.demoSeed.install, {})).rejects.toThrow()
    const state = await test.run(async (ctx) => ({
      bases: await ctx.db.query("bases").take(10),
      markers: await ctx.db.query("demoSeedInstalls").take(10),
      tables: await ctx.db.query("tables").take(10),
    }))
    expect(state.bases).toHaveLength(1)
    expect(state.markers).toHaveLength(0)
    expect(state.tables).toHaveLength(0)
  })

  it("disables the public form while its base is trashed and restores it safely", async () => {
    const test = setup()
    const admin = test.withIdentity(adminIdentity)
    const created = await admin.mutation(api.demoSeed.install, {})

    const beforeTrash = await test.query(internal.forms.getPublic, {
      slug: created.publicFormSlug,
    })
    expect(beforeTrash).not.toBeNull()

    await admin.mutation(api.bases.remove, { baseId: created.baseId })
    const deleted = await admin.mutation(api.demoSeed.install, {})
    expect(deleted.state).toBe("deleted")
    expect(
      await test.query(internal.forms.getPublic, {
        slug: created.publicFormSlug,
      }),
    ).toBeNull()

    await admin.mutation(api.bases.restore, { baseId: created.baseId })
    expect(
      await test.query(internal.forms.getPublic, {
        slug: created.publicFormSlug,
      }),
    ).not.toBeNull()
  })

  it("reports a hard-missing base without duplicating orphaned data", async () => {
    const test = setup()
    const admin = test.withIdentity(adminIdentity)
    const created = await admin.mutation(api.demoSeed.install, {})
    await test.run(async (ctx) => {
      await ctx.db.delete("bases", created.baseId as Id<"bases">)
    })

    const missing = await admin.mutation(api.demoSeed.install, {})
    expect(missing).toMatchObject({
      state: "missing",
      baseId: created.baseId,
      formId: created.formId,
    })
    const state = await test.run(async (ctx) => ({
      bases: await ctx.db.query("bases").take(10),
      markers: await ctx.db.query("demoSeedInstalls").take(10),
      tables: await ctx.db.query("tables").take(10),
      records: await ctx.db.query("records").take(50),
    }))
    expect(state.bases).toHaveLength(0)
    expect(state.markers).toHaveLength(1)
    expect(state.tables).toHaveLength(3)
    expect(state.records).toHaveLength(19)
  })
})

describe("view-backed writers", () => {
  it("creates and repairs default views for regular table and field writes", async () => {
    const test = setup()
    const admin = test.withIdentity(adminIdentity)
    const baseId = await admin.mutation(api.bases.create, {
      name: "View writer base",
    })
    const { tableId, primaryFieldId } = await admin.mutation(
      api.tables.create,
      {
        baseId,
        name: "Projects",
      },
    )

    const initial = await test.run(async (ctx) => {
      const table = await ctx.db.get(tableId)
      const view =
        table?.defaultViewId === undefined
          ? null
          : await ctx.db.get(table.defaultViewId)
      const configs =
        view === null
          ? []
          : await ctx.db
              .query("viewFieldConfigs")
              .withIndex("by_view_and_rank", (q) => q.eq("viewId", view._id))
              .take(10)
      return { table, view, configs }
    })
    expect(initial.view).toMatchObject({
      tableId,
      baseId,
      name: "Grid view",
      type: "grid",
      status: "active",
      isDefault: true,
    })
    expect(initial.configs).toEqual([
      expect.objectContaining({
        fieldId: primaryFieldId,
        frozen: true,
        hidden: false,
        width: 240,
      }),
    ])

    const fieldId = await admin.mutation(api.fields.create, {
      tableId,
      name: "Notes",
      type: "singleLineText",
      config: { maxLength: 2_000 },
      width: 320,
    })
    const createdConfig = await test.run(async (ctx) => {
      return await ctx.db
        .query("viewFieldConfigs")
        .withIndex("by_view_and_field", (q) =>
          q.eq("viewId", initial.view!._id).eq("fieldId", fieldId),
        )
        .unique()
    })
    expect(createdConfig).toMatchObject({
      fieldId,
      viewId: initial.view?._id,
      frozen: false,
      hidden: false,
      width: 320,
    })
    const primaryRank = await test.run(async (ctx) => {
      return (await ctx.db.get(primaryFieldId))!.rank
    })
    const insertedFieldId = await admin.mutation(api.fields.create, {
      tableId,
      name: "Inserted after name",
      type: "singleLineText",
      config: { maxLength: 2_000 },
      afterRank: primaryRank,
    })
    const orderedFieldIds = await test.run(async (ctx) => {
      return (
        await ctx.db
          .query("viewFieldConfigs")
          .withIndex("by_view_and_rank", (q) =>
            q.eq("viewId", initial.view!._id),
          )
          .take(10)
      ).map((config) => config.fieldId)
    })
    expect(orderedFieldIds).toEqual([
      primaryFieldId,
      insertedFieldId,
      fieldId,
    ])

    await test.run(async (ctx) => {
      await ctx.db.delete("viewFieldConfigs", createdConfig!._id)
    })
    await admin.mutation(api.fields.remove, { fieldId })
    await admin.mutation(api.fields.restore, { fieldId })
    expect(
      await test.run(async (ctx) => {
        return await ctx.db
          .query("viewFieldConfigs")
          .withIndex("by_view_and_field", (q) =>
            q.eq("viewId", initial.view!._id).eq("fieldId", fieldId),
          )
          .unique()
      }),
    ).toMatchObject({ fieldId, width: 320, hidden: false })

    await test.run(async (ctx) => {
      const configs = await ctx.db
        .query("viewFieldConfigs")
        .withIndex("by_view_and_rank", (q) =>
          q.eq("viewId", initial.view!._id),
        )
        .take(10)
      for (const config of configs) {
        await ctx.db.delete("viewFieldConfigs", config._id)
      }
      await ctx.db.delete("views", initial.view!._id)
      await ctx.db.patch(tableId, { defaultViewId: undefined })
    })
    await admin.mutation(api.tables.remove, { tableId })
    await admin.mutation(api.tables.restore, { tableId })

    const restored = await test.run(async (ctx) => {
      const table = await ctx.db.get(tableId)
      const view =
        table?.defaultViewId === undefined
          ? null
          : await ctx.db.get(table.defaultViewId)
      const configs =
        view === null
          ? []
          : await ctx.db
              .query("viewFieldConfigs")
              .withIndex("by_view_and_rank", (q) => q.eq("viewId", view._id))
              .take(10)
      return { table, view, configs }
    })
    expect(restored.view).toMatchObject({
      tableId,
      name: "Grid view",
      type: "grid",
      isDefault: true,
    })
    expect(restored.configs).toHaveLength(3)
    expect(
      restored.configs.find((config) => config.fieldId === primaryFieldId),
    ).toMatchObject({ frozen: true })
    expect(
      restored.configs.find((config) => config.fieldId === fieldId),
    ).toMatchObject({ frozen: false, width: 320 })
    expect(
      restored.configs.find(
        (config) => config.fieldId === insertedFieldId,
      ),
    ).toMatchObject({ frozen: false, hidden: false })
  })

  it("adds AI-created fields to the table's active views", async () => {
    const test = setup()
    const admin = test.withIdentity(adminIdentity)
    const baseId = await admin.mutation(api.bases.create, {
      name: "AI view writer base",
    })
    const { tableId, primaryFieldId } = await admin.mutation(api.tables.create, {
      baseId,
      name: "Research",
    })
    const trailingFieldId = await admin.mutation(api.fields.create, {
      tableId,
      name: "Trailing notes",
      type: "singleLineText",
      config: { maxLength: 2_000 },
    })
    const externalSessionId = "wrun_view_writer_test"
    await test.mutation(internal.aiSessions.registerOwnership, {
      organizationId: orgId,
      userId: adminIdentity.subject,
      sessionId: externalSessionId,
      continuationTokenHash: "continuation-view-writer-test",
    })

    const result = await test.mutation(internal.aiWrites.apply, {
      organizationId: orgId,
      userId: adminIdentity.subject,
      sessionId: externalSessionId,
      callId: "call-view-writer-test",
      role: "org:admin",
      operation: "create_field",
      idempotencyKey: "ai-field-view-writer-test",
      payloadHash: "a".repeat(64),
      input: {
        baseId,
        tableId,
        insertAfterFieldId: primaryFieldId,
        field: {
          name: "AI notes",
          type: "singleLineText",
          config: { maxLength: 2_000 },
        },
      },
    })
    const fieldId = result.entityIds.fieldId as Id<"fields">

    const persisted = await test.run(async (ctx) => {
      const table = await ctx.db.get(tableId)
      const field = await ctx.db.get(fieldId)
      const config =
        table?.defaultViewId === undefined
          ? null
          : await ctx.db
              .query("viewFieldConfigs")
              .withIndex("by_view_and_field", (q) =>
                q.eq("viewId", table.defaultViewId!).eq("fieldId", fieldId),
              )
              .unique()
      const orderedFieldIds =
        table?.defaultViewId === undefined
          ? []
          : (
              await ctx.db
                .query("viewFieldConfigs")
                .withIndex("by_view_and_rank", (q) =>
                  q.eq("viewId", table.defaultViewId!),
                )
                .take(10)
            ).map((item) => item.fieldId)
      return { table, field, config, orderedFieldIds }
    })
    expect(persisted.field).toMatchObject({
      tableId,
      name: "AI notes",
      type: "singleLineText",
    })
    expect(persisted.config).toMatchObject({
      fieldId,
      viewId: persisted.table?.defaultViewId,
      width: 180,
      hidden: false,
      frozen: false,
    })
    expect(persisted.orderedFieldIds).toEqual([
      primaryFieldId,
      fieldId,
      trailingFieldId,
    ])
  })
})
