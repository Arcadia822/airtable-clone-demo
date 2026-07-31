export const PLAN_SLUGS = ["free", "starter", "pro"] as const

export type PlanSlug = (typeof PLAN_SLUGS)[number]

export const FEATURE_SLUGS = {
  analytics: "form_analytics",
  customBranding: "custom_form_branding",
  aiAssistant: "ai_assistant",
} as const

export interface PlanLimits {
  seats: number
  bases: number
  tablesPerBase: number
  fieldsPerTable: number
  records: number
  formsPerBase: number
  submissionsPerMonth: number
  storageBytes: number
  aiTurnsPerMonth: number
}

export interface PlanDefinition {
  slug: PlanSlug
  name: string
  eyebrow: string
  description: string
  monthlyBasePrice: number
  annualBasePrice: number
  includedSeats: number
  monthlyExtraSeatPrice: number
  annualExtraSeatPrice: number
  limits: PlanLimits
  features: readonly string[]
  highlights: readonly string[]
}

const GB = 1024 * 1024 * 1024
const MB = 1024 * 1024

export const PLAN_DEFINITIONS: Record<PlanSlug, PlanDefinition> = {
  free: {
    slug: "free",
    name: "Free",
    eyebrow: "For personal projects",
    description: "Build a lightweight shared base and publish your first forms.",
    monthlyBasePrice: 0,
    annualBasePrice: 0,
    includedSeats: 2,
    monthlyExtraSeatPrice: 0,
    annualExtraSeatPrice: 0,
    limits: {
      seats: 2,
      bases: 1,
      tablesPerBase: 3,
      fieldsPerTable: 25,
      records: 500,
      formsPerBase: 3,
      submissionsPerMonth: 250,
      storageBytes: 250 * MB,
      aiTurnsPerMonth: 0,
    },
    features: [],
    highlights: [
      "1 base with 3 realtime tables",
      "500 records per workspace",
      "3 public forms per base",
      "250 submissions each month",
      "250 MB file storage",
    ],
  },
  starter: {
    slug: "starter",
    name: "Starter",
    eyebrow: "For growing teams",
    description: "Turn shared operations into polished, measurable workflows.",
    monthlyBasePrice: 19,
    annualBasePrice: 190,
    includedSeats: 3,
    monthlyExtraSeatPrice: 5,
    annualExtraSeatPrice: 50,
    limits: {
      seats: 10,
      bases: 10,
      tablesPerBase: 25,
      fieldsPerTable: 100,
      records: 25_000,
      formsPerBase: 20,
      submissionsPerMonth: 5_000,
      storageBytes: 10 * GB,
      aiTurnsPerMonth: 0,
    },
    features: [FEATURE_SLUGS.analytics, FEATURE_SLUGS.customBranding],
    highlights: [
      "10 bases and 25,000 records",
      "Up to 10 workspace members",
      "Form conversion analytics",
      "Custom form branding and redirects",
      "10 GB file storage",
    ],
  },
  pro: {
    slug: "pro",
    name: "Pro",
    eyebrow: "For AI-powered operations",
    description:
      "Ask questions across your workspace and review every proposed change before it runs.",
    monthlyBasePrice: 59,
    annualBasePrice: 590,
    includedSeats: 5,
    monthlyExtraSeatPrice: 10,
    annualExtraSeatPrice: 100,
    limits: {
      seats: 20,
      bases: 50,
      tablesPerBase: 50,
      fieldsPerTable: 250,
      records: 250_000,
      formsPerBase: 50,
      submissionsPerMonth: 50_000,
      storageBytes: 50 * GB,
      aiTurnsPerMonth: 500,
    },
    features: [
      FEATURE_SLUGS.analytics,
      FEATURE_SLUGS.customBranding,
      FEATURE_SLUGS.aiAssistant,
    ],
    highlights: [
      "50 bases and 250,000 records",
      "Up to 20 workspace members",
      "500 AI questions each month",
      "Review every AI change before it is applied",
      "50 GB file storage",
    ],
  },
}

export const PLAN_LIST = PLAN_SLUGS.map((slug) => PLAN_DEFINITIONS[slug])

export const MAX_FILE_BYTES = 25 * MB
export const MAX_ATTACHMENTS_PER_CELL = 10

export function isPlanSlug(value: string | null | undefined): value is PlanSlug {
  return PLAN_SLUGS.includes(value as PlanSlug)
}

export function planFromClaims(plans: readonly string[] | undefined): PlanSlug {
  if (plans?.includes("pro")) return "pro"
  if (plans?.includes("starter")) return "starter"
  return "free"
}

export function formatStorage(bytes: number): string {
  if (bytes >= GB) return `${Math.round(bytes / GB)} GB`
  return `${Math.round(bytes / MB)} MB`
}
