import type { Doc, Id } from "../_generated/dataModel";

export const DEMO_SEED_TEMPLATE_KEY = "product-operations";
export const DEMO_SEED_TEMPLATE_VERSION = 1;
export const DEMO_SEED_BASE_NAME = "Product operations";
export const DEMO_SEED_BASE_DESCRIPTION =
  "A ready-to-use workspace for planning launches, collecting customer feedback, and coordinating delivery.";

const DAY_MS = 24 * 60 * 60 * 1_000;

type RelativeDateValue = {
  relativeDays: number;
};

export type DemoSeedCellValue =
  | string
  | number
  | boolean
  | string[]
  | RelativeDateValue;

export type DemoSeedField = {
  key: string;
  name: string;
  type: Doc<"fields">["type"];
  config: Doc<"fields">["config"];
  rank: string;
  width: number;
  isPrimary: boolean;
};

export type DemoSeedRecord = {
  rank: string;
  updatedDaysAgo: number;
  submittedDaysAgo?: number;
  values: Record<string, DemoSeedCellValue>;
};

export type DemoSeedTable = {
  key: string;
  name: string;
  rank: string;
  fields: readonly DemoSeedField[];
  records: readonly DemoSeedRecord[];
};

export const DEMO_SEED_TABLES: readonly DemoSeedTable[] = [
  {
    key: "roadmap",
    name: "Product roadmap",
    rank: "a0",
    fields: [
      {
        key: "initiative",
        name: "Initiative",
        type: "singleLineText",
        config: { maxLength: 10_000 },
        rank: "a0",
        width: 260,
        isPrimary: true,
      },
      {
        key: "status",
        name: "Status",
        type: "singleSelect",
        config: {
          options: [
            { id: "planned", label: "Planned", color: "#94a3b8" },
            { id: "building", label: "Building", color: "#3b82f6" },
            { id: "review", label: "In review", color: "#f59e0b" },
            { id: "shipped", label: "Shipped", color: "#10b981" },
          ],
        },
        rank: "a1",
        width: 160,
        isPrimary: false,
      },
      {
        key: "owner",
        name: "Owner email",
        type: "email",
        config: { maxLength: 320 },
        rank: "a2",
        width: 220,
        isPrimary: false,
      },
      {
        key: "targetDate",
        name: "Target date",
        type: "date",
        config: { dateStyle: "date", includeTime: false },
        rank: "a3",
        width: 160,
        isPrimary: false,
      },
      {
        key: "progress",
        name: "Progress",
        type: "percent",
        config: { min: 0, max: 1, precision: 0 },
        rank: "a4",
        width: 140,
        isPrimary: false,
      },
      {
        key: "customerFacing",
        name: "Customer facing",
        type: "checkbox",
        config: {},
        rank: "a5",
        width: 150,
        isPrimary: false,
      },
      {
        key: "briefUrl",
        name: "Brief",
        type: "url",
        config: { maxLength: 2_048 },
        rank: "a6",
        width: 240,
        isPrimary: false,
      },
      {
        key: "channels",
        name: "Channels",
        type: "multiSelect",
        config: {
          options: [
            { id: "web", label: "Web", color: "#8b5cf6" },
            { id: "mobile", label: "Mobile", color: "#06b6d4" },
            { id: "email", label: "Email", color: "#ec4899" },
            { id: "community", label: "Community", color: "#f97316" },
          ],
        },
        rank: "a7",
        width: 220,
        isPrimary: false,
      },
      {
        key: "assets",
        name: "Launch images",
        type: "attachment",
        config: {
          attachmentKind: "image",
          acceptedMimeTypes: ["image/*"],
        },
        rank: "a8",
        width: 200,
        isPrimary: false,
      },
    ],
    records: [
      {
        rank: "a0",
        updatedDaysAgo: 1,
        values: {
          initiative: "Workspace templates",
          status: "shipped",
          owner: "maya@basecraft.example",
          targetDate: { relativeDays: -5 },
          progress: 1,
          customerFacing: true,
          briefUrl: "https://example.com/product/workspace-templates",
          channels: ["web", "community"],
        },
      },
      {
        rank: "a1",
        updatedDaysAgo: 0,
        values: {
          initiative: "Mobile inbox",
          status: "review",
          owner: "alex@basecraft.example",
          targetDate: { relativeDays: 4 },
          progress: 0.82,
          customerFacing: true,
          briefUrl: "https://example.com/product/mobile-inbox",
          channels: ["mobile"],
        },
      },
      {
        rank: "a2",
        updatedDaysAgo: 2,
        values: {
          initiative: "Form analytics",
          status: "building",
          owner: "priya@basecraft.example",
          targetDate: { relativeDays: 10 },
          progress: 0.64,
          customerFacing: true,
          briefUrl: "https://example.com/product/form-analytics",
          channels: ["web", "email"],
        },
      },
      {
        rank: "a3",
        updatedDaysAgo: 3,
        values: {
          initiative: "Bulk record import",
          status: "building",
          owner: "noah@basecraft.example",
          targetDate: { relativeDays: 16 },
          progress: 0.48,
          customerFacing: false,
          briefUrl: "https://example.com/product/bulk-import",
          channels: ["web"],
        },
      },
      {
        rank: "a4",
        updatedDaysAgo: 5,
        values: {
          initiative: "AI field insights",
          status: "planned",
          owner: "maya@basecraft.example",
          targetDate: { relativeDays: 28 },
          progress: 0.24,
          customerFacing: true,
          briefUrl: "https://example.com/product/ai-field-insights",
          channels: ["web", "mobile"],
        },
      },
      {
        rank: "a5",
        updatedDaysAgo: 4,
        values: {
          initiative: "Customer portal",
          status: "planned",
          owner: "elena@basecraft.example",
          targetDate: { relativeDays: 35 },
          progress: 0.12,
          customerFacing: true,
          briefUrl: "https://example.com/product/customer-portal",
          channels: ["web"],
        },
      },
    ],
  },
  {
    key: "feedback",
    name: "Customer feedback",
    rank: "a1",
    fields: [
      {
        key: "summary",
        name: "Feedback",
        type: "singleLineText",
        config: { maxLength: 10_000 },
        rank: "a0",
        width: 280,
        isPrimary: true,
      },
      {
        key: "details",
        name: "Details",
        type: "longText",
        config: { maxLength: 100_000 },
        rank: "a1",
        width: 340,
        isPrimary: false,
      },
      {
        key: "category",
        name: "Category",
        type: "singleSelect",
        config: {
          options: [
            { id: "feature", label: "Feature request", color: "#8b5cf6" },
            { id: "usability", label: "Usability", color: "#06b6d4" },
            { id: "bug", label: "Bug", color: "#ef4444" },
            { id: "praise", label: "Praise", color: "#10b981" },
          ],
        },
        rank: "a2",
        width: 180,
        isPrimary: false,
      },
      {
        key: "customerEmail",
        name: "Customer email",
        type: "email",
        config: { maxLength: 320 },
        rank: "a3",
        width: 230,
        isPrimary: false,
      },
      {
        key: "productAreas",
        name: "Product areas",
        type: "multiSelect",
        config: {
          options: [
            { id: "grid", label: "Grid", color: "#6366f1" },
            { id: "forms", label: "Forms", color: "#ec4899" },
            { id: "analytics", label: "Analytics", color: "#f59e0b" },
            { id: "automation", label: "Automation", color: "#14b8a6" },
          ],
        },
        rank: "a4",
        width: 220,
        isPrimary: false,
      },
      {
        key: "urgency",
        name: "Urgency",
        type: "singleSelect",
        config: {
          options: [
            { id: "low", label: "Low", color: "#94a3b8" },
            { id: "medium", label: "Medium", color: "#3b82f6" },
            { id: "high", label: "High", color: "#f97316" },
            { id: "critical", label: "Critical", color: "#ef4444" },
          ],
        },
        rank: "a5",
        width: 150,
        isPrimary: false,
      },
      {
        key: "followUp",
        name: "Follow up",
        type: "checkbox",
        config: {},
        rank: "a6",
        width: 130,
        isPrimary: false,
      },
      {
        key: "receivedAt",
        name: "Received",
        type: "date",
        config: { dateStyle: "date", includeTime: false },
        rank: "a7",
        width: 150,
        isPrimary: false,
      },
      {
        key: "attachment",
        name: "Supporting file",
        type: "attachment",
        config: { attachmentKind: "file" },
        rank: "a8",
        width: 210,
        isPrimary: false,
      },
    ],
    records: [
      {
        rank: "a0",
        updatedDaysAgo: 0,
        submittedDaysAgo: 1,
        values: {
          summary: "Add saved views for weekly planning",
          details:
            "Our product team switches between launch and backlog views every day.",
          category: "feature",
          customerEmail: "aisha@northstar.example",
          productAreas: ["grid"],
          urgency: "high",
        },
      },
      {
        rank: "a1",
        updatedDaysAgo: 1,
        submittedDaysAgo: 2,
        values: {
          summary: "Form setup was delightfully quick",
          details: "We published our first intake form in under ten minutes.",
          category: "praise",
          customerEmail: "marcus@pine.example",
          productAreas: ["forms"],
          urgency: "low",
        },
      },
      {
        rank: "a2",
        updatedDaysAgo: 2,
        submittedDaysAgo: 3,
        values: {
          summary: "Need clearer validation messages",
          details:
            "A required field failed but the message did not explain which answer was missing.",
          category: "usability",
          customerEmail: "sofia@orbit.example",
          productAreas: ["forms"],
          urgency: "medium",
        },
      },
      {
        rank: "a3",
        updatedDaysAgo: 3,
        submittedDaysAgo: 5,
        values: {
          summary: "CSV import should preserve select values",
          details:
            "Importing a launch plan created plain text instead of matching the existing options.",
          category: "bug",
          customerEmail: "liam@acme.example",
          productAreas: ["grid", "automation"],
          urgency: "critical",
        },
      },
      {
        rank: "a4",
        updatedDaysAgo: 5,
        submittedDaysAgo: 7,
        values: {
          summary: "Share analytics with collaborators",
          details:
            "A read-only analytics link would make our weekly customer review easier.",
          category: "feature",
          customerEmail: "hana@harbor.example",
          productAreas: ["analytics"],
          urgency: "medium",
        },
      },
      {
        rank: "a5",
        updatedDaysAgo: 7,
        submittedDaysAgo: 9,
        values: {
          summary: "Keyboard navigation feels fast",
          details: "Editing several records without touching the mouse is excellent.",
          category: "praise",
          customerEmail: "ben@studio.example",
          productAreas: ["grid"],
          urgency: "low",
        },
      },
    ],
  },
  {
    key: "launchTasks",
    name: "Launch tasks",
    rank: "a2",
    fields: [
      {
        key: "task",
        name: "Task",
        type: "singleLineText",
        config: { maxLength: 10_000 },
        rank: "a0",
        width: 280,
        isPrimary: true,
      },
      {
        key: "workstream",
        name: "Workstream",
        type: "singleSelect",
        config: {
          options: [
            { id: "product", label: "Product", color: "#6366f1" },
            { id: "marketing", label: "Marketing", color: "#ec4899" },
            { id: "sales", label: "Sales", color: "#f97316" },
            { id: "support", label: "Support", color: "#14b8a6" },
          ],
        },
        rank: "a1",
        width: 170,
        isPrimary: false,
      },
      {
        key: "assignee",
        name: "Assignee",
        type: "email",
        config: { maxLength: 320 },
        rank: "a2",
        width: 220,
        isPrimary: false,
      },
      {
        key: "dueDate",
        name: "Due date",
        type: "date",
        config: { dateStyle: "date", includeTime: false },
        rank: "a3",
        width: 150,
        isPrimary: false,
      },
      {
        key: "complete",
        name: "Complete",
        type: "checkbox",
        config: {},
        rank: "a4",
        width: 130,
        isPrimary: false,
      },
      {
        key: "budget",
        name: "Budget",
        type: "currency",
        config: { min: 0, precision: 2, currency: "USD" },
        rank: "a5",
        width: 140,
        isPrimary: false,
      },
      {
        key: "progress",
        name: "Progress",
        type: "percent",
        config: { min: 0, max: 1, precision: 0 },
        rank: "a6",
        width: 140,
        isPrimary: false,
      },
      {
        key: "referenceUrl",
        name: "Reference",
        type: "url",
        config: { maxLength: 2_048 },
        rank: "a7",
        width: 240,
        isPrimary: false,
      },
    ],
    records: [
      {
        rank: "a0",
        updatedDaysAgo: 0,
        values: {
          task: "Complete release candidate QA",
          workstream: "product",
          assignee: "alex@basecraft.example",
          dueDate: { relativeDays: 2 },
          complete: false,
          budget: 0,
          progress: 0.78,
          referenceUrl: "https://example.com/launch/qa",
        },
      },
      {
        rank: "a1",
        updatedDaysAgo: 1,
        values: {
          task: "Approve launch announcement",
          workstream: "marketing",
          assignee: "elena@basecraft.example",
          dueDate: { relativeDays: 3 },
          complete: false,
          budget: 2_500,
          progress: 0.62,
          referenceUrl: "https://example.com/launch/announcement",
        },
      },
      {
        rank: "a2",
        updatedDaysAgo: 2,
        values: {
          task: "Record sales enablement demo",
          workstream: "sales",
          assignee: "noah@basecraft.example",
          dueDate: { relativeDays: 5 },
          complete: false,
          budget: 1_200,
          progress: 0.45,
          referenceUrl: "https://example.com/launch/sales-demo",
        },
      },
      {
        rank: "a3",
        updatedDaysAgo: 3,
        values: {
          task: "Publish updated help center",
          workstream: "support",
          assignee: "priya@basecraft.example",
          dueDate: { relativeDays: 6 },
          complete: false,
          budget: 500,
          progress: 0.7,
          referenceUrl: "https://example.com/launch/help-center",
        },
      },
      {
        rank: "a4",
        updatedDaysAgo: 4,
        values: {
          task: "Confirm analytics dashboards",
          workstream: "product",
          assignee: "maya@basecraft.example",
          dueDate: { relativeDays: 7 },
          complete: false,
          budget: 0,
          progress: 0.55,
          referenceUrl: "https://example.com/launch/analytics",
        },
      },
      {
        rank: "a5",
        updatedDaysAgo: 6,
        values: {
          task: "Brief customer-facing teams",
          workstream: "sales",
          assignee: "elena@basecraft.example",
          dueDate: { relativeDays: -1 },
          complete: true,
          budget: 0,
          progress: 1,
          referenceUrl: "https://example.com/launch/briefing",
        },
      },
      {
        rank: "a6",
        updatedDaysAgo: 8,
        values: {
          task: "Lock launch scope",
          workstream: "product",
          assignee: "alex@basecraft.example",
          dueDate: { relativeDays: -5 },
          complete: true,
          budget: 0,
          progress: 1,
          referenceUrl: "https://example.com/launch/scope",
        },
      },
    ],
  },
];

