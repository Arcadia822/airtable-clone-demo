/// <reference types="vite/client" />

import aggregateTest from "@convex-dev/aggregate/test";
import { convexTest } from "convex-test";
import type { UserIdentity } from "convex/server";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { recordCount, tableRecordCount } from "./lib/aggregates";
import { createRank } from "./lib/data";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const orgId = "org_recordsTest123456";
const otherOrgId = "org_recordsOther123456";
const memberIdentity = {
  subject: "user_recordsMember123456",
  tokenIdentifier: "test|user_recordsMember123456",
  org_id: orgId,
  org_role: "org:member",
  pla: "o:pro",
} satisfies Partial<UserIdentity> & Record<string, unknown>;

function setup() {
  const test = convexTest(schema, modules);
  aggregateTest.register(test, "recordCount");
  aggregateTest.register(test, "tableRecordCount");
  return test;
}

async function insertTableFixture(
  test: ReturnType<typeof setup>,
  fixtureOrgId = orgId,
) {
  return await test.run(async (ctx) => {
    const now = Date.now();
    const baseId = await ctx.db.insert("bases", {
      orgId: fixtureOrgId,
      name: "Project tracker",
      rank: createRank(),
      status: "active",
      createdByUserId: memberIdentity.subject,
      updatedAt: now,
    });
    const tableId = await ctx.db.insert("tables", {
      orgId: fixtureOrgId,
      baseId,
      name: "Projects",
      rank: createRank(),
      status: "active",
      createdByUserId: memberIdentity.subject,
      updatedAt: now,
    });
    const nameFieldId = await ctx.db.insert("fields", {
      orgId: fixtureOrgId,
      baseId,
      tableId,
      name: "Name",
      type: "singleLineText",
      config: { maxLength: 10_000 },
      rank: createRank(),
      width: 240,
      isPrimary: true,
      status: "active",
      revision: 1,
      createdByUserId: memberIdentity.subject,
      updatedAt: now,
    });
    const notesFieldId = await ctx.db.insert("fields", {
      orgId: fixtureOrgId,
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
      createdByUserId: memberIdentity.subject,
      updatedAt: now,
    });
    await ctx.db.patch(tableId, { primaryFieldId: nameFieldId });
    return { baseId, tableId, nameFieldId, notesFieldId };
  });
}

async function createRecord(
  member: ReturnType<ReturnType<typeof setup>["withIdentity"]>,
  tableId: Id<"tables">,
  nameFieldId: Id<"fields">,
  name: string,
) {
  return await member.mutation(api.records.create, {
    tableId,
    values: { [nameFieldId]: name },
  });
}

