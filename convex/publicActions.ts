"use node";

import { createClerkClient } from "@clerk/backend";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { ConvexError, v, type Infer } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action } from "./_generated/server";
import { analyticsDayAt } from "./lib/analyticsTimeZone";
import { normalizePlanTier, type PlanTier } from "./lib/quotas";
import {
  isAcceptedTurnstileResponse,
  type TurnstileValidationResponse,
} from "./lib/turnstileValidation";
import {
  analyticsDeviceCategoryValidator,
  analyticsTrafficSourceValidator,
  fieldConfigValidator,
  fieldTypeValidator,
  formAnswerValidator,
  formQuestionModeValidator,
  formVersionVisibilityRuleValidator,
  nullableCellValueValidator,
} from "./lib/validators";

type OrganizationEntitlements = {
  plan: PlanTier;
  features: Set<string>;
};

type CachedOrganizationEntitlements = {
  expiresAt: number;
  features: string[];
  plan: PlanTier;
};

const publicFormAppearanceValidator = v.object({
  primaryColor: v.string(),
  backgroundColor: v.string(),
  submitLabel: v.string(),
  showPoweredBy: v.boolean(),
  layout: v.union(v.literal("card"), v.literal("plain")),
  logoUrl: v.union(v.string(), v.null()),
  coverUrl: v.union(v.string(), v.null()),
});

const publicFormFieldValidator = v.object({
  id: v.id("formVersionFields"),
  type: fieldTypeValidator,
  config: fieldConfigValidator,
  label: v.string(),
  description: v.optional(v.string()),
  placeholder: v.optional(v.string()),
  required: v.boolean(),
  mode: formQuestionModeValidator,
  fixedValue: v.optional(nullableCellValueValidator),
  prefillParameter: v.optional(v.string()),
  visibility: v.optional(formVersionVisibilityRuleValidator),
});

const publicFormResultValidator = v.object({
  slug: v.string(),
  formVersionId: v.id("formVersions"),
  version: v.number(),
  title: v.string(),
  description: v.string(),
  analyticsTimeZone: v.string(),
  appearance: publicFormAppearanceValidator,
  fields: v.array(publicFormFieldValidator),
});

const beginPublicSubmissionResultValidator = v.object({
  submissionSessionId: v.id("publicSubmissionSessions"),
  expiresAt: v.number(),
  submissionProof: v.string(),
});

const thankYouResultValidator = v.object({
  title: v.string(),
  message: v.string(),
  redirectUrl: v.optional(v.string()),
});

const submissionResultValidator = v.object({
  submissionId: v.id("formSubmissions"),
  recordId: v.id("records"),
  thankYou: thankYouResultValidator,
  duplicate: v.boolean(),
});

const uploadSessionResultValidator = v.object({
  uploadSessionId: v.id("uploadSessions"),
  uploadUrl: v.string(),
  expiresAt: v.number(),
});

const finalizeUploadResultValidator = v.object({
  ok: v.boolean(),
  attachmentId: v.optional(v.id("attachments")),
  error: v.optional(v.string()),
});

type PublicFormResult = Infer<typeof publicFormResultValidator>;
type PublishedPublicForm = PublicFormResult & { orgId: string };
type BeginPublicSubmissionResult = Infer<
  typeof beginPublicSubmissionResultValidator
>;
type BeginSubmissionSessionResult = Omit<
  BeginPublicSubmissionResult,
  "submissionProof"
>;
type SubmissionResult = Infer<typeof submissionResultValidator>;
type UploadSessionResult = Infer<typeof uploadSessionResultValidator>;
type FinalizeUploadResult = Infer<typeof finalizeUploadResultValidator>;

type SubmissionContext = {
  orgId: string;
  formId: Id<"forms">;
  formVersionId: Id<"formVersions">;
  analyticsTimeZone: string;
};

type SubmissionSessionContext = SubmissionContext & {
  planAtStart: PlanTier;
};

type PublicUploadContext = {
  orgId: string;
  formId: Id<"forms">;
  submissionSessionId: Id<"publicSubmissionSessions">;
  planAtStart: PlanTier;
};

