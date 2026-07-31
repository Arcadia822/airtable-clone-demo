import type {
  BaseSummary,
  CellValue,
  FieldDefinition,
  FieldType,
  FormDefinition,
  GridRecord,
  SelectOption,
  TableSummary,
} from "@/lib/domain"

const now = Date.now()
const day = 86_400_000
const minute = 60_000

const colors = [
  "#6d5dfc",
  "#0ea5a4",
  "#f97316",
  "#eab308",
  "#ec4899",
  "#38bdf8",
] as const

type DemoFieldSeed = {
  id: string
  name: string
  type: FieldType
  config?: FieldDefinition["config"]
  width?: number
  primary?: boolean
}

export type DemoTableData = {
  fields: FieldDefinition[]
  records: GridRecord[]
}

function fieldSet(seeds: DemoFieldSeed[]): FieldDefinition[] {
  return seeds.map((seed, index) => ({
    id: seed.id,
    name: seed.name,
    type: seed.type,
    config: seed.config ?? {},
    rank: `${index.toString().padStart(4, "0")}`,
    width:
      seed.width ??
      (seed.type === "longText"
        ? 320
        : seed.type === "attachment"
          ? 190
          : 170),
    isPrimary: seed.primary ?? false,
  }))
}

function selectOptions(
  entries: ReadonlyArray<readonly [id: string, label: string]>,
): SelectOption[] {
  return entries.map(([id, label], index) => ({
    id,
    label,
    color: colors[index % colors.length],
  }))
}

function recordsFor(
  tableId: string,
  count: number,
  valuesFor: (index: number) => Record<string, CellValue>,
): GridRecord[] {
  return Array.from({ length: count }, (_, index) => {
    const createdAt = now - (count - index) * 6 * 60 * minute
    return {
      id: `${tableId}:record:${String(index + 1).padStart(4, "0")}`,
      rank: String(index + 1).padStart(5, "0"),
      revision: 1,
      createdAt,
      createdBy: ["Maya Chen", "Alex Morgan", "Priya Shah", "Noah Williams"][
        index % 4
      ],
      updatedAt: Math.max(
        createdAt,
        now - ((index * 37) % (14 * 24 * 60)) * minute,
      ),
      updatedBy: ["Maya Chen", "Alex Morgan", "Priya Shah", "Noah Williams"][
        (index + 1) % 4
      ],
      values: valuesFor(index),
    }
  })
}

export const DEMO_BASES: BaseSummary[] = [
  {
    id: "base_product",
    name: "Product operations",
    color: "#6d5dfc",
    tableCount: 3,
    recordCount: 428,
    updatedAt: now - 8 * 60_000,
  },
  {
    id: "base_content",
    name: "Content calendar",
    color: "#0ea5a4",
    tableCount: 2,
    recordCount: 186,
    updatedAt: now - 2 * 60 * 60_000,
  },
  {
    id: "base_customers",
    name: "Customer research",
    color: "#f97316",
    tableCount: 4,
    recordCount: 1_204,
    updatedAt: now - day,
  },
]

export const DEMO_TABLES: TableSummary[] = [
  {
    id: "table_launches",
    baseId: "base_product",
    name: "Launches",
    color: "#6d5dfc",
    rank: "a",
  },
  {
    id: "table_feedback",
    baseId: "base_product",
    name: "Feedback",
    color: "#0ea5a4",
    rank: "b",
  },
  {
    id: "table_roadmap",
    baseId: "base_product",
    name: "Roadmap",
    color: "#f97316",
    rank: "c",
  },
  {
    id: "table_content_calendar",
    baseId: "base_content",
    name: "Calendar",
    color: "#0ea5a4",
    rank: "a",
  },
  {
    id: "table_content_channels",
    baseId: "base_content",
    name: "Channels",
    color: "#6658f5",
    rank: "b",
  },
  {
    id: "table_customer_interviews",
    baseId: "base_customers",
    name: "Interviews",
    color: "#f97316",
    rank: "a",
  },
  {
    id: "table_customer_insights",
    baseId: "base_customers",
    name: "Insights",
    color: "#0ea5a4",
    rank: "b",
  },
  {
    id: "table_customer_segments",
    baseId: "base_customers",
    name: "Segments",
    color: "#6658f5",
    rank: "c",
  },
  {
    id: "table_customer_requests",
    baseId: "base_customers",
    name: "Requests",
    color: "#eab308",
    rank: "d",
  },
]