describe("records.batchUpdateCells", () => {
  it("updates many cells atomically for members and replays idempotently", async () => {
    const test = setup();
    const fixture = await insertTableFixture(test);
    const member = test.withIdentity(memberIdentity);
    const firstRecordId = await createRecord(
      member,
      fixture.tableId,
      fixture.nameFieldId,
      "Alpha",
    );
    const secondRecordId = await createRecord(
      member,
      fixture.tableId,
      fixture.nameFieldId,
      "Beta",
    );
    const args = {
      tableId: fixture.tableId,
      operations: [
        {
          recordId: firstRecordId,
          fieldId: fixture.nameFieldId,
          value: "Alpha launch",
          expectedRevision: 1,
        },
        {
          recordId: firstRecordId,
          fieldId: fixture.notesFieldId,
          value: "Ready for review",
          expectedRevision: 1,
        },
        {
          recordId: secondRecordId,
          fieldId: fixture.notesFieldId,
          value: "Waiting on legal",
          expectedRevision: 1,
        },
      ],
      idempotencyKey: "paste-01",
    };

    const applied = await member.mutation(
      api.records.batchUpdateCells,
      args,
    );
    expect(applied).toMatchObject({
      appliedCount: 3,
      deduplicated: false,
    });
    expect(applied.revisions).toEqual([
      { recordId: firstRecordId, revision: 2 },
      { recordId: secondRecordId, revision: 2 },
    ]);

    const afterApply = await test.run(async (ctx) => ({
      first: await ctx.db.get(firstRecordId),
      second: await ctx.db.get(secondRecordId),
      receipts: await ctx.db.query("recordMutationReceipts").take(10),
      audits: (await ctx.db.query("auditEvents").take(100)).filter(
        (event) => event.action === "record.cells_updated",
      ),
    }));
    expect(afterApply.first).toMatchObject({
      revision: 2,
      values: {
        [fixture.nameFieldId]: "Alpha launch",
        [fixture.notesFieldId]: "Ready for review",
      },
    });
    expect(afterApply.second).toMatchObject({
      revision: 2,
      values: {
        [fixture.nameFieldId]: "Beta",
        [fixture.notesFieldId]: "Waiting on legal",
      },
    });
    expect(afterApply.receipts).toHaveLength(1);
    expect(afterApply.audits).toHaveLength(2);

    const replayed = await member.mutation(
      api.records.batchUpdateCells,
      args,
    );
    expect(replayed).toEqual({ ...applied, deduplicated: true });
    const afterReplay = await test.run(async (ctx) => ({
      first: await ctx.db.get(firstRecordId),
      audits: (await ctx.db.query("auditEvents").take(100)).filter(
        (event) => event.action === "record.cells_updated",
      ),
      receipts: await ctx.db.query("recordMutationReceipts").take(10),
    }));
    expect(afterReplay.first?.revision).toBe(2);
    expect(afterReplay.audits).toHaveLength(2);
    expect(afterReplay.receipts).toHaveLength(1);

    await expect(
      member.mutation(api.records.batchUpdateCells, {
        ...args,
        operations: [
          {
            ...args.operations[0],
            value: "Different payload",
          },
        ],
      }),
    ).rejects.toThrow();
  });

  it("rejects stale or cross-organization rows without partial writes", async () => {
    const test = setup();
    const fixture = await insertTableFixture(test);
    const otherFixture = await insertTableFixture(test, otherOrgId);
    const member = test.withIdentity(memberIdentity);
    const firstRecordId = await createRecord(
      member,
      fixture.tableId,
      fixture.nameFieldId,
      "Alpha",
    );
    const secondRecordId = await createRecord(
      member,
      fixture.tableId,
      fixture.nameFieldId,
      "Beta",
    );
    const foreignRecordId = await test.run(async (ctx) => {
      return await ctx.db.insert("records", {
        orgId: otherOrgId,
        baseId: otherFixture.baseId,
        tableId: otherFixture.tableId,
        rank: createRank(),
        values: { [otherFixture.nameFieldId]: "Secret" },
        status: "active",
        revision: 1,
        createdByType: "user",
        createdById: "user_other",
        updatedByType: "user",
        updatedById: "user_other",
        updatedAt: Date.now(),
      });
    });

    await expect(
      member.mutation(api.records.batchUpdateCells, {
        tableId: fixture.tableId,
        operations: [
          {
            recordId: firstRecordId,
            fieldId: fixture.nameFieldId,
            value: "Would otherwise apply",
            expectedRevision: 1,
          },
          {
            recordId: secondRecordId,
            fieldId: fixture.nameFieldId,
            value: "Stale",
            expectedRevision: 2,
          },
        ],
        idempotencyKey: "paste-stale",
      }),
    ).rejects.toThrow();
    const afterConflict = await test.run(async (ctx) => ({
      first: await ctx.db.get(firstRecordId),
      second: await ctx.db.get(secondRecordId),
      receipts: await ctx.db.query("recordMutationReceipts").take(10),
    }));
    expect(afterConflict.first).toMatchObject({
      revision: 1,
      values: { [fixture.nameFieldId]: "Alpha" },
    });
    expect(afterConflict.second).toMatchObject({
      revision: 1,
      values: { [fixture.nameFieldId]: "Beta" },
    });
    expect(afterConflict.receipts).toHaveLength(0);

    await expect(
      member.mutation(api.records.batchUpdateCells, {
        tableId: fixture.tableId,
        operations: [
          {
            recordId: foreignRecordId,
            fieldId: fixture.nameFieldId,
            value: "Unauthorized",
            expectedRevision: 1,
          },
        ],
        idempotencyKey: "paste-foreign",
      }),
    ).rejects.toThrow();
    const foreignAfter = await test.run((ctx) =>
      ctx.db.get(foreignRecordId),
    );
    expect(foreignAfter).toMatchObject({
      revision: 1,
      values: { [otherFixture.nameFieldId]: "Secret" },
    });

    await expect(
      member.mutation(api.records.batchUpdateCells, {
        tableId: fixture.tableId,
        operations: Array.from({ length: 501 }, () => ({
          recordId: firstRecordId,
          fieldId: fixture.nameFieldId,
          value: "Too many",
          expectedRevision: 1,
        })),
        idempotencyKey: "paste-too-large",
      }),
    ).rejects.toThrow();
  });

  it("supports revision-safe undo and redo without overwriting a collaborator", async () => {
    const test = setup();
    const fixture = await insertTableFixture(test);
    const member = test.withIdentity(memberIdentity);
    const recordId = await createRecord(
      member,
      fixture.tableId,
      fixture.nameFieldId,
      "Alpha",
    );

    const edit = await member.mutation(api.records.batchUpdateCells, {
      tableId: fixture.tableId,
      operations: [
        {
          recordId,
          fieldId: fixture.nameFieldId,
          value: "Edited",
          expectedRevision: 1,
        },
      ],
      idempotencyKey: "history-edit",
    });
    expect(edit.revisions).toEqual([{ recordId, revision: 2 }]);

    const undo = await member.mutation(api.records.batchUpdateCells, {
      tableId: fixture.tableId,
      operations: [
        {
          recordId,
          fieldId: fixture.nameFieldId,
          value: "Alpha",
          expectedRevision: 2,
        },
      ],
      idempotencyKey: "history-undo",
    });
    expect(undo.revisions).toEqual([{ recordId, revision: 3 }]);

    const redo = await member.mutation(api.records.batchUpdateCells, {
      tableId: fixture.tableId,
      operations: [
        {
          recordId,
          fieldId: fixture.nameFieldId,
          value: "Edited",
          expectedRevision: 3,
        },
      ],
      idempotencyKey: "history-redo",
    });
    expect(redo.revisions).toEqual([{ recordId, revision: 4 }]);

    const collaboratorEdit = await member.mutation(
      api.records.batchUpdateCells,
      {
        tableId: fixture.tableId,
        operations: [
          {
            recordId,
            fieldId: fixture.nameFieldId,
            value: "Teammate",
            expectedRevision: 4,
          },
        ],
        idempotencyKey: "history-collaborator-edit",
      },
    );
    expect(collaboratorEdit.revisions).toEqual([
      { recordId, revision: 5 },
    ]);

    await expect(
      member.mutation(api.records.batchUpdateCells, {
        tableId: fixture.tableId,
        operations: [
          {
            recordId,
            fieldId: fixture.nameFieldId,
            value: "Alpha",
            expectedRevision: 4,
          },
        ],
        idempotencyKey: "history-stale-undo",
      }),
    ).rejects.toThrow();

    const finalState = await test.run(async (ctx) => ({
      record: await ctx.db.get(recordId),
      receipts: await ctx.db.query("recordMutationReceipts").take(10),
    }));
    expect(finalState.record).toMatchObject({
      revision: 5,
      values: { [fixture.nameFieldId]: "Teammate" },
    });
    expect(finalState.receipts).toHaveLength(4);
  });
});

