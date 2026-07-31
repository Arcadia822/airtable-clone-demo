import { ConvexError } from "convex/values";

export type PlanTier = "free" | "starter" | "pro";

export const FEATURE_SLUGS = {
  formAnalytics: "form_analytics",
  customFormBranding: "custom_form_branding",
  aiAssistant: "ai_assistant",
} as const;

export const PLAN_LIMITS = {
  free: {
    seats: 2,
    bases: 1,
    tablesPerBase: 3,
    fieldsPerTable: 25,
    recordsPerOrg: 500,
    formsPerBase: 3,
    submissionsPerMonth: 250,
    storageBytes: 250 * 1024 * 1024,
    aiTurnsPerMonth: 0,
  },
  starter: {
    seats: 10,
    bases: 10,
    tablesPerBase: 25,
    fieldsPerTable: 100,
    recordsPerOrg: 25_000,
    formsPerBase: 20,
    submissionsPerMonth: 5_000,
    storageBytes: 10 * 1024 * 1024 * 1024,
    aiTurnsPerMonth: 0,
  },
  pro: {
    seats: 20,
    bases: 50,
    tablesPerBase: 50,
    fieldsPerTable: 250,
    recordsPerOrg: 250_000,
    formsPerBase: 50,
    submissionsPerMonth: 50_000,
    storageBytes: 50 * 1024 * 1024 * 1024,
    aiTurnsPerMonth: 500,
  },
} as const;

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_CELL = 10;
export const MAX_RECORD_VALUE_BYTES = 256 * 1024;
export const MAX_GRID_PAGE_SIZE = 100;
export const DEFAULT_GRID_PAGE_SIZE = 50;
export const MAX_BATCH_CELL_UPDATES = 500;
export const MAX_BATCH_RECORDS = 100;
export const MAX_RECORD_MUTATION_IDEMPOTENCY_KEY_LENGTH = 256;
export const UPLOAD_SESSION_TTL_MS = 60 * 60 * 1000;
export const PUBLIC_SUBMISSION_SESSION_TTL_MS = 30 * 60 * 1000;
export const MAX_PUBLIC_UPLOADS_PER_SUBMISSION = 50;

export function normalizePlanTier(value: unknown): PlanTier {
  if (typeof value !== "string") {
    return "free";
  }
  const slug = value.toLowerCase().split(":").at(-1);
  if (slug === "pro" || slug === "starter") {
    return slug;
  }
  return "free";
}

export function monthKey(timestamp = Date.now()): string {
  return new Date(timestamp).toISOString().slice(0, 7);
}

export function dayKey(timestamp = Date.now()): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function assertBelowQuota(
  current: number,
  limit: number,
  resource: string,
): void {
  if (current >= limit) {
    throw new ConvexError({
      code: "QUOTA_EXCEEDED",
      resource,
      current,
      limit,
    });
  }
}