const launchFields = fieldSet([
  {
    id: "launch_name",
    name: "Launch",
    type: "singleLineText",
    width: 260,
    primary: true,
  },
  {
    id: "launch_status",
    name: "Status",
    type: "singleSelect",
    config: {
      options: selectOptions([
        ["planning", "Planning"],
        ["building", "Building"],
        ["review", "In review"],
        ["launched", "Launched"],
      ]),
    },
  },
  {
    id: "launch_owner",
    name: "Owner",
    type: "singleLineText",
    width: 180,
  },
  {
    id: "launch_date",
    name: "Target date",
    type: "date",
    config: { dateStyle: "date" },
  },
  {
    id: "launch_progress",
    name: "Progress",
    type: "percent",
    config: { precision: 0 },
    width: 140,
  },
  {
    id: "launch_channels",
    name: "Channels",
    type: "multiSelect",
    config: {
      options: selectOptions([
        ["web", "Web"],
        ["mobile", "Mobile"],
        ["email", "Email"],
        ["community", "Community"],
      ]),
    },
    width: 220,
  },
  { id: "launch_notes", name: "Notes", type: "longText" },
  {
    id: "launch_assets",
    name: "Assets",
    type: "attachment",
    config: { attachmentKind: "any" },
  },
])

// These feedback fields intentionally retain the original public-form IDs.
// DEMO_FORM maps directly to this table, while Launches has its own schema.
export const DEMO_FIELDS: FieldDefinition[] = fieldSet([
  {
    id: "field_name",
    name: "Respondent",
    type: "singleLineText",
    width: 220,
    primary: true,
  },
  {
    id: "field_status",
    name: "Urgency",
    type: "singleSelect",
    config: {
      options: selectOptions([
        ["planning", "Low"],
        ["building", "Medium"],
        ["review", "High"],
        ["launched", "Critical"],
      ]),
    },
  },
  { id: "field_owner", name: "Email", type: "email", width: 230 },
  {
    id: "field_date",
    name: "Submitted",
    type: "date",
    config: { dateStyle: "dateTime" },
    width: 190,
  },
  {
    id: "field_progress",
    name: "Sentiment",
    type: "percent",
    config: { precision: 0 },
    width: 140,
  },
  {
    id: "field_tags",
    name: "Product areas",
    type: "multiSelect",
    config: {
      options: selectOptions([
        ["web", "Workspace"],
        ["mobile", "Mobile"],
        ["email", "Forms"],
        ["community", "AI assistant"],
      ]),
    },
    width: 220,
  },
  { id: "field_notes", name: "Feedback", type: "longText" },
  {
    id: "field_assets",
    name: "Attachments",
    type: "attachment",
    config: { attachmentKind: "any" },
  },
])

const launches = [
  ["Workspace templates", "launched", "Maya Chen", 0.96, ["web", "community"]],
  ["Mobile inbox", "review", "Alex Morgan", 0.82, ["mobile"]],
  ["Form analytics", "building", "Priya Shah", 0.64, ["web", "email"]],
  ["Bulk record import", "building", "Noah Williams", 0.48, ["web"]],
  ["AI field insights", "planning", "Maya Chen", 0.24, ["web", "mobile"]],
  ["Customer portal", "planning", "Elena Rossi", 0.12, ["web"]],
  ["Weekly digest", "review", "Noah Williams", 0.88, ["email"]],
  ["Public API refresh", "building", "Alex Morgan", 0.53, ["web", "community"]],
] as const

export const DEMO_RECORDS: GridRecord[] = recordsFor("table_launches", 80, (index) => {
  const launch = launches[index % launches.length]
  const cycle = Math.floor(index / launches.length)
  return {
    launch_name: cycle ? `${launch[0]} · phase ${cycle + 1}` : launch[0],
    launch_status: launch[1],
    launch_owner: launch[2],
    launch_date: now + (index - 20) * day,
    launch_progress: Math.max(0, Math.min(1, launch[3] - cycle * 0.04)),
    launch_channels: [...launch[4]],
    launch_notes:
      index % 3 === 0
        ? "Coordinate the release brief, QA checklist, and customer communication."
        : "",
    launch_assets: [],
  }
})