export const DEMO_SEED_COUNTS = {
  tables: DEMO_SEED_TABLES.length,
  fields: DEMO_SEED_TABLES.reduce(
    (total, table) => total + table.fields.length,
    0,
  ),
  records: DEMO_SEED_TABLES.reduce(
    (total, table) => total + table.records.length,
    0,
  ),
  forms: 1,
};

type DemoFeedbackForm = {
  name: string;
  title: string;
  description: string;
  mappedFieldKeys: ReadonlyArray<{
    key: string;
    label: string;
    description?: string;
    placeholder?: string;
    required: boolean;
    rank: string;
  }>;
  appearance: Doc<"forms">["appearance"];
  thankYou: Doc<"forms">["thankYou"];
};

export const DEMO_FEEDBACK_FORM = {
  name: "Product feedback",
  title: "Tell us what would make Basecraft better",
  description:
    "Share a workflow, blocker, or idea with the product team. It takes less than two minutes.",
  mappedFieldKeys: [
    {
      key: "summary",
      label: "Summarize your feedback",
      description: "A short headline helps the team route your response.",
      placeholder: "e.g. Add a calendar view for launch planning",
      required: true,
      rank: "a0",
    },
    {
      key: "details",
      label: "Tell us more",
      description: "What are you trying to accomplish, and what gets in the way?",
      placeholder: "Describe the workflow or problem...",
      required: true,
      rank: "a1",
    },
    {
      key: "category",
      label: "What kind of feedback is this?",
      required: true,
      rank: "a2",
    },
    {
      key: "customerEmail",
      label: "Work email",
      description: "We will only use this to follow up about your feedback.",
      placeholder: "you@company.com",
      required: true,
      rank: "a3",
    },
    {
      key: "productAreas",
      label: "Which product areas are involved?",
      required: false,
      rank: "a4",
    },
    {
      key: "urgency",
      label: "How urgent is this for your team?",
      required: false,
      rank: "a5",
    },
    {
      key: "attachment",
      label: "Attach a supporting file",
      description:
        "Optional. Add a document or other file up to the workspace upload limit.",
      required: false,
      rank: "a6",
    },
  ],
  appearance: {
    primaryColor: "#2563eb",
    backgroundColor: "#ffffff",
    submitLabel: "Submit",
    showPoweredBy: true,
  },
  thankYou: {
    title: "Thank you for your submission",
    message: "Your response has been recorded.",
  },
} satisfies DemoFeedbackForm;