const ENTITLEMENT_CACHE_TTL_MS = 30_000;
const MAX_ENTITLEMENT_CACHE_ENTRIES = 256;
const entitlementCache = new Map<string, CachedOrganizationEntitlements>();
const entitlementRequests = new Map<
  string,
  Promise<OrganizationEntitlements>
>();

function cloneEntitlements(
  entitlements: OrganizationEntitlements,
): OrganizationEntitlements {
  return {
    plan: entitlements.plan,
    features: new Set(entitlements.features),
  };
}

function pruneEntitlementCache(now: number): void {
  for (const [orgId, cached] of entitlementCache) {
    if (cached.expiresAt <= now) {
      entitlementCache.delete(orgId);
    }
  }
  while (entitlementCache.size >= MAX_ENTITLEMENT_CACHE_ENTRIES) {
    const oldest = entitlementCache.keys().next().value;
    if (oldest === undefined) break;
    entitlementCache.delete(oldest);
  }
}

function boundInFlightRequests(): void {
  while (entitlementRequests.size >= MAX_ENTITLEMENT_CACHE_ENTRIES) {
    const oldest = entitlementRequests.keys().next().value;
    if (oldest === undefined) break;
    entitlementRequests.delete(oldest);
  }
}

async function fetchOrganizationEntitlements(
  orgId: string,
): Promise<OrganizationEntitlements> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new ConvexError({ code: "BILLING_UNAVAILABLE" });
  }
  try {
    const clerk = createClerkClient({ secretKey });
    const subscription =
      await clerk.billing.getOrganizationBillingSubscription(orgId);
    const activeItem =
      subscription.subscriptionItems.find(
        (item) => item.status === "active" && item.plan,
      ) ??
      subscription.subscriptionItems.find(
        (item) => item.isFreeTrial && item.plan,
      ) ??
      subscription.subscriptionItems.find((item) => item.plan?.isDefault);
    return {
      plan: normalizePlanTier(activeItem?.plan?.slug),
      features: new Set(
        (activeItem?.plan?.features ?? []).map((feature) =>
          feature.slug.toLowerCase(),
        ),
      ),
    };
  } catch (error) {
    console.error(
      "Unable to resolve the Clerk organization subscription.",
      error instanceof Error ? error.message : "Unknown error",
    );
    throw new ConvexError({ code: "BILLING_UNAVAILABLE" });
  }
}

async function getCachedOrganizationEntitlements(
  orgId: string,
): Promise<OrganizationEntitlements> {
  const now = Date.now();
  pruneEntitlementCache(now);
  const cached = entitlementCache.get(orgId);
  if (cached && cached.expiresAt > now) {
    entitlementCache.delete(orgId);
    entitlementCache.set(orgId, cached);
    return {
      plan: cached.plan,
      features: new Set(cached.features),
    };
  }

  const activeRequest = entitlementRequests.get(orgId);
  if (activeRequest) {
    return cloneEntitlements(await activeRequest);
  }

  boundInFlightRequests();
  const request = fetchOrganizationEntitlements(orgId);
  entitlementRequests.set(orgId, request);
  try {
    const entitlements = await request;
    pruneEntitlementCache(Date.now());
    entitlementCache.set(orgId, {
      plan: entitlements.plan,
      features: [...entitlements.features],
      expiresAt: Date.now() + ENTITLEMENT_CACHE_TTL_MS,
    });
    return cloneEntitlements(entitlements);
  } finally {
    if (entitlementRequests.get(orgId) === request) {
      entitlementRequests.delete(orgId);
    }
  }
}

async function getOrganizationPlan(orgId: string): Promise<PlanTier> {
  return (await getCachedOrganizationEntitlements(orgId)).plan;
}