const feedbackNames = [
  "Amina Hassan",
  "Ben Carter",
  "Camila Torres",
  "Daniel Kim",
  "Ella Thompson",
  "Farah Ali",
  "George Evans",
  "Hana Sato",
  "Isaac Reed",
  "Julia Novak",
  "Kareem Rahman",
  "Lena Fischer",
] as const
const feedbackNotes = [
  "The new workspace flow is much easier to scan during our weekly planning.",
  "Bulk editing would remove the last manual step in our launch checklist.",
  "The mobile layout is clear, but saved filters would make it faster.",
  "Form analytics helped us spot where respondents were dropping off.",
  "Please add a compact density option for teams working with long tables.",
  "The assistant summary is useful when it links back to the source records.",
  "Keyboard navigation made the review workflow noticeably quicker.",
  "We need more control over notification frequency for larger teams.",
] as const
const feedbackRecords = recordsFor("table_feedback", 168, (index) => {
  const name = feedbackNames[index % feedbackNames.length]
  const emailName = name.toLowerCase().replaceAll(" ", ".")
  const channelSets = [
    ["web"],
    ["mobile"],
    ["email"],
    ["community"],
    ["web", "email"],
    ["web", "community"],
  ] as const
  return {
    field_name: name,
    field_status: ["planning", "building", "review", "launched"][
      (index * 3) % 4
    ],
    field_owner: `${emailName}@example.com`,
    field_date: now - ((index * 17) % 180) * day - (index % 12) * 60 * minute,
    field_progress: 0.52 + ((index * 7) % 47) / 100,
    field_tags: [...channelSets[index % channelSets.length]],
    field_notes: feedbackNotes[(index * 5) % feedbackNotes.length],
    field_assets: [],
  }
})

const roadmapFields = fieldSet([
  {
    id: "roadmap_initiative",
    name: "Initiative",
    type: "singleLineText",
    width: 260,
    primary: true,
  },
  {
    id: "roadmap_horizon",
    name: "Horizon",
    type: "singleSelect",
    config: {
      options: selectOptions([
        ["now", "Now"],
        ["next", "Next"],
        ["later", "Later"],
        ["exploring", "Exploring"],
      ]),
    },
  },
  {
    id: "roadmap_themes",
    name: "Themes",
    type: "multiSelect",
    config: {
      options: selectOptions([
        ["growth", "Growth"],
        ["reliability", "Reliability"],
        ["collaboration", "Collaboration"],
        ["ai", "AI"],
        ["platform", "Platform"],
      ]),
    },
    width: 220,
  },
  {
    id: "roadmap_impact",
    name: "Impact score",
    type: "number",
    config: { precision: 0 },
  },
  {
    id: "roadmap_confidence",
    name: "Confidence",
    type: "percent",
    config: { precision: 0 },
  },
  {
    id: "roadmap_committed",
    name: "Committed",
    type: "checkbox",
    width: 120,
  },
  {
    id: "roadmap_target",
    name: "Target",
    type: "date",
    config: { dateStyle: "date" },
  },
  {
    id: "roadmap_budget",
    name: "Budget",
    type: "currency",
    config: { currency: "USD", precision: 0 },
  },
  { id: "roadmap_brief", name: "Brief", type: "url", width: 240 },
  {
    id: "roadmap_files",
    name: "Discovery files",
    type: "attachment",
    config: { attachmentKind: "any" },
  },
])
const roadmapInitiatives = [
  "Workspace permissions",
  "Automated field suggestions",
  "Record change history",
  "Enterprise SSO controls",
  "Cross-base reporting",
  "Offline mobile editing",
  "Form branching logic",
  "Data import assistant",
  "Reusable automations",
  "Regional data hosting",
] as const
const roadmapRecords = recordsFor("table_roadmap", 180, (index) => {
  const cycle = Math.floor(index / roadmapInitiatives.length) + 1
  const themeSets = [
    ["growth", "collaboration"],
    ["reliability"],
    ["platform", "ai"],
    ["growth"],
    ["collaboration", "platform"],
  ] as const
  return {
    roadmap_initiative: `${roadmapInitiatives[index % roadmapInitiatives.length]} · discovery ${cycle}`,
    roadmap_horizon: ["now", "next", "later", "exploring"][index % 4],
    roadmap_themes: [...themeSets[index % themeSets.length]],
    roadmap_impact: 3 + ((index * 7) % 8),
    roadmap_confidence: 0.46 + ((index * 13) % 51) / 100,
    roadmap_committed: index % 4 === 0 || index % 7 === 0,
    roadmap_target: now + ((index % 240) - 30) * day,
    roadmap_budget: 18_000 + ((index * 4_750) % 142_000),
    roadmap_brief: `https://example.com/roadmap/discovery-${index + 1}`,
    roadmap_files: [],
  }
})

