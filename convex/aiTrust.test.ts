/// <reference types="vite/client" />

import aggregateTest from "@convex-dev/aggregate/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { internal } from "./_generated/api";
import {
  recordCount,
  tableRecordCount,
} from "./lib/aggregates";
import { createRank } from "./lib/data";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
  const test = convexTest(schema, modules);
  aggregateTest.register(test, "recordCount");
  aggregateTest.register(test, "tableRecordCount");
  return test;
}

async function insertFixture(
  test: ReturnType<typeof setup>,
  organizationId: string,
  userId: string,
) {
  return await test.run(async (ctx) => {
    const now = Date.now();
    const baseId = await ctx.db.insert("bases", {
      orgId: organizationId,
      name: "Product operations",
      rank: createRank(),
      status: "active",
      createdByUserId: userId,
      updatedAt: now,
    });
    const tableId = await ctx.db.insert("tables", {
      orgId: organizationId,
      baseId,
      name: "Product roadmap",
      rank: createRank(),
      status: "active",
      createdByUserId: userId,
      updatedAt: now,
    });
    const nameFieldId = await ctx.db.insert("fields", {
      orgId: organizationId,
      baseId,
      tableId,
      name: "Initiative",
      type: "singleLineText",
      config: { maxLength: 10_000 },
      rank: createRank(),
      width: 240,
      isPrimary: true,
      status: "active",
      revision: 1,
      createdByUserId: userId,
      updatedAt: now,
    });
    const notesFieldId = await ctx.db.insert("fields", {
      orgId: organizationId,
      baseId,
      tableId,
      name: "Notes",
      type: "longText",
      config: { maxLength: 50_000 },
      rank: createRank(),
      width: 300,
      isPrimary: false,
      status: "active",
      revision: 1,
      createdByUserId: userId,
      updatedAt: now,
    });
    await ctx.db.patch(tableId, { primaryFieldId: nameFieldId });
    const recordId = await ctx.db.insert("records", {
      orgId: organizationId,
      baseId,
      tableId,
      rank: createRank(),
      values: {
        [nameFieldId]: "Atlas launch",
        [notesFieldId]: "Original note",
      },
      status: "active",
      revision: 3,
      createdByType: "user",
      createdById: userId,
      updatedByType: "user",
      updatedById: userId,
      updatedAt: now,
    });
    const record = (await ctx.db.get(recordId))!;
    await recordCount.insert(ctx, record);
    await tableRecordCount.insert(ctx, record);
    const formId = await ctx.db.insert("forms", {
      orgId: organizationId,
      baseId,
      tableId,
      name: "Launch intake",
      slug: `launch-intake-${organizationId}`,
      title: "Launch intake",
      description: "Share a launch request.",
      rank: createRank(),
      status: "draft",
      appearance: {
        primaryColor: "#2563eb",
        backgroundColor: "#ffffff",
        submitLabel: "Submit",
        showPoweredBy: true,
      },
      thankYou: {
        title: "Thank you",
        message: "Your response was saved.",
      },
      draftRevision: 4,
      createdByUserId: userId,
      updatedAt: now,
    });
    return {
      baseId,
      tableId,
      nameFieldId,
      notesFieldId,
      recordId,
      formId,
    };
  });
}

async function registerSession(
  test: ReturnType<typeof setup>,
  organizationId: string,
  userId: string,
  sessionId: string,
) {
  await test.mutation(internal.aiSessions.registerOwnership, {
    organizationId,
    userId,
    sessionId,
    continuationTokenHash: `${organizationId}:${userId}:${sessionId}`,
  });
}

function writeArgs(
  organizationId: string,
  userId: string,
  sessionId: string,
  operation: string,
  input: Record<string, unknown>,
  overrides?: {
    idempotencyKey?: string;
    payloadHash?: string;
  },
) {
  return {
    organizationId,
    userId,
    sessionId,
    callId: `call-${operation}`,
    role: "org:admin",
    operation,
    idempotencyKey:
      overrides?.idempotencyKey ?? `idempotency-${operation}`,
    payloadHash: overrides?.payloadHash ?? "a".repeat(64),
    input,
  };
}