async function verifyTurnstile(
  token: string,
  expectedAction: "form-submit",
): Promise<string> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    throw new ConvexError({ code: "TURNSTILE_UNAVAILABLE" });
  }
  if (!token || token.length > 4_096) {
    throw new ConvexError({ code: "TURNSTILE_INVALID" });
  }

  let result: TurnstileValidationResponse;
  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          secret,
          response: token,
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`Turnstile returned ${response.status}.`);
    }
    result = (await response.json()) as TurnstileValidationResponse;
  } catch (error) {
    console.error(
      "Unable to verify Turnstile.",
      error instanceof Error ? error.message : "Unknown error",
    );
    throw new ConvexError({ code: "TURNSTILE_UNAVAILABLE" });
  }

  const expectedHostname = process.env.TURNSTILE_EXPECTED_HOSTNAME;
  if (!isAcceptedTurnstileResponse({
    expectedAction,
    expectedHostname,
    response: result,
    secret,
  })) {
    throw new ConvexError({
      code: "TURNSTILE_INVALID",
      reasons: (result["error-codes"] ?? []).slice(0, 5),
    });
  }

  return createHash("sha256").update(token).digest("hex");
}

function proofHash(proof: string): string {
  if (!/^[a-f0-9]{64}$/.test(proof)) {
    throw new ConvexError({ code: "PUBLIC_SUBMISSION_SESSION_INVALID" });
  }
  return createHash("sha256").update(proof).digest("hex");
}

export const getPublicForm = action({
  args: { slug: v.string() },
  returns: v.union(v.null(), publicFormResultValidator),
  handler: async (ctx, args): Promise<PublicFormResult | null> => {
    const published: PublishedPublicForm | null = await ctx.runQuery(
      internal.forms.getPublic,
      args,
    );
    if (!published) return null;
    const entitlements = await getCachedOrganizationEntitlements(
      published.orgId,
    );
    const canBrand = entitlements.features.has("custom_form_branding");
    const form: PublicFormResult = {
      slug: published.slug,
      formVersionId: published.formVersionId,
      version: published.version,
      title: published.title,
      description: published.description,
      analyticsTimeZone: published.analyticsTimeZone,
      appearance: published.appearance,
      fields: published.fields,
    };
    if (canBrand) return form;
    return {
      ...form,
      appearance: {
        primaryColor: "#2563eb",
        backgroundColor: "#ffffff",
        submitLabel: "Submit",
        showPoweredBy: true,
        layout: "card",
        logoUrl: null,
        coverUrl: null,
      },
    };
  },
});

export const beginPublicSubmission = action({
  args: {
    slug: v.string(),
    formVersionId: v.id("formVersions"),
    turnstileToken: v.string(),
  },
  returns: beginPublicSubmissionResultValidator,
  handler: async (ctx, args): Promise<BeginPublicSubmissionResult> => {
    const context: SubmissionContext = await ctx.runQuery(
      internal.forms.getSubmissionContext,
      {
        slug: args.slug,
        formVersionId: args.formVersionId,
      },
    );
    await verifyTurnstile(args.turnstileToken, "form-submit");
    const plan = await getOrganizationPlan(context.orgId);
    const submissionProof = randomBytes(32).toString("hex");
    const session: BeginSubmissionSessionResult = await ctx.runMutation(
      internal.forms.beginSubmissionSession,
      {
        slug: args.slug,
        formVersionId: args.formVersionId,
        plan,
        proofHash: proofHash(submissionProof),
      },
    );
    return { ...session, submissionProof };
  },
});

export const submitForm = action({
  args: {
    slug: v.string(),
    formVersionId: v.id("formVersions"),
    submissionSessionId: v.id("publicSubmissionSessions"),
    submissionProof: v.string(),
    idempotencyKey: v.string(),
    answers: v.array(formAnswerValidator),
  },
  returns: submissionResultValidator,
  handler: async (ctx, args): Promise<SubmissionResult> => {
    const hashedProof = proofHash(args.submissionProof);
    const context: SubmissionSessionContext = await ctx.runQuery(
      internal.forms.getSubmissionSessionContext,
      {
        submissionSessionId: args.submissionSessionId,
        proofHash: hashedProof,
        allowConsumed: true,
      },
    );
    if (context.formVersionId !== args.formVersionId) {
      throw new ConvexError({ code: "PUBLIC_SUBMISSION_SESSION_INVALID" });
    }
    const entitlements = await fetchOrganizationEntitlements(context.orgId);
    const result: SubmissionResult = await ctx.runMutation(
      internal.forms.commitSubmission,
      {
        slug: args.slug,
        formVersionId: args.formVersionId,
        submissionSessionId: args.submissionSessionId,
        proofHash: hashedProof,
        idempotencyKey: args.idempotencyKey,
        answers: args.answers,
        plan: entitlements.plan,
      },
    );
    if (
      result.thankYou?.redirectUrl &&
      !entitlements.features.has("custom_form_branding")
    ) {
      return {
        ...result,
        thankYou: {
          ...result.thankYou,
          redirectUrl: undefined,
        },
      } satisfies SubmissionResult;
    }
    return result;
  },
});