const calendarFields = fieldSet([
  {
    id: "calendar_title",
    name: "Content",
    type: "singleLineText",
    width: 280,
    primary: true,
  },
  {
    id: "calendar_stage",
    name: "Stage",
    type: "singleSelect",
    config: {
      options: selectOptions([
        ["idea", "Idea"],
        ["drafting", "Drafting"],
        ["review", "Review"],
        ["scheduled", "Scheduled"],
        ["published", "Published"],
      ]),
    },
  },
  {
    id: "calendar_channels",
    name: "Channels",
    type: "multiSelect",
    config: {
      options: selectOptions([
        ["blog", "Blog"],
        ["linkedin", "LinkedIn"],
        ["youtube", "YouTube"],
        ["newsletter", "Newsletter"],
        ["community", "Community"],
      ]),
    },
    width: 220,
  },
  {
    id: "calendar_publish_date",
    name: "Publish date",
    type: "date",
    config: { dateStyle: "dateTime" },
    width: 190,
  },
  { id: "calendar_owner", name: "Owner email", type: "email", width: 230 },
  {
    id: "calendar_completion",
    name: "Completion",
    type: "percent",
    config: { precision: 0 },
  },
  {
    id: "calendar_ready",
    name: "Approved",
    type: "checkbox",
    width: 120,
  },
  { id: "calendar_brief", name: "Brief URL", type: "url", width: 240 },
  { id: "calendar_notes", name: "Editorial notes", type: "longText" },
  {
    id: "calendar_creative",
    name: "Creative",
    type: "attachment",
    config: { attachmentKind: "image" },
  },
])
const contentTitles = [
  "How modern teams structure product feedback",
  "Behind the build: multiplayer editing",
  "A practical guide to public forms",
  "Five workflows for launch planning",
  "Customer research without spreadsheet sprawl",
  "From raw records to useful AI insights",
  "Designing a clean content operating system",
  "What we learned from 100 product interviews",
] as const
const calendarRecords = recordsFor("table_content_calendar", 120, (index) => {
  const channelSets = [
    ["blog", "newsletter"],
    ["linkedin"],
    ["youtube", "community"],
    ["blog", "linkedin", "community"],
    ["newsletter"],
  ] as const
  const stage = ["idea", "drafting", "review", "scheduled", "published"][
    (index * 2) % 5
  ]
  return {
    calendar_title: `${contentTitles[index % contentTitles.length]} · ${Math.floor(index / contentTitles.length) + 1}`,
    calendar_stage: stage,
    calendar_channels: [...channelSets[index % channelSets.length]],
    calendar_publish_date: now + (index - 35) * day,
    calendar_owner: [
      "maya@example.com",
      "alex@example.com",
      "priya@example.com",
      "noah@example.com",
    ][index % 4],
    calendar_completion:
      stage === "published"
        ? 1
        : stage === "scheduled"
          ? 0.9
          : 0.18 + ((index * 11) % 68) / 100,
    calendar_ready: stage === "scheduled" || stage === "published",
    calendar_brief: `https://example.com/content/brief-${index + 1}`,
    calendar_notes:
      index % 3 === 0
        ? "Include one customer example, a clear takeaway, and supporting product screenshots."
        : "Review the opening hook and confirm the call to action before scheduling.",
    calendar_creative: [],
  }
})