describe("records.bulkRemove", () => {
  it("soft-deletes a bounded batch, updates aggregates, and replays safely", async () => {
    const test = setup();
    const fixture = await insertTableFixture(test);
    const member = test.withIdentity(memberIdentity);
    const firstRecordId = await createRecord(
      member,
      fixture.tableId,
      fixture.nameFieldId,
      "Alpha",
    );
    const secondRecordId = await createRecord(
      member,
      fixture.tableId,
      fixture.nameFieldId,
      "Beta",
    );
    const args = {
      tableId: fixture.tableId,
      records: [
        { recordId: firstRecordId, expectedRevision: 1 },
        { recordId: secondRecordId, expectedRevision: 1 },
      ],
      idempotencyKey: "delete-01",
    };

    const removed = await member.mutation(api.records.bulkRemove, args);
    expect(removed).toEqual({
      removedCount: 2,
      revisions: [
        { recordId: firstRecordId, revision: 2 },
        { recordId: secondRecordId, revision: 2 },
      ],
      deduplicated: false,
    });
    const afterRemove = await test.run(async (ctx) => ({
      first: await ctx.db.get(firstRecordId),
      second: await ctx.db.get(secondRecordId),
      orgCount: await recordCount.count(ctx, { namespace: orgId }),
      tableCount: await tableRecordCount.count(ctx, {
        namespace: fixture.tableId,
      }),
      audits: (await ctx.db.query("auditEvents").take(100)).filter(
        (event) => event.action === "record.deleted",
      ),
      receipts: await ctx.db.query("recordMutationReceipts").take(10),
    }));
    expect(afterRemove.first).toMatchObject({
      status: "deleted",
      revision: 2,
    });
    expect(afterRemove.second).toMatchObject({
      status: "deleted",
      revision: 2,
    });
    expect(afterRemove.orgCount).toBe(0);
    expect(afterRemove.tableCount).toBe(0);
    expect(afterRemove.audits).toHaveLength(2);
    expect(afterRemove.receipts).toHaveLength(1);

    const replayed = await member.mutation(api.records.bulkRemove, args);
    expect(replayed).toEqual({ ...removed, deduplicated: true });
    const afterReplay = await test.run(async (ctx) => ({
      orgCount: await recordCount.count(ctx, { namespace: orgId }),
      audits: (await ctx.db.query("auditEvents").take(100)).filter(
        (event) => event.action === "record.deleted",
      ),
      receipts: await ctx.db.query("recordMutationReceipts").take(10),
    }));
    expect(afterReplay.orgCount).toBe(0);
    expect(afterReplay.audits).toHaveLength(2);
    expect(afterReplay.receipts).toHaveLength(1);
  });

  it("does not delete any row when one expected revision is stale", async () => {
    const test = setup();
    const fixture = await insertTableFixture(test);
    const member = test.withIdentity(memberIdentity);
    const firstRecordId = await createRecord(
      member,
      fixture.tableId,
      fixture.nameFieldId,
      "Alpha",
    );
    const secondRecordId = await createRecord(
      member,
      fixture.tableId,
      fixture.nameFieldId,
      "Beta",
    );
    await member.mutation(api.records.updateCell, {
      recordId: firstRecordId,
      fieldId: fixture.nameFieldId,
      value: "Alpha v2",
    });

    await expect(
      member.mutation(api.records.bulkRemove, {
        tableId: fixture.tableId,
        records: [
          { recordId: secondRecordId, expectedRevision: 1 },
          { recordId: firstRecordId, expectedRevision: 1 },
        ],
        idempotencyKey: "delete-stale",
      }),
    ).rejects.toThrow();
    const state = await test.run(async (ctx) => ({
      first: await ctx.db.get(firstRecordId),
      second: await ctx.db.get(secondRecordId),
      orgCount: await recordCount.count(ctx, { namespace: orgId }),
      receipts: await ctx.db.query("recordMutationReceipts").take(10),
    }));
    expect(state.first).toMatchObject({ status: "active", revision: 2 });
    expect(state.second).toMatchObject({ status: "active", revision: 1 });
    expect(state.orgCount).toBe(2);
    expect(state.receipts).toHaveLength(0);
  });
});