export const trackFormMetric = action({
  args: {
    slug: v.string(),
    formVersionId: v.id("formVersions"),
    metric: v.union(
      v.literal("view"),
      v.literal("start"),
      v.literal("validation_error"),
      v.literal("abandonment"),
    ),
    visitorNonce: v.string(),
    deviceCategory: v.optional(analyticsDeviceCategoryValidator),
    trafficSource: v.optional(analyticsTrafficSourceValidator),
    lastQuestionId: v.optional(v.id("formVersionFields")),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if (
      !args.visitorNonce ||
      args.visitorNonce.length > 256 ||
      !process.env.FORM_ANALYTICS_HASH_SALT
    ) {
      throw new ConvexError({ code: "ANALYTICS_UNAVAILABLE" });
    }
    const context: SubmissionContext = await ctx.runQuery(
      internal.forms.getSubmissionContext,
      {
        slug: args.slug,
        formVersionId: args.formVersionId,
      },
    );
    const day = analyticsDayAt(Date.now(), context.analyticsTimeZone);
    const visitorHash = createHmac(
      "sha256",
      process.env.FORM_ANALYTICS_HASH_SALT,
    )
      .update(
        `${context.formId}.${args.formVersionId}.${day}.${args.visitorNonce}`,
      )
      .digest("hex");
    await ctx.runMutation(internal.analytics.trackPublic, {
      slug: args.slug,
      formVersionId: args.formVersionId,
      metric: args.metric,
      visitorHash,
      deviceCategory: args.deviceCategory,
      trafficSource: args.trafficSource,
      lastQuestionId: args.lastQuestionId,
    });
    return null;
  },
});

export const createPublicUploadSession = action({
  args: {
    submissionSessionId: v.id("publicSubmissionSessions"),
    submissionProof: v.string(),
    formVersionFieldId: v.id("formVersionFields"),
  },
  returns: uploadSessionResultValidator,
  handler: async (ctx, args): Promise<UploadSessionResult> => {
    const hashedProof = proofHash(args.submissionProof);
    await ctx.runQuery(
      internal.forms.getSubmissionSessionContext,
      {
        submissionSessionId: args.submissionSessionId,
        proofHash: hashedProof,
        allowConsumed: false,
      },
    );
    const result: UploadSessionResult = await ctx.runMutation(
      internal.attachments.createPublicUploadSession,
      {
        submissionSessionId: args.submissionSessionId,
        formVersionFieldId: args.formVersionFieldId,
        proofHash: hashedProof,
      },
    );
    return result;
  },
});

export const finalizePublicUpload = action({
  args: {
    uploadSessionId: v.id("uploadSessions"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    submissionProof: v.string(),
  },
  returns: finalizeUploadResultValidator,
  handler: async (ctx, args): Promise<FinalizeUploadResult> => {
    const hashedProof = proofHash(args.submissionProof);
    const context: PublicUploadContext = await ctx.runQuery(
      internal.attachments.getPublicUploadContext,
      {
        uploadSessionId: args.uploadSessionId,
        proofHash: hashedProof,
      },
    );
    const result: FinalizeUploadResult = await ctx.runMutation(
      internal.attachments.finalizePublicUpload,
      {
        uploadSessionId: args.uploadSessionId,
        storageId: args.storageId,
        fileName: args.fileName,
        proofHash: hashedProof,
        plan: context.planAtStart,
      },
    );
    return result;
  },
});