const channelFields = fieldSet([
  {
    id: "channel_name",
    name: "Channel",
    type: "singleLineText",
    width: 230,
    primary: true,
  },
  {
    id: "channel_type",
    name: "Type",
    type: "singleSelect",
    config: {
      options: selectOptions([
        ["owned", "Owned"],
        ["organic", "Organic"],
        ["paid", "Paid"],
        ["partner", "Partner"],
      ]),
    },
  },
  {
    id: "channel_formats",
    name: "Formats",
    type: "multiSelect",
    config: {
      options: selectOptions([
        ["short", "Short form"],
        ["long", "Long form"],
        ["video", "Video"],
        ["live", "Live"],
        ["email", "Email"],
      ]),
    },
    width: 220,
  },
  {
    id: "channel_audience",
    name: "Audience",
    type: "number",
    config: { precision: 0 },
  },
  {
    id: "channel_budget",
    name: "Monthly budget",
    type: "currency",
    config: { currency: "USD", precision: 0 },
    width: 180,
  },
  {
    id: "channel_health",
    name: "Health",
    type: "percent",
    config: { precision: 0 },
  },
  { id: "channel_active", name: "Active", type: "checkbox", width: 110 },
  { id: "channel_owner", name: "Owner", type: "email", width: 220 },
  { id: "channel_playbook", name: "Playbook", type: "url", width: 240 },
])
const channelNames = [
  "Product newsletter",
  "LinkedIn",
  "YouTube",
  "Customer community",
  "Partner network",
  "Founder podcast",
] as const
const channelRecords = recordsFor("table_content_channels", 66, (index) => {
  const market = ["Global", "North America", "EMEA", "APAC"][
    Math.floor(index / channelNames.length) % 4
  ]
  const formatSets = [
    ["email", "long"],
    ["short", "video"],
    ["video", "long"],
    ["live", "short"],
  ] as const
  return {
    channel_name: `${channelNames[index % channelNames.length]} · ${market} ${Math.floor(index / 24) + 1}`,
    channel_type: ["owned", "organic", "paid", "partner"][index % 4],
    channel_formats: [...formatSets[index % formatSets.length]],
    channel_audience: 8_500 + ((index * 13_741) % 890_000),
    channel_budget: 1_200 + ((index * 2_350) % 48_000),
    channel_health: 0.51 + ((index * 17) % 48) / 100,
    channel_active: index % 8 !== 0,
    channel_owner: [
      "content@example.com",
      "growth@example.com",
      "community@example.com",
    ][index % 3],
    channel_playbook: `https://example.com/playbooks/channel-${index + 1}`,
  }
})

const interviewFields = fieldSet([
  {
    id: "interview_participant",
    name: "Participant",
    type: "singleLineText",
    width: 230,
    primary: true,
  },
  {
    id: "interview_segment",
    name: "Segment",
    type: "singleSelect",
    config: {
      options: selectOptions([
        ["startup", "Startup"],
        ["scaleup", "Scale-up"],
        ["enterprise", "Enterprise"],
        ["agency", "Agency"],
      ]),
    },
  },
  {
    id: "interview_topics",
    name: "Topics",
    type: "multiSelect",
    config: {
      options: selectOptions([
        ["onboarding", "Onboarding"],
        ["collaboration", "Collaboration"],
        ["reporting", "Reporting"],
        ["forms", "Forms"],
        ["ai", "AI"],
      ]),
    },
    width: 220,
  },
  {
    id: "interview_date",
    name: "Interview date",
    type: "date",
    config: { dateStyle: "dateTime" },
    width: 190,
  },
  {
    id: "interview_duration",
    name: "Minutes",
    type: "number",
    config: { precision: 0 },
    width: 120,
  },
  { id: "interview_email", name: "Email", type: "email", width: 230 },
  { id: "interview_phone", name: "Phone", type: "phone", width: 170 },
  { id: "interview_consent", name: "Consent", type: "checkbox", width: 110 },
  {
    id: "interview_transcript",
    name: "Transcript",
    type: "url",
    width: 240,
  },
  { id: "interview_summary", name: "Summary", type: "longText" },
  {
    id: "interview_recording",
    name: "Recording",
    type: "attachment",
    config: { attachmentKind: "file" },
  },
])
const participantFirstNames = [
  "Amelia",
  "Bilal",
  "Chloe",
  "Diego",
  "Emi",
  "Fatima",
  "Gabriel",
  "Harper",
  "Ibrahim",
  "Joana",
] as const
const participantLastNames = [
  "Anderson",
  "Bennett",
  "Costa",
  "Diaz",
  "El-Sayed",
  "Foster",
  "Gupta",
  "Hughes",
] as const
const interviewRecords = recordsFor("table_customer_interviews", 320, (index) => {
  const first = participantFirstNames[index % participantFirstNames.length]
  const last =
    participantLastNames[
      Math.floor(index / participantFirstNames.length) %
        participantLastNames.length
    ]
  const topicSets = [
    ["onboarding", "collaboration"],
    ["reporting"],
    ["forms", "ai"],
    ["collaboration", "reporting"],
    ["onboarding", "forms"],
  ] as const
  return {
    interview_participant: `${first} ${last} · ${Math.floor(index / 80) + 1}`,
    interview_segment: ["startup", "scaleup", "enterprise", "agency"][
      (index * 3) % 4
    ],
    interview_topics: [...topicSets[index % topicSets.length]],
    interview_date: now - ((index * 5) % 365) * day - (index % 8) * 60 * minute,
    interview_duration: 25 + ((index * 7) % 51),
    interview_email: `${first}.${last.replaceAll("-", "")}${index + 1}@example.com`.toLowerCase(),
    interview_phone: `+1 555 ${String(100 + (index % 900))} ${String(1000 + ((index * 37) % 9000))}`,
    interview_consent: index % 17 !== 0,
    interview_transcript: `https://example.com/research/interview-${index + 1}`,
    interview_summary:
      index % 2 === 0
        ? "The participant values a fast setup and clear ownership across collaborative workflows."
        : "Reporting flexibility matters most when the team shares results outside the product group.",
    interview_recording: [],
  }
})