describe("AI read and write trust boundaries", () => {
  it("returns exact friendly record provenance and rejects cross-org reads", async () => {
    const test = setup();
    const fixture = await insertFixture(test, "org_ai_read", "user_ai_read");
    await registerSession(
      test,
      "org_ai_read",
      "user_ai_read",
      "session-ai-read",
    );
    await registerSession(
      test,
      "org_ai_other",
      "user_ai_other",
      "session-ai-other",
    );

    const result = await test.query(internal.aiReads.read, {
      organizationId: "org_ai_read",
      userId: "user_ai_read",
      sessionId: "session-ai-read",
      operation: "list_records",
      input: {
        baseId: fixture.baseId,
        tableId: fixture.tableId,
        fieldIds: [fixture.nameFieldId, fixture.notesFieldId],
        limit: 25,
      },
    });

    expect(result.source).toMatchObject({
      kind: "table",
      records: [{ id: fixture.recordId, name: "Atlas launch" }],
      query: {
        kind: "recordList",
        rowLimit: 25,
      },
    });
    if (!("query" in result.source)) {
      throw new Error("Record provenance query was not returned.");
    }
    expect(result.source.query.description).toContain(
      "Product roadmap using Initiative, Notes",
    );
    const inspectedForm = await test.query(internal.aiReads.read, {
      organizationId: "org_ai_read",
      userId: "user_ai_read",
      sessionId: "session-ai-read",
      operation: "inspect_form",
      input: {
        baseId: fixture.baseId,
        formId: fixture.formId,
      },
    });
    if (!("form" in inspectedForm)) {
      throw new Error("Form inspection result was not returned.");
    }
    expect(inspectedForm.form).toMatchObject({
      id: fixture.formId,
      title: "Launch intake",
      version: 4,
    });
    await expect(
      test.query(internal.aiReads.read, {
        organizationId: "org_ai_other",
        userId: "user_ai_other",
        sessionId: "session-ai-other",
        operation: "list_records",
        input: {
          baseId: fixture.baseId,
          tableId: fixture.tableId,
        },
      }),
    ).rejects.toThrow(/BASE_NOT_FOUND/);

    await expect(
      test.query(internal.aiReads.read, {
        organizationId: "org_ai_read",
        userId: "user_ai_read",
        sessionId: "session-ai-read",
        operation: "describe_table",
        input: {
          baseId:
            "Active base: Product operations; secure reference: not-an-id",
          tableId:
            "Active table: Product roadmap; secure reference: not-an-id",
        },
      }),
    ).rejects.toThrow(/BASE_NOT_FOUND/);
  });

  it("rejects stale record update, record delete, and form-setting proposals", async () => {
    const test = setup();
    const organizationId = "org_ai_stale";
    const userId = "user_ai_stale";
    const sessionId = "session-ai-stale";
    const fixture = await insertFixture(test, organizationId, userId);
    await registerSession(test, organizationId, userId, sessionId);

    await expect(
      test.mutation(
        internal.aiWrites.apply,
        writeArgs(
          organizationId,
          userId,
          sessionId,
          "update_record",
          {
            baseId: fixture.baseId,
            tableId: fixture.tableId,
            recordId: fixture.recordId,
            expectedVersion: 2,
            changes: [
              {
                fieldId: fixture.notesFieldId,
                fieldName: "Notes",
                before: "Original note",
                after: "Changed note",
              },
            ],
          },
        ),
      ),
    ).rejects.toThrow(/STALE_WRITE/);

    await expect(
      test.mutation(
        internal.aiWrites.apply,
        writeArgs(
          organizationId,
          userId,
          sessionId,
          "delete_record",
          {
            baseId: fixture.baseId,
            tableId: fixture.tableId,
            recordId: fixture.recordId,
            expectedVersion: 2,
            expectedPrimaryValue: "Atlas launch",
            deletionSummary: ["Deletes Atlas launch."],
          },
          { idempotencyKey: "stale-delete-record" },
        ),
      ),
    ).rejects.toThrow(/STALE_WRITE/);

    await expect(
      test.mutation(
        internal.aiWrites.apply,
        writeArgs(
          organizationId,
          userId,
          sessionId,
          "update_form_settings",
          {
            baseId: fixture.baseId,
            formId: fixture.formId,
            expectedVersion: 3,
            changes: [
              {
                property: "title",
                before: "Launch intake",
                after: "Launch request",
              },
            ],
          },
          { idempotencyKey: "stale-form-settings" },
        ),
      ),
    ).rejects.toThrow(/STALE_WRITE/);

    await expect(
      test.mutation(
        internal.aiWrites.apply,
        writeArgs(
          organizationId,
          userId,
          sessionId,
          "update_form_settings",
          {
            baseId: fixture.baseId,
            formId: fixture.formId,
            expectedVersion: 4,
            changes: [
              {
                property: "title",
                before: "Launch intake",
                after: "Launch request",
              },
            ],
          },
          { idempotencyKey: "approved-form-settings" },
        ),
      ),
    ).resolves.toMatchObject({ status: "applied" });

    const state = await test.run(async (ctx) => ({
      record: await ctx.db.get(fixture.recordId),
      form: await ctx.db.get(fixture.formId),
    }));
    expect(state.record).toMatchObject({
      revision: 3,
      status: "active",
    });
    expect(state.record?.values[fixture.notesFieldId]).toBe("Original note");
    expect(state.form).toMatchObject({
      draftRevision: 5,
      title: "Launch request",
    });
  });

  it("replays an identical write once, rejects a payload conflict, and isolates organizations", async () => {
    const test = setup();
    const organizationId = "org_ai_idempotency";
    const userId = "user_ai_idempotency";
    const sessionId = "session-ai-idempotency";
    const fixture = await insertFixture(test, organizationId, userId);
    await registerSession(test, organizationId, userId, sessionId);
    await registerSession(
      test,
      "org_ai_intruder",
      "user_ai_intruder",
      "session-ai-intruder",
    );
    const input = {
      baseId: fixture.baseId,
      tableId: fixture.tableId,
      recordId: fixture.recordId,
      expectedVersion: 3,
      changes: [
        {
          fieldId: fixture.notesFieldId,
          fieldName: "Notes",
          before: "Original note",
          after: "Approved note",
        },
      ],
    };
    const args = writeArgs(
      organizationId,
      userId,
      sessionId,
      "update_record",
      input,
      { idempotencyKey: "same-approved-command" },
    );

    await expect(
      test.mutation(internal.aiWrites.apply, args),
    ).resolves.toMatchObject({ status: "applied" });
    await expect(
      test.mutation(internal.aiWrites.apply, args),
    ).resolves.toMatchObject({ status: "replayed" });
    await expect(
      test.mutation(internal.aiWrites.apply, {
        ...args,
        payloadHash: "b".repeat(64),
      }),
    ).rejects.toThrow(/IDEMPOTENCY_CONFLICT/);
    await expect(
      test.mutation(
        internal.aiWrites.apply,
        writeArgs(
          "org_ai_intruder",
          "user_ai_intruder",
          "session-ai-intruder",
          "update_record",
          input,
          { idempotencyKey: "intruder-command" },
        ),
      ),
    ).rejects.toThrow(/BASE_NOT_FOUND/);

    const persisted = await test.run(async (ctx) => ({
      record: await ctx.db.get(fixture.recordId),
      receipts: await ctx.db.query("aiCommandReceipts").collect(),
      audits: (
        await ctx.db
          .query("auditEvents")
          .withIndex("by_resource", (q) =>
            q
              .eq("orgId", organizationId)
              .eq("resourceType", "record")
              .eq("resourceId", fixture.recordId),
          )
          .collect()
      ).filter((event) => event.action === "record.updated"),
    }));
    expect(persisted.record).toMatchObject({ revision: 4 });
    expect(persisted.record?.values[fixture.notesFieldId]).toBe(
      "Approved note",
    );
    expect(persisted.receipts).toHaveLength(1);
    expect(persisted.audits).toHaveLength(1);
  });
});