export function resolveDemoSeedValue(
  value: DemoSeedCellValue,
  todayUtc: number,
): Doc<"records">["values"][Id<"fields">] {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "relativeDays" in value
  ) {
    return todayUtc + value.relativeDays * DAY_MS;
  }
  return value;
}

export function demoAnalyticsDays(now: number): Array<{
  day: string;
  views: number;
  starts: number;
  submissions: number;
  validationErrors: number;
  abandonments: number;
}> {
  const todayUtc = Date.parse(
    `${new Date(now).toISOString().slice(0, 10)}T00:00:00.000Z`,
  );
  const submissionDaysAgo = new Set([1, 2, 3, 5, 7, 9]);
  return Array.from({ length: 14 }, (_, index) => {
    const views = 42 + ((index * 17) % 36);
    const starts = Math.round(views * 0.72);
    const daysAgo = 13 - index;
    return {
      day: new Date(todayUtc - daysAgo * DAY_MS)
        .toISOString()
        .slice(0, 10),
      views,
      starts,
      submissions: submissionDaysAgo.has(daysAgo) ? 1 : 0,
      validationErrors: index % 4,
      abandonments: Math.max(
        1,
        Math.round(starts * (0.16 + (index % 3) * 0.03)),
      ),
    };
  });
}

export function demoSubmissionTimestamp(
  now: number,
  submittedDaysAgo: number,
): number {
  const todayUtc = Date.parse(
    `${new Date(now).toISOString().slice(0, 10)}T00:00:00.000Z`,
  );
  return todayUtc - submittedDaysAgo * DAY_MS + 15 * 60 * 60 * 1_000;
}