const insightFields = fieldSet([
  {
    id: "insight_title",
    name: "Insight",
    type: "singleLineText",
    width: 300,
    primary: true,
  },
  {
    id: "insight_theme",
    name: "Theme",
    type: "singleSelect",
    config: {
      options: selectOptions([
        ["activation", "Activation"],
        ["collaboration", "Collaboration"],
        ["trust", "Trust"],
        ["reporting", "Reporting"],
        ["automation", "Automation"],
      ]),
    },
  },
  {
    id: "insight_sources",
    name: "Evidence",
    type: "multiSelect",
    config: {
      options: selectOptions([
        ["interview", "Interview"],
        ["support", "Support"],
        ["survey", "Survey"],
        ["analytics", "Analytics"],
      ]),
    },
    width: 210,
  },
  {
    id: "insight_frequency",
    name: "Mentions",
    type: "number",
    config: { precision: 0 },
  },
  {
    id: "insight_confidence",
    name: "Confidence",
    type: "percent",
    config: { precision: 0 },
  },
  { id: "insight_validated", name: "Validated", type: "checkbox", width: 120 },
  {
    id: "insight_observed",
    name: "First observed",
    type: "date",
    config: { dateStyle: "date" },
  },
  { id: "insight_source_url", name: "Source", type: "url", width: 240 },
  { id: "insight_detail", name: "Detail", type: "longText" },
  {
    id: "insight_files",
    name: "Evidence files",
    type: "attachment",
    config: { attachmentKind: "any" },
  },
])
const insightTitles = [
  "Teams need an obvious first successful workflow",
  "Shared views create confidence during handoffs",
  "People trust AI summaries when sources stay visible",
  "Flexible forms reduce manual intake work",
  "Reporting is strongest when filters are reusable",
  "Permissions should match how teams already collaborate",
  "Mobile users prioritize quick review over configuration",
  "Templates shorten time to value for new teams",
] as const
const insightRecords = recordsFor("table_customer_insights", 320, (index) => {
  const evidenceSets = [
    ["interview", "survey"],
    ["support"],
    ["analytics", "interview"],
    ["survey", "support"],
  ] as const
  return {
    insight_title: `${insightTitles[index % insightTitles.length]} · signal ${Math.floor(index / insightTitles.length) + 1}`,
    insight_theme: ["activation", "collaboration", "trust", "reporting", "automation"][
      (index * 2) % 5
    ],
    insight_sources: [...evidenceSets[index % evidenceSets.length]],
    insight_frequency: 4 + ((index * 11) % 93),
    insight_confidence: 0.48 + ((index * 7) % 51) / 100,
    insight_validated: index % 3 !== 0,
    insight_observed: now - ((index * 13) % 540) * day,
    insight_source_url: `https://example.com/research/insight-${index + 1}`,
    insight_detail:
      "This pattern appeared across multiple customer conversations and was checked against product usage or support evidence.",
    insight_files: [],
  }
})

