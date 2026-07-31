import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ConnectedFormAnalytics } from "@/components/connected/form-analytics"

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useQuery: vi.fn(),
}))

vi.mock("@clerk/nextjs", () => ({
  useAuth: mocks.useAuth,
}))

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
  }),
  useQuery: mocks.useQuery,
}))

vi.mock("@/components/connected/assistant-sheet", () => ({
  ConnectedAssistantSheet: () => null,
}))

vi.mock("@/components/connected/org-states", () => ({
  ActiveOrganizationRequired: () => <div>Choose a workspace</div>,
  ConnectedLoading: ({ label }: { label?: string }) => (
    <div>{label ?? "Loading"}</div>
  ),
  ConnectedTopBar: ({ children }: { children?: ReactNode }) => (
    <header>{children}</header>
  ),
  SignedOutState: () => <div>Sign in</div>,
}))

const report = {
  timeZone: "Asia/Dubai",
  form: {
    name: "Post-event survey",
    statusLabel: "Archived",
  },
  fromDay: "2026-07-24",
  toDay: "2026-07-30",
  totals: {
    views: 15,
    starts: 9,
    submissions: 2,
    validationErrors: 1,
    abandonments: 3,
  },
  comparison: {
    fromDay: "2026-07-17",
    toDay: "2026-07-23",
    metrics: [
      {
        label: "Unique views",
        current: 15,
        previous: 8,
        change: 7,
        percentChange: 7 / 8,
      },
      {
        label: "Form starts",
        current: 9,
        previous: 5,
        change: 4,
        percentChange: 0.8,
      },
      {
        label: "Submissions",
        current: 2,
        previous: 1,
        change: 1,
        percentChange: 1,
      },
      {
        label: "Validation errors",
        current: 1,
        previous: 2,
        change: -1,
        percentChange: -0.5,
      },
      {
        label: "Tracked exits",
        current: 3,
        previous: 2,
        change: 1,
        percentChange: 0.5,
      },
    ],
    primaryRate: {
      label: "Completion from starts",
      current: 2 / 9,
      previous: 1 / 5,
      pointChange: 2 / 9 - 1 / 5,
    },
    note: "Compared with Jul 17 through Jul 23.",
  },
  funnel: {
    steps: [
      { label: "Unique views", count: 15, rateFromPrevious: null },
      { label: "Started", count: 9, rateFromPrevious: 0.6 },
      { label: "Submitted", count: 2, rateFromPrevious: 2 / 9 },
    ],
    primaryRateLabel: "Completion from starts",
    primaryRate: 2 / 9,
    note: "Completion compares submitted responses with people who started the form.",
  },
  series: Array.from({ length: 7 }, (_, index) => ({
    date: `2026-07-${String(24 + index).padStart(2, "0")}`,
    views: index === 1 ? 10 : index === 3 ? 5 : 0,
    starts: index === 1 ? 6 : index === 3 ? 3 : 0,
    submissions: index === 1 || index === 3 ? 1 : 0,
    validationErrors: index === 1 ? 1 : 0,
    abandonments: index === 1 ? 2 : index === 3 ? 1 : 0,
  })),
  breakdowns: {
    devices: {
      items: [
        { label: "Desktop", count: 10, share: 2 / 3 },
        { label: "Mobile", count: 5, share: 1 / 3 },
      ],
      measuredViews: 15,
      classifiedViews: 15,
      sampleLimited: false,
      note: "Visits are grouped into broad categories.",
    },
    trafficSources: {
      items: [
        { label: "Search", count: 8, share: 8 / 15 },
        { label: "Direct", count: 7, share: 7 / 15 },
      ],
      measuredViews: 15,
      classifiedViews: 15,
      sampleLimited: false,
      note: "Visits are grouped into broad categories.",
    },
  },
  questionAbandonment: {
    items: [
      {
        question: "What stopped you?",
        count: 2,
        share: 2 / 3,
      },
    ],
    total: 3,
    attributed: 2,
    sampleLimited: false,
    note: "Question exits are best-effort counts.",
  },
  topAnswers: [
    {
      question: "How did you hear about us?",
      answerStyle: "Single choice",
      answeredResponses: 2,
      answers: [{ answer: "Website", count: 2, share: 1 }],
    },
  ],
  responseTiming: {
    latestSubmittedAt: Date.parse("2026-07-27T12:00:00.000Z"),
    responsesInLastSevenDays: 2,
    medianGapMinutes: 3_000,
    analyzedResponses: 2,
    sampleLimited: false,
  },
  privacy: {
    rawEventsStored: false,
    uniqueVisitorsTracked: true,
    visitorDedupe: "best_effort_daily",
    referrersTracked: false,
    rawReferrersStored: false,
    rawDeviceDetailsStored: false,
    questionAnswersStoredInEvents: false,
    visitorDedupeRetentionDays: 100,
    aggregateRetention: "Aggregate counts remain available with the form.",
  },
}

