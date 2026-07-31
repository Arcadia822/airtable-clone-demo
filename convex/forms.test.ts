/// <reference types="vite/client" />

import aggregateTest from "@convex-dev/aggregate/test";
import { convexTest } from "convex-test";
import type { UserIdentity } from "convex/server";
import { describe, expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { createRank } from "./lib/data";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const orgId = "org_formsTest123456";
const otherOrgId = "org_formsOther123456";
const adminIdentity = {
  subject: "user_formsAdmin123456",
  tokenIdentifier: "test|user_formsAdmin123456",
  org_id: orgId,
  org_role: "org:admin",
  pla: "o:pro",
  fea: "o:custom_form_branding",
} satisfies Partial<UserIdentity> & Record<string, unknown>;
const memberIdentity = {
  ...adminIdentity,
  subject: "user_formsMember123456",
  tokenIdentifier: "test|user_formsMember123456",
  org_role: "org:member",
} satisfies Partial<UserIdentity> & Record<string, unknown>;
const otherAdminIdentity = {
  ...adminIdentity,
  subject: "user_formsOtherAdmin123456",
  tokenIdentifier: "test|user_formsOtherAdmin123456",
  org_id: otherOrgId,
} satisfies Partial<UserIdentity> & Record<string, unknown>;

function setup() {
  const test = convexTest(schema, modules);
  aggregateTest.register(test, "formCount");
  aggregateTest.register(test, "recordCount");
  aggregateTest.register(test, "tableRecordCount");
  aggregateTest.register(test, "submissionCount");
  return test;
}

async function insertFormFixture(test: ReturnType<typeof setup>) {
  return await test.run(async (ctx) => {
    const now = Date.now();
    const baseId = await ctx.db.insert("bases", {
      orgId,
      name: "Launch planning",
      rank: createRank(),
      status: "active",
      createdByUserId: adminIdentity.subject,
      updatedAt: now,
    });
    const tableId = await ctx.db.insert("tables", {
      orgId,
      baseId,
      name: "Launches",
      rank: createRank(),
      status: "active",
      createdByUserId: adminIdentity.subject,
      updatedAt: now,
    });
    const decisionFieldId = await ctx.db.insert("fields", {
      orgId,
      baseId,
      tableId,
      name: "Launch decision",
      type: "singleLineText",
      config: { maxLength: 10_000 },
      rank: createRank(),
      width: 220,
      isPrimary: true,
      status: "active",
      revision: 1,
      createdByUserId: adminIdentity.subject,
      updatedAt: now,
    });
    const detailsFieldId = await ctx.db.insert("fields", {
      orgId,
      baseId,
      tableId,
      name: "Launch details",
      type: "longText",
      config: { maxLength: 50_000 },
      rank: createRank(),
      width: 300,
      isPrimary: false,
      status: "active",
      revision: 1,
      createdByUserId: adminIdentity.subject,
      updatedAt: now,
    });
    await ctx.db.patch(tableId, { primaryFieldId: decisionFieldId });
    const formId = await ctx.db.insert("forms", {
      orgId,
      baseId,
      tableId,
      name: "Launch intake",
      slug: "launch-intake-conditional-test",
      title: "Launch intake",
      description: "Tell us what should ship.",
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
      draftRevision: 1,
      createdByUserId: adminIdentity.subject,
      updatedAt: now,
    });
    return {
      baseId,
      tableId,
      formId,
      decisionFieldId,
      detailsFieldId,
    };
  });
}

function draftFields(
  decisionFieldId: Id<"fields">,
  detailsFieldId: Id<"fields">,
  expectedDecision = "launch",
) {
  return [
    {
      targetFieldId: decisionFieldId,
      label: "Should we launch?",
      required: true,
      rank: "000000",
    },
    {
      targetFieldId: detailsFieldId,
      label: "Why should we launch?",
      required: true,
      rank: "000001",
      visibility: {
        conjunction: "and" as const,
        conditions: [
          {
            id: "decision-is-launch",
            sourceFieldId: decisionFieldId,
            operator: "is" as const,
            value: expectedDecision,
          },
        ],
      },
    },
  ];
}

async function saveFixtureDraft(
  admin: ReturnType<ReturnType<typeof setup>["withIdentity"]>,
  fixture: Awaited<ReturnType<typeof insertFormFixture>>,
  expectedRevision: number,
  expectedDecision = "launch",
) {
  return await admin.mutation(api.forms.saveDraft, {
    formId: fixture.formId,
    expectedRevision,
    name: "Launch intake",
    title: "Launch intake",
    description: "Tell us what should ship.",
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
    fields: draftFields(
      fixture.decisionFieldId,
      fixture.detailsFieldId,
      expectedDecision,
    ),
  });
}

async function insertSubmissionSession(
  test: ReturnType<typeof setup>,
  formId: Id<"forms">,
  formVersionId: Id<"formVersions">,
  proofHash: string,
) {
  return await test.run(async (ctx) => {
    return await ctx.db.insert("publicSubmissionSessions", {
      orgId,
      formId,
      formVersionId,
      planAtStart: "pro",
      proofHash,
      status: "active",
      expiresAt: Date.now() + 60_000,
      createdAt: Date.now(),
    });
  });
}

async function createConfiguredLifecycleForm(
  admin: ReturnType<ReturnType<typeof setup>["withIdentity"]>,
  fixture: Awaited<ReturnType<typeof insertFormFixture>>,
  name: string,
) {
  const formId = await admin.mutation(api.forms.create, {
    tableId: fixture.tableId,
    name,
  });
  await admin.mutation(api.forms.saveDraft, {
    formId,
    expectedRevision: 1,
    name,
    title: `${name} title`,
    description: "A carefully configured source form.",
    appearance: {
      primaryColor: "#7c3aed",
      backgroundColor: "#f5f3ff",
      submitLabel: "Send launch plan",
      showPoweredBy: false,
    },
    thankYou: {
      title: "Plan received",
      message: "The launch team will review your plan.",
      redirectUrl: "https://example.com/launches/thanks",
    },
    fields: [
      {
        targetFieldId: fixture.decisionFieldId,
        label: "Launch decision",
        description: "Choose the current decision.",
        placeholder: "Launch or wait",
        required: true,
        rank: "000000",
      },
      {
        targetFieldId: fixture.detailsFieldId,
        label: "Launch rationale",
        description: "Explain why the launch should proceed.",
        placeholder: "Share the supporting details",
        required: true,
        rank: "000001",
        visibility: {
          conjunction: "and",
          conditions: [
            {
              id: "show-details-after-launch",
              sourceFieldId: fixture.decisionFieldId,
              operator: "is",
              value: "launch",
            },
          ],
        },
      },
    ],
  });
  return formId;
}

async function insertHistoricalSubmission(
  test: ReturnType<typeof setup>,
  args: {
    fixture: Awaited<ReturnType<typeof insertFormFixture>>;
    formId: Id<"forms">;
    formVersionId: Id<"formVersions">;
    idempotencyKey: string;
  },
) {
  return await test.run(async (ctx) => {
    const now = Date.now();
    const recordId = await ctx.db.insert("records", {
      orgId,
      baseId: args.fixture.baseId,
      tableId: args.fixture.tableId,
      rank: createRank(),
      values: {
        [args.fixture.decisionFieldId]: "launch",
        [args.fixture.detailsFieldId]: "Historical response",
      },
      status: "active",
      revision: 1,
      createdByType: "public_form",
      createdById: args.formId,
      updatedByType: "public_form",
      updatedById: args.formId,
      updatedAt: now,
    });
    const submissionId = await ctx.db.insert("formSubmissions", {
      orgId,
      formId: args.formId,
      formVersionId: args.formVersionId,
      recordId,
      idempotencyKey: args.idempotencyKey,
      submittedMonth: "2026-07",
      submittedAt: now,
    });
    return { recordId, submissionId };
  });
}

function comparableDraftFields(
  fields: Doc<"formDraftFields">[],
) {
  return fields.map((field) => ({
    targetFieldId: field.targetFieldId,
    label: field.label,
    description: field.description,
    placeholder: field.placeholder,
    required: field.required,
    rank: field.rank,
    mode: field.mode,
    fixedValue: field.fixedValue,
    prefillParameter: field.prefillParameter,
    visibility: field.visibility,
  }));
}

describe("form conditional logic", () => {
  it("snapshots friendly draft rules into immutable published questions", async () => {
    const test = setup();
    const fixture = await insertFormFixture(test);
    const admin = test.withIdentity(adminIdentity);

    const saved = await saveFixtureDraft(admin, fixture, 1);
    const published = await admin.mutation(api.forms.publish, {
      formId: fixture.formId,
    });

    const firstSnapshot = await test.run(async (ctx) => {
      const drafts = await ctx.db
        .query("formDraftFields")
        .withIndex("by_form_and_rank", (q) =>
          q.eq("formId", fixture.formId),
        )
        .collect();
      const versionFields = await ctx.db
        .query("formVersionFields")
        .withIndex("by_version_and_rank", (q) =>
          q.eq("formVersionId", published.formVersionId),
        )
        .collect();
      return { drafts, versionFields };
    });
    const publishedDecision = firstSnapshot.versionFields[0]!;
    const publishedDetails = firstSnapshot.versionFields[1]!;

    expect(firstSnapshot.drafts[1]?.visibility).toMatchObject({
      conjunction: "and",
      conditions: [
        {
          sourceFieldId: fixture.decisionFieldId,
          operator: "is",
          value: "launch",
        },
      ],
    });
    expect(publishedDetails.visibility).toMatchObject({
      conjunction: "and",
      conditions: [
        {
          sourceQuestionId: publishedDecision._id,
          sourceFieldId: fixture.decisionFieldId,
          operator: "is",
          value: "launch",
        },
      ],
    });

    await saveFixtureDraft(
      admin,
      fixture,
      saved.draftRevision,
      "later",
    );
    const immutablePublishedDetails = await test.run(async (ctx) =>
      ctx.db.get(publishedDetails._id),
    );
    expect(
      immutablePublishedDetails?.visibility?.conditions[0]?.value,
    ).toBe("launch");

    const publicForm = await test.query(internal.forms.getPublic, {
      slug: "launch-intake-conditional-test",
    });
    expect(publicForm?.fields[1]?.visibility?.conditions[0]).toMatchObject({
      sourceQuestionId: publishedDecision._id,
      value: "launch",
    });
  });

  it("ignores hidden answers and only requires visible questions", async () => {
    const test = setup();
    const fixture = await insertFormFixture(test);
    const admin = test.withIdentity(adminIdentity);
    await saveFixtureDraft(admin, fixture, 1);
    const published = await admin.mutation(api.forms.publish, {
      formId: fixture.formId,
    });
    const versionFields = await test.run(async (ctx) =>
      ctx.db
        .query("formVersionFields")
        .withIndex("by_version_and_rank", (q) =>
          q.eq("formVersionId", published.formVersionId),
        )
        .collect(),
    );
    const decisionQuestion = versionFields[0]!;
    const detailsQuestion = versionFields[1]!;
    const hiddenProof = "a".repeat(64);
    const hiddenSessionId = await insertSubmissionSession(
      test,
      fixture.formId,
      published.formVersionId,
      hiddenProof,
    );

    const submitted = await test.mutation(internal.forms.commitSubmission, {
      slug: "launch-intake-conditional-test",
      formVersionId: published.formVersionId,
      submissionSessionId: hiddenSessionId,
      proofHash: hiddenProof,
      idempotencyKey: "conditional-hidden-answer",
      plan: "pro",
      answers: [
        {
          formVersionFieldId: decisionQuestion._id,
          value: "later",
        },
        {
          formVersionFieldId: detailsQuestion._id,
          value: "A stale answer that must be ignored",
        },
      ],
    });
    const record = await test.run(async (ctx) =>
      ctx.db.get(submitted.recordId),
    );
    expect(record?.values).toEqual({
      [fixture.decisionFieldId]: "later",
    });

    const visibleProof = "b".repeat(64);
    const visibleSessionId = await insertSubmissionSession(
      test,
      fixture.formId,
      published.formVersionId,
      visibleProof,
    );
    await expect(
      test.mutation(internal.forms.commitSubmission, {
        slug: "launch-intake-conditional-test",
        formVersionId: published.formVersionId,
        submissionSessionId: visibleSessionId,
        proofHash: visibleProof,
        idempotencyKey: "conditional-visible-required",
        plan: "pro",
        answers: [
          {
            formVersionFieldId: decisionQuestion._id,
            value: "launch",
          },
        ],
      }),
    ).rejects.toThrow(/REQUIRED_FORM_ANSWER_MISSING/);
  });
});

describe("hidden values and link prefills", () => {
  it("validates friendly settings, freezes publication, and overrides browser values", async () => {
    const test = setup();
    const fixture = await insertFormFixture(test);
    const admin = test.withIdentity(adminIdentity);
    const otherAdmin = test.withIdentity(otherAdminIdentity);
    const baseDraft = {
      formId: fixture.formId,
      expectedRevision: 1,
      name: "Launch intake",
      title: "Launch intake",
      description: "Tell us what should ship.",
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
    };

    await expect(
      admin.mutation(api.forms.saveDraft, {
        ...baseDraft,
        fields: [
          {
            targetFieldId: fixture.decisionFieldId,
            label: "Lead source",
            required: true,
            rank: "000000",
            mode: "hidden",
            fixedValue: "   ",
          },
        ],
      }),
    ).rejects.toThrow(/INVALID_HIDDEN_FORM_VALUE/);

    await expect(
      admin.mutation(api.forms.saveDraft, {
        ...baseDraft,
        fields: [
          {
            targetFieldId: fixture.decisionFieldId,
            label: "Lead source",
            required: true,
            rank: "000000",
            mode: "hidden",
            fixedValue: 42,
          },
        ],
      }),
    ).rejects.toThrow(/INVALID_CELL_VALUE/);

    await expect(
      admin.mutation(api.forms.saveDraft, {
        ...baseDraft,
        fields: [
          {
            targetFieldId: fixture.decisionFieldId,
            label: "Launch decision",
            required: true,
            rank: "000000",
            mode: "visible",
            prefillParameter: "campaign",
          },
          {
            targetFieldId: fixture.detailsFieldId,
            label: "Launch details",
            required: false,
            rank: "000001",
            mode: "visible",
            prefillParameter: "campaign",
          },
        ],
      }),
    ).rejects.toThrow(/INVALID_FORM_PREFILL_PARAMETER/);

    await expect(
      admin.mutation(api.forms.saveDraft, {
        ...baseDraft,
        fields: [
          {
            targetFieldId: fixture.decisionFieldId,
            label: "Launch decision",
            required: true,
            rank: "000000",
            mode: "visible",
            prefillParameter: "token",
          },
        ],
      }),
    ).rejects.toThrow(/INVALID_FORM_PREFILL_PARAMETER/);

    await expect(
      otherAdmin.mutation(api.forms.saveDraft, {
        ...baseDraft,
        fields: [
          {
            targetFieldId: fixture.decisionFieldId,
            label: "Lead source",
            required: true,
            rank: "000000",
            mode: "hidden",
            fixedValue: "Partner webinar",
          },
        ],
      }),
    ).rejects.toThrow();

    const saved = await admin.mutation(api.forms.saveDraft, {
      ...baseDraft,
      fields: [
        {
          targetFieldId: fixture.decisionFieldId,
          label: "Lead source",
          required: true,
          rank: "000000",
          mode: "hidden",
          fixedValue: "Partner webinar",
        },
        {
          targetFieldId: fixture.detailsFieldId,
          label: "Launch details",
          required: true,
          rank: "000001",
          mode: "visible",
          prefillParameter: "request_details",
        },
      ],
    });
    const published = await admin.mutation(api.forms.publish, {
      formId: fixture.formId,
    });
    const firstPublic = await test.query(internal.forms.getPublic, {
      slug: "launch-intake-conditional-test",
    });
    expect(firstPublic?.fields).toMatchObject([
      {
        label: "Lead source",
        mode: "hidden",
        fixedValue: "Partner webinar",
      },
      {
        label: "Launch details",
        mode: "visible",
        prefillParameter: "request_details",
      },
    ]);

    await admin.mutation(api.forms.saveDraft, {
      ...baseDraft,
      expectedRevision: saved.draftRevision,
      fields: [
        {
          targetFieldId: fixture.decisionFieldId,
          label: "Lead source",
          required: true,
          rank: "000000",
          mode: "hidden",
          fixedValue: "Changed after publication",
        },
        {
          targetFieldId: fixture.detailsFieldId,
          label: "Launch details",
          required: true,
          rank: "000001",
          mode: "visible",
          prefillParameter: "new_details",
        },
      ],
    });
    const immutablePublic = await test.query(internal.forms.getPublic, {
      slug: "launch-intake-conditional-test",
    });
    expect(immutablePublic?.fields[0]?.fixedValue).toBe(
      "Partner webinar",
    );
    expect(immutablePublic?.fields[1]?.prefillParameter).toBe(
      "request_details",
    );

    const versionFields = await test.run(async (ctx) =>
      ctx.db
        .query("formVersionFields")
        .withIndex("by_version_and_rank", (q) =>
          q.eq("formVersionId", published.formVersionId),
        )
        .collect(),
    );
    const proof = "f".repeat(64);
    const sessionId = await insertSubmissionSession(
      test,
      fixture.formId,
      published.formVersionId,
      proof,
    );
    const result = await test.mutation(internal.forms.commitSubmission, {
      slug: "launch-intake-conditional-test",
      formVersionId: published.formVersionId,
      submissionSessionId: sessionId,
      proofHash: proof,
      idempotencyKey: "hidden-fixed-value",
      plan: "pro",
      answers: [
        {
          formVersionFieldId: versionFields[0]!._id,
          value: "Malicious browser override",
        },
        {
          formVersionFieldId: versionFields[1]!._id,
          value: "Visitor response",
        },
      ],
    });
    const record = await test.run(async (ctx) =>
      ctx.db.get(result.recordId),
    );
    expect(record?.values).toEqual({
      [fixture.decisionFieldId]: "Partner webinar",
      [fixture.detailsFieldId]: "Visitor response",
    });
    const submission = await test.run(async (ctx) =>
      ctx.db.get(result.submissionId),
    );
    expect(submission?.answersSnapshot).toEqual([
      {
        formVersionFieldId: versionFields[0]!._id,
        value: "Partner webinar",
      },
      {
        formVersionFieldId: versionFields[1]!._id,
        value: "Visitor response",
      },
    ]);
    const stats = await test.run(async (ctx) =>
      ctx.db
        .query("formStats")
        .withIndex("by_form", (q) => q.eq("formId", fixture.formId))
        .unique(),
    );
    expect(stats).toMatchObject({
      orgId,
      formId: fixture.formId,
      submissions: 1,
    });
  });
});

describe("form appearance assets", () => {
  it("keeps image references internal and freezes the published design", async () => {
    const test = setup();
    const fixture = await insertFormFixture(test);
    const admin = test.withIdentity(adminIdentity);
    const otherAdmin = test.withIdentity(otherAdminIdentity);
    const saved = await admin.mutation(api.forms.saveDraft, {
      formId: fixture.formId,
      expectedRevision: 1,
      name: "Launch intake",
      title: "Launch intake",
      description: "Tell us what should ship.",
      appearance: {
        primaryColor: "#7c3aed",
        backgroundColor: "#faf5ff",
        submitLabel: "Send plan",
        showPoweredBy: false,
        layout: "plain",
      },
      thankYou: {
        title: "Thank you",
        message: "Your response was saved.",
      },
      fields: draftFields(
        fixture.decisionFieldId,
        fixture.detailsFieldId,
      ),
    });
    const [logoStorageId, textStorageId] = await test.run(
      async (ctx) =>
        await Promise.all([
          ctx.storage.store(
            new Blob(["logo"], { type: "image/png" }),
          ),
          ctx.storage.store(
            new Blob(["not an image"], { type: "text/plain" }),
          ),
        ]),
    );

    await expect(
      admin.mutation(api.forms.setAppearanceAsset, {
        formId: fixture.formId,
        expectedRevision: saved.draftRevision,
        kind: "cover",
        storageId: textStorageId,
      }),
    ).rejects.toThrow(/INVALID_FORM_APPEARANCE_IMAGE/);
    const assetRevision = await test.run(async (ctx) => {
      const form = await ctx.db.get(fixture.formId);
      await ctx.db.patch(fixture.formId, {
        appearance: {
          ...form!.appearance,
          logoStorageId,
        },
        draftRevision: saved.draftRevision + 1,
      });
      return saved.draftRevision + 1;
    });

    const draft = await admin.query(api.forms.getDraft, {
      formId: fixture.formId,
    });
    expect(draft.form.appearance).toMatchObject({
      layout: "plain",
      logoUrl: expect.any(String),
      logoFingerprint: expect.any(String),
    });
    expect(JSON.stringify(draft)).not.toContain(logoStorageId);

    const published = await admin.mutation(api.forms.publish, {
      formId: fixture.formId,
    });
    const removedRevision = await test.run(async (ctx) => {
      const form = await ctx.db.get(fixture.formId);
      await ctx.db.patch(fixture.formId, {
        appearance: {
          ...form!.appearance,
          logoStorageId: undefined,
        },
        draftRevision: assetRevision + 1,
      });
      return assetRevision + 1;
    });
    const immutablePublic = await test.query(
      internal.forms.getPublic,
      { slug: "launch-intake-conditional-test" },
    );
    expect(immutablePublic).toMatchObject({
      formVersionId: published.formVersionId,
      appearance: {
        layout: "plain",
        logoUrl: expect.any(String),
      },
    });
    expect(
      (
        await admin.query(api.forms.getDraft, {
          formId: fixture.formId,
        })
      ).form.appearance.logoUrl,
    ).toBeNull();
    await expect(
      otherAdmin.mutation(api.forms.setAppearanceAsset, {
        formId: fixture.formId,
        expectedRevision: removedRevision,
        kind: "logo",
        storageId: logoStorageId,
      }),
    ).rejects.toThrow();
  });
});

describe("form response history", () => {
  it("lists, opens, and exports named responses inside the organization", async () => {
    const test = setup();
    const fixture = await insertFormFixture(test);
    const admin = test.withIdentity(adminIdentity);
    const member = test.withIdentity(memberIdentity);
    const otherAdmin = test.withIdentity(otherAdminIdentity);
    const formId = await createConfiguredLifecycleForm(
      admin,
      fixture,
      "Campaign requests",
    );
    const published = await admin.mutation(api.forms.publish, { formId });
    const historical = await insertHistoricalSubmission(test, {
      fixture,
      formId,
      formVersionId: published.formVersionId,
      idempotencyKey: "history-list-test",
    });

    await expect(
      member.query(api.forms.getSubmissionWorkspace, { formId }),
    ).resolves.toMatchObject({
      formName: "Campaign requests",
      baseName: "Launch planning",
      tableName: "Launches",
    });
    const page = await member.query(api.forms.listSubmissions, {
      formId,
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(page.page).toEqual([
      expect.objectContaining({
        submissionId: historical.submissionId,
        recordId: historical.recordId,
        responseLabel: "launch",
        version: 1,
        recordStatus: "active",
      }),
    ]);

    const detail = await member.query(api.forms.getSubmission, {
      formId,
      submissionId: historical.submissionId,
    });
    expect(detail).toMatchObject({
      responseLabel: "launch",
      recordId: historical.recordId,
      tableName: "Launches",
      answers: [
        {
          question: "Launch decision",
          displayValue: "launch",
          hasAnswer: true,
          automatic: false,
        },
        {
          question: "Launch rationale",
          displayValue: "Historical response",
          hasAnswer: true,
          automatic: false,
        },
      ],
    });

    const exported = await member.query(api.forms.exportSubmissions, {
      formId,
    });
    expect(exported).toEqual({
      formName: "Campaign requests",
      columns: ["Launch decision", "Launch rationale"],
      rows: [
        expect.objectContaining({
          responseLabel: "launch",
          version: 1,
          answers: ["launch", "Historical response"],
        }),
      ],
      truncated: false,
    });

    await expect(
      otherAdmin.query(api.forms.listSubmissions, {
        formId,
        paginationOpts: { cursor: null, numItems: 10 },
      }),
    ).rejects.toThrow();
    await expect(
      otherAdmin.query(api.forms.getSubmission, {
        formId,
        submissionId: historical.submissionId,
      }),
    ).rejects.toThrow();
    await expect(
      otherAdmin.query(api.forms.exportSubmissions, { formId }),
    ).rejects.toThrow();
  });
});

describe("form lifecycle", () => {
  it("backfills every legacy public link with a readable canonical link and a working alias", async () => {
    const test = setup();
    const fixture = await insertFormFixture(test);
    const admin = test.withIdentity(adminIdentity);
    const secondFormId = await admin.mutation(api.forms.create, {
      tableId: fixture.tableId,
      name: "Customer feedback",
    });
    const firstLegacySlug =
      "form-550e8400-e29b-41d4-a716-446655440000";
    const secondLegacySlug = "customer-feedback-a1b2c3";

    await test.run(async (ctx) => {
      await ctx.db.patch(fixture.formId, { slug: firstLegacySlug });
      await ctx.db.patch(secondFormId, { slug: secondLegacySlug });
    });

    await test.mutation(internal.migrations.backfillFriendlyFormSlugs, {
      cursor: null,
      dryRun: false,
      oneBatchOnly: true,
    });

    const migrated = await test.run(async (ctx) => {
      const [first, second, aliases] = await Promise.all([
        ctx.db.get(fixture.formId),
        ctx.db.get(secondFormId),
        ctx.db.query("formSlugAliases").take(10),
      ]);
      return { first, second, aliases };
    });
    expect(migrated.first?.slug).toBe("launch-intake");
    expect(migrated.second?.slug).toBe("customer-feedback");
    expect(migrated.aliases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: firstLegacySlug,
          formId: fixture.formId,
        }),
        expect.objectContaining({
          slug: secondLegacySlug,
          formId: secondFormId,
        }),
      ]),
    );
    await test.mutation(internal.migrations.backfillFriendlyFormSlugs, {
      reset: true,
      cursor: null,
      dryRun: false,
      oneBatchOnly: true,
    });
    const aliasesAfterReset = await test.run(async (ctx) =>
      ctx.db.query("formSlugAliases").take(10),
    );
    expect(aliasesAfterReset).toHaveLength(2);
  });

  it("creates readable globally unique public links without exposing internal keys", async () => {
    const test = setup();
    const fixture = await insertFormFixture(test);
    const admin = test.withIdentity(adminIdentity);

    const firstFormId = await admin.mutation(api.forms.create, {
      tableId: fixture.tableId,
      name: "Customer feedback",
    });
    const secondFormId = await admin.mutation(api.forms.create, {
      tableId: fixture.tableId,
      name: "Customer feedback",
    });
    const [first, second] = await test.run(async (ctx) => {
      return await Promise.all([
        ctx.db.get(firstFormId),
        ctx.db.get(secondFormId),
      ]);
    });

    expect(first?.slug).toBe("customer-feedback");
    expect(second?.slug).toBe("customer-feedback-2");
    expect(second?.slug).not.toBe(first?.slug);
    for (const form of [first, second]) {
      expect(form).not.toBeNull();
      expect(form?.slug).not.toContain(String(form?._id));
      expect(form?.slug).not.toContain(String(form?.baseId));
      expect(form?.slug).not.toContain(String(form?.tableId));
      expect(form?.slug).not.toMatch(/^form-[0-9a-f-]{36}$/);
    }
  });

  it("lists organization-scoped lifetime activity for readable form overviews", async () => {
    const test = setup();
    const fixture = await insertFormFixture(test);
    const member = test.withIdentity(memberIdentity);
    const otherAdmin = test.withIdentity(otherAdminIdentity);
    await test.run(async (ctx) => {
      await ctx.db.insert("formStats", {
        orgId,
        formId: fixture.formId,
        views: 40,
        submissions: 10,
        updatedAt: Date.now(),
      });
    });

    const forms = await member.query(api.forms.list, {
      baseId: fixture.baseId,
    });
    expect(forms).toEqual([
      expect.objectContaining({
        name: "Launch intake",
        stats: {
          views: 40,
          submissions: 10,
          conversionRate: 0.25,
        },
      }),
    ]);
    await expect(
      otherAdmin.query(api.forms.list, {
        baseId: fixture.baseId,
      }),
    ).rejects.toThrow();
  });

  it("duplicates editable form content without published identity or submissions", async () => {
    const test = setup();
    const fixture = await insertFormFixture(test);
    const admin = test.withIdentity(adminIdentity);
    const member = test.withIdentity(memberIdentity);
    const otherAdmin = test.withIdentity(otherAdminIdentity);
    const sourceFormId = await createConfiguredLifecycleForm(
      admin,
      fixture,
      "Partner launch intake",
    );
    const published = await admin.mutation(api.forms.publish, {
      formId: sourceFormId,
    });
    const submission = await insertHistoricalSubmission(test, {
      fixture,
      formId: sourceFormId,
      formVersionId: published.formVersionId,
      idempotencyKey: "source-submission",
    });

    await expect(
      member.mutation(api.forms.duplicate, { formId: sourceFormId }),
    ).rejects.toThrow();
    await expect(
      otherAdmin.mutation(api.forms.duplicate, {
        formId: sourceFormId,
      }),
    ).rejects.toThrow();

    const duplicated = await admin.mutation(api.forms.duplicate, {
      formId: sourceFormId,
    });
    expect(duplicated.name).toBe("Partner launch intake copy");

    const state = await test.run(async (ctx) => {
      const source = await ctx.db.get(sourceFormId);
      const copy = await ctx.db.get(duplicated.formId);
      const sourceFields = await ctx.db
        .query("formDraftFields")
        .withIndex("by_form_and_rank", (q) =>
          q.eq("formId", sourceFormId),
        )
        .take(10);
      const copiedFields = await ctx.db
        .query("formDraftFields")
        .withIndex("by_form_and_rank", (q) =>
          q.eq("formId", duplicated.formId),
        )
        .take(10);
      const copiedVersions = await ctx.db
        .query("formVersions")
        .withIndex("by_form_and_version", (q) =>
          q.eq("formId", duplicated.formId),
        )
        .take(10);
      const copiedSubmissions = await ctx.db
        .query("formSubmissions")
        .withIndex("by_form_and_submitted_at", (q) =>
          q.eq("formId", duplicated.formId),
        )
        .take(10);
      const sourceSubmission = await ctx.db.get(submission.submissionId);
      return {
        source,
        copy,
        sourceFields,
        copiedFields,
        copiedVersions,
        copiedSubmissions,
        sourceSubmission,
      };
    });

    expect(state.copy).toMatchObject({
      orgId,
      baseId: fixture.baseId,
      tableId: fixture.tableId,
      name: "Partner launch intake copy",
      title: "Partner launch intake title",
      description: "A carefully configured source form.",
      rank: expect.any(String),
      status: "draft",
      appearance: state.source?.appearance,
      thankYou: state.source?.thankYou,
      allowMultipleSubmissions: true,
      draftRevision: 1,
      createdByUserId: adminIdentity.subject,
    });
    expect(state.copy?.slug).not.toBe(state.source?.slug);
    expect(state.copy?.currentPublishedVersionId).toBeUndefined();
    expect(state.copy?.publishedAt).toBeUndefined();
    expect(state.copy?.deletedAt).toBeUndefined();
    expect(comparableDraftFields(state.copiedFields)).toEqual(
      comparableDraftFields(state.sourceFields),
    );
    expect(
      state.copiedFields[1]?.visibility?.conditions[0],
    ).toMatchObject({
      sourceFieldId: fixture.decisionFieldId,
      operator: "is",
      value: "launch",
    });
    expect(state.copiedVersions).toEqual([]);
    expect(state.copiedSubmissions).toEqual([]);
    expect(state.sourceSubmission).not.toBeNull();
  });

  it("archives forms reversibly and restores published history in a closed state", async () => {
    const test = setup();
    const fixture = await insertFormFixture(test);
    const admin = test.withIdentity(adminIdentity);
    const member = test.withIdentity(memberIdentity);
    const otherAdmin = test.withIdentity(otherAdminIdentity);
    const publishedFormId = await createConfiguredLifecycleForm(
      admin,
      fixture,
      "Published launch form",
    );
    const published = await admin.mutation(api.forms.publish, {
      formId: publishedFormId,
    });
    const historical = await insertHistoricalSubmission(test, {
      fixture,
      formId: publishedFormId,
      formVersionId: published.formVersionId,
      idempotencyKey: "archived-form-history",
    });

    await expect(
      member.mutation(api.forms.archive, {
        formId: publishedFormId,
      }),
    ).rejects.toThrow();
    await expect(
      otherAdmin.mutation(api.forms.archive, {
        formId: publishedFormId,
      }),
    ).rejects.toThrow();
    await admin.mutation(api.forms.archive, {
      formId: publishedFormId,
    });

    const archived = await test.run(async (ctx) => ({
      form: await ctx.db.get(publishedFormId),
      publishedRefs: await ctx.db
        .query("formPublishedFieldRefs")
        .withIndex("by_form", (q) => q.eq("formId", publishedFormId))
        .take(10),
      version: await ctx.db.get(published.formVersionId),
      submission: await ctx.db.get(historical.submissionId),
    }));
    expect(archived.form).toMatchObject({
      status: "deleted",
      currentPublishedVersionId: published.formVersionId,
    });
    expect(archived.form?.deletedAt).toEqual(expect.any(Number));
    expect(archived.publishedRefs).toEqual([]);
    expect(archived.version).not.toBeNull();
    expect(archived.submission).not.toBeNull();
    expect(
      await test.query(internal.forms.getPublic, {
        slug: archived.form!.slug,
      }),
    ).toBeNull();

    const archivedList = await admin.query(api.forms.listArchived, {
      baseId: fixture.baseId,
    });
    expect(archivedList).toEqual([
      {
        formId: publishedFormId,
        name: "Published launch form",
        title: "Published launch form title",
        tableName: "Launches",
        archivedAt: archived.form?.deletedAt,
        willRestoreAs: "Closed",
      },
    ]);
    await expect(
      member.query(api.forms.listArchived, {
        baseId: fixture.baseId,
      }),
    ).rejects.toThrow();
    await expect(
      otherAdmin.query(api.forms.listArchived, {
        baseId: fixture.baseId,
      }),
    ).rejects.toThrow();

    const restored = await admin.mutation(api.forms.restore, {
      formId: publishedFormId,
    });
    expect(restored).toEqual({
      formId: publishedFormId,
      name: "Published launch form",
      status: "closed",
    });
    const restoredState = await test.run(async (ctx) => ({
      form: await ctx.db.get(publishedFormId),
      publishedRefs: await ctx.db
        .query("formPublishedFieldRefs")
        .withIndex("by_form", (q) => q.eq("formId", publishedFormId))
        .take(10),
      submission: await ctx.db.get(historical.submissionId),
      auditActions: (
        await ctx.db.query("auditEvents").take(30)
      ).map((event) => event.action),
    }));
    expect(restoredState.form).toMatchObject({
      status: "closed",
      currentPublishedVersionId: published.formVersionId,
    });
    expect(restoredState.form?.deletedAt).toBeUndefined();
    expect(restoredState.publishedRefs).toEqual([]);
    expect(restoredState.submission).not.toBeNull();
    expect(restoredState.auditActions).toContain("form.archived");
    expect(restoredState.auditActions).toContain("form.restored");
    expect(
      await test.query(internal.forms.getPublic, {
        slug: restoredState.form!.slug,
      }),
    ).toBeNull();
    await expect(
      admin.mutation(api.forms.restore, { formId: publishedFormId }),
    ).rejects.toThrow(/FORM_NOT_ARCHIVED/);

    const draftFormId = await admin.mutation(api.forms.create, {
      tableId: fixture.tableId,
      name: "Draft lifecycle form",
    });
    await admin.mutation(api.forms.remove, { formId: draftFormId });
    const restoredDraft = await admin.mutation(api.forms.restore, {
      formId: draftFormId,
    });
    expect(restoredDraft).toEqual({
      formId: draftFormId,
      name: "Draft lifecycle form",
      status: "draft",
    });
    expect(
      await test.run(async (ctx) =>
        ctx.db
          .query("auditEvents")
          .filter((q) =>
            q.and(
              q.eq(q.field("resourceId"), draftFormId),
              q.eq(q.field("action"), "form.deleted"),
            ),
          )
          .first(),
      ),
    ).not.toBeNull();
  });
});