const segmentFields = fieldSet([
  {
    id: "segment_name",
    name: "Segment",
    type: "singleLineText",
    width: 250,
    primary: true,
  },
  {
    id: "segment_lifecycle",
    name: "Lifecycle",
    type: "singleSelect",
    config: {
      options: selectOptions([
        ["emerging", "Emerging"],
        ["growing", "Growing"],
        ["established", "Established"],
        ["watch", "Watch"],
      ]),
    },
  },
  {
    id: "segment_needs",
    name: "Core needs",
    type: "multiSelect",
    config: {
      options: selectOptions([
        ["speed", "Speed"],
        ["governance", "Governance"],
        ["automation", "Automation"],
        ["reporting", "Reporting"],
        ["integrations", "Integrations"],
      ]),
    },
    width: 230,
  },
  {
    id: "segment_customers",
    name: "Customers",
    type: "number",
    config: { precision: 0 },
  },
  {
    id: "segment_arr",
    name: "ARR",
    type: "currency",
    config: { currency: "USD", precision: 0 },
  },
  {
    id: "segment_retention",
    name: "Retention",
    type: "percent",
    config: { precision: 0 },
  },
  {
    id: "segment_research",
    name: "Active research",
    type: "checkbox",
    width: 140,
  },
  { id: "segment_owner", name: "Owner", type: "email", width: 220 },
  { id: "segment_profile", name: "Profile", type: "url", width: 240 },
])
const segmentNames = [
  "Product-led startups",
  "Scaling operations teams",
  "Enterprise transformation",
  "Creative agencies",
  "Customer success leaders",
  "Research-heavy product teams",
  "Distributed marketing teams",
] as const
const segmentRecords = recordsFor("table_customer_segments", 84, (index) => {
  const region = ["Global", "North America", "EMEA", "APAC"][
    Math.floor(index / segmentNames.length) % 4
  ]
  const needSets = [
    ["speed", "automation"],
    ["governance", "reporting"],
    ["integrations", "automation"],
    ["speed", "integrations"],
  ] as const
  return {
    segment_name: `${segmentNames[index % segmentNames.length]} · ${region} ${Math.floor(index / 28) + 1}`,
    segment_lifecycle: ["emerging", "growing", "established", "watch"][
      index % 4
    ],
    segment_needs: [...needSets[index % needSets.length]],
    segment_customers: 45 + ((index * 137) % 4_200),
    segment_arr: 120_000 + ((index * 178_000) % 8_500_000),
    segment_retention: 0.72 + ((index * 5) % 27) / 100,
    segment_research: index % 5 !== 0,
    segment_owner: [
      "research@example.com",
      "product@example.com",
      "strategy@example.com",
    ][index % 3],
    segment_profile: `https://example.com/segments/profile-${index + 1}`,
  }
})

const requestFields = fieldSet([
  {
    id: "request_title",
    name: "Request",
    type: "singleLineText",
    width: 300,
    primary: true,
  },
  {
    id: "request_status",
    name: "Status",
    type: "singleSelect",
    config: {
      options: selectOptions([
        ["new", "New"],
        ["triage", "Triage"],
        ["planned", "Planned"],
        ["shipped", "Shipped"],
        ["declined", "Declined"],
      ]),
    },
  },
  {
    id: "request_segments",
    name: "Segments",
    type: "multiSelect",
    config: {
      options: selectOptions([
        ["startup", "Startup"],
        ["scaleup", "Scale-up"],
        ["enterprise", "Enterprise"],
        ["agency", "Agency"],
      ]),
    },
    width: 210,
  },
  {
    id: "request_votes",
    name: "Votes",
    type: "number",
    config: { precision: 0 },
  },
  {
    id: "request_arr",
    name: "ARR influence",
    type: "currency",
    config: { currency: "USD", precision: 0 },
    width: 170,
  },
  {
    id: "request_date",
    name: "Submitted",
    type: "date",
    config: { dateStyle: "date" },
  },
  { id: "request_requester", name: "Requester", type: "email", width: 230 },
  {
    id: "request_customer_url",
    name: "Customer",
    type: "url",
    width: 240,
  },
  { id: "request_accepted", name: "Accepted", type: "checkbox", width: 120 },
  { id: "request_context", name: "Context", type: "longText" },
  {
    id: "request_files",
    name: "Files",
    type: "attachment",
    config: { attachmentKind: "any" },
  },
])
const requestTitles = [
  "Add conditional form questions",
  "Support shared saved filters",
  "Export dashboard charts",
  "Allow comments on individual cells",
  "Send scheduled workspace digests",
  "Add SSO group mapping",
  "Create reusable automation recipes",
  "Offer a compact mobile review mode",
  "Show source links in AI answers",
  "Add regional date and number formats",
  "Support cross-base linked records",
  "Provide an audit log export",
] as const
const requestRecords = recordsFor("table_customer_requests", 480, (index) => {
  const segmentSets = [
    ["startup"],
    ["scaleup", "enterprise"],
    ["agency"],
    ["enterprise"],
    ["startup", "scaleup"],
  ] as const
  const status = ["new", "triage", "planned", "shipped", "declined"][
    (index * 3) % 5
  ]
  return {
    request_title: `${requestTitles[index % requestTitles.length]} · request ${Math.floor(index / requestTitles.length) + 1}`,
    request_status: status,
    request_segments: [...segmentSets[index % segmentSets.length]],
    request_votes: 1 + ((index * 19) % 248),
    request_arr: 2_500 + ((index * 29_500) % 1_250_000),
    request_date: now - ((index * 3) % 720) * day,
    request_requester: `customer.${String(index + 1).padStart(3, "0")}@example.com`,
    request_customer_url: `https://example.com/customers/account-${index + 1}`,
    request_accepted: status === "planned" || status === "shipped",
    request_context:
      index % 2 === 0
        ? "The team currently completes this workflow manually across several tools."
        : "This request would shorten the reporting cycle and improve stakeholder visibility.",
    request_files: [],
  }
})