describe("ConnectedFormAnalytics", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useAuth.mockReturnValue({
      has: ({ feature }: { feature: string }) =>
        feature === "form_analytics" || feature === "ai_assistant",
      isLoaded: true,
      orgId: "organization",
    })
    mocks.useQuery.mockImplementation(
      (_query, args: Record<string, unknown>) =>
        "baseId" in args ? report : { timeZone: "Asia/Dubai" },
    )
  })

  afterEach(cleanup)

  it("shows a friendly complete report without exposing internal references", () => {
    const { container } = render(
      <ConnectedFormAnalytics baseId="base_private" formId="form_private" />,
    )

    expect(screen.getByRole("heading", { name: "Post-event survey" }))
      .toBeInTheDocument()
    expect(screen.getByText("Archived")).toBeInTheDocument()
    expect(screen.getByText("Last 30 days")).toBeInTheDocument()
    expect(screen.getAllByText("Completion from starts").length).toBeGreaterThan(0)
    expect(screen.getByText("How did you hear about us?")).toBeInTheDocument()
    expect(screen.getByText("Website")).toBeInTheDocument()
    expect(screen.getByText("Device category")).toBeInTheDocument()
    expect(screen.getByText("Desktop")).toBeInTheDocument()
    expect(screen.getByText("Traffic source")).toBeInTheDocument()
    expect(screen.getByText("Search")).toBeInTheDocument()
    expect(screen.getByText("Question exits")).toBeInTheDocument()
    expect(screen.getByText("What stopped you?")).toBeInTheDocument()
    expect(screen.getByText("+87.5% vs previous")).toBeInTheDocument()
    expect(screen.getByText("Response timing")).toBeInTheDocument()
    expect(screen.getByText("2.1 days")).toBeInTheDocument()
    expect(
      screen.getByText(/Jul 24, 2026 – Jul 30, 2026/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Asia\/Dubai/)).toBeInTheDocument()

    const queryArgs = mocks.useQuery.mock.calls.find(
      (call) => "baseId" in (call[1] as Record<string, unknown>),
    )?.[1]
    expect(queryArgs).toMatchObject({
      baseId: "base_private",
      formId: "form_private",
    })
    expect(container.textContent).not.toMatch(
      /base_private|form_private|best_effort_daily|private-address/,
    )
  })

  it("applies friendly custom dates without exposing internal values", async () => {
    render(
      <ConnectedFormAnalytics baseId="base_private" formId="form_private" />,
    )

    fireEvent.click(
      screen.getByRole("combobox", { name: "Analytics date range" }),
    )
    const customOption = screen.getByRole("option", { name: "Custom dates" })
    fireEvent.pointerDown(customOption, { pointerType: "mouse" })
    fireEvent.click(customOption)
    await waitFor(() =>
      expect(screen.getByLabelText("Start date")).toBeInTheDocument(),
    )
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2026-07-01" },
    })
    fireEvent.change(screen.getByLabelText("End date"), {
      target: { value: "2026-07-15" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Apply dates" }))

    const latestSummaryArgs = [...mocks.useQuery.mock.calls]
      .reverse()
      .find((call) => "baseId" in (call[1] as Record<string, unknown>))?.[1]
    expect(latestSummaryArgs).toMatchObject({
      fromDay: "2026-07-01",
      toDay: "2026-07-15",
    })
  })

  it("downloads an aggregate CSV report", () => {
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:form-analytics")
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {})
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {})
    render(
      <ConnectedFormAnalytics baseId="base_private" formId="form_private" />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }))

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:form-analytics")
  })

  it("uses a calm loading message while the report is prepared", () => {
    mocks.useQuery.mockReturnValue(undefined)

    render(
      <ConnectedFormAnalytics baseId="base_private" formId="form_private" />,
    )

    expect(screen.getByText("Preparing your form report…")).toBeInTheDocument()
  })

  it("shows an actionable customer-safe error state", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.useQuery.mockImplementation(() => {
      throw new Error("FORM_NOT_FOUND internal details")
    })

    const { container } = render(
      <ConnectedFormAnalytics baseId="base_private" formId="form_private" />,
    )

    expect(
      screen.getByRole("heading", { name: "We couldn’t load this report" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Try again" }))
      .toBeInTheDocument()
    expect(container.textContent).not.toContain("FORM_NOT_FOUND")
    consoleError.mockRestore()
  })
})