export const DEMO_TABLE_DATA: Record<string, DemoTableData> = {
  table_launches: {
    fields: launchFields,
    records: DEMO_RECORDS,
  },
  table_feedback: {
    fields: DEMO_FIELDS,
    records: feedbackRecords,
  },
  table_roadmap: {
    fields: roadmapFields,
    records: roadmapRecords,
  },
  table_content_calendar: {
    fields: calendarFields,
    records: calendarRecords,
  },
  table_content_channels: {
    fields: channelFields,
    records: channelRecords,
  },
  table_customer_interviews: {
    fields: interviewFields,
    records: interviewRecords,
  },
  table_customer_insights: {
    fields: insightFields,
    records: insightRecords,
  },
  table_customer_segments: {
    fields: segmentFields,
    records: segmentRecords,
  },
  table_customer_requests: {
    fields: requestFields,
    records: requestRecords,
  },
}

export const DEMO_FORM: FormDefinition = {
  id: "form_launch_feedback",
  baseId: "base_product",
  tableId: "table_feedback",
  name: "Launch feedback",
  title: "Tell us what you think",
  description:
    "Your feedback goes straight to our product team. It should take less than two minutes.",
  submitLabel: "Send feedback",
  thankYouTitle: "Thank you for your feedback",
  thankYouMessage: "This demo response was not saved or sent.",
  publicSlug: "launch-feedback-demo",
  status: "published",
  version: 3,
  theme: {
    accent: "#6d5dfc",
    background: "#f6f5ff",
    layout: "card",
    hideBranding: false,
  },
  questions: [
    {
      id: "question_name",
      fieldId: "field_name",
      label: "What should we call you?",
      helpText: "A first name is perfect.",
      required: true,
      rank: "a",
    },
    {
      id: "question_notes",
      fieldId: "field_notes",
      label: "What would make this launch more useful?",
      helpText: "Share a workflow, blocker, or feature request.",
      required: true,
      rank: "b",
    },
    {
      id: "question_status",
      fieldId: "field_status",
      label: "How urgent is this for your team?",
      helpText: "",
      required: false,
      rank: "c",
    },
    {
      id: "question_assets",
      fieldId: "field_assets",
      label: "Attach a screenshot or file",
      helpText: "Up to 25 MB.",
      required: false,
      rank: "d",
    },
  ],
}

export const DEMO_ANALYTICS = Array.from({ length: 14 }, (_, index) => {
  const views = 42 + ((index * 17) % 36)
  const submissions = Math.round(views * (0.38 + (index % 4) * 0.035))
  return {
    date: new Date(now - (13 - index) * day).toISOString().slice(0, 10),
    views,
    starts: Math.round(views * 0.72),
    submissions,
    conversion: Math.round((submissions / views) * 1000) / 10,
  }
})
