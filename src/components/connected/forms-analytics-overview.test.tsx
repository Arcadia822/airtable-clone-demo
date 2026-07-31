import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react"
import { getFunctionName } from "convex/server"
import type { ReactNode } from "react"
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import { ConnectedFormsAnalyticsOverview } from "@/components/connected/forms-analytics-overview"

const mocks = vi.hoisted(() => ({
  hasAnalytics: true,
  push: vi.fn(),
  useQuery: vi.fn(),
}))

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: vi.fn(),
    has: ({ feature }: { feature: string }) =>
      feature === "form_analytics" && mocks.hasAnalytics,
    isLoaded: true,
    isSignedIn: true,
    orgId: "organization",
    sessionId: "session",
  }),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}))

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
  }),
  useQuery: mocks.useQuery,
}))

vi.mock("@/components/connected/org-states", () => ({
  ActiveOrganizationRequired: () => <div>Choose a workspace</div>,
  ConnectedLoading: ({ label }: { label?: string }) => (
    <div>{label ?? "Loading"}</div>
  ),
  ConnectedTopBar: ({ children }: { children?: ReactNode }) => (
    <header>{children}</header>
  ),
  OrganizationConnectionRecovery: () => <div>Reconnect</div>,
  SignedOutState: () => <div>Sign in</div>,
}))

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)
HTMLElement.prototype.scrollIntoView = vi.fn()

const forms = [
  {
    _id: "form_launch_internal",
    name: "Launch intake",
    title: "Tell us what should ship",
    status: "published",
    tableId: "table_launch_internal",
    stats: {
      views: 80,
      submissions: 20,
      conversionRate: 0.25,
    },
  },
  {
    _id: "form_feedback_internal",
    name: "Customer feedback",
    title: "Share your experience",
    status: "closed",
    tableId: "table_feedback_internal",
    stats: {
      views: 20,
      submissions: 5,
      conversionRate: 0.25,
    },
  },
]

describe("ConnectedFormsAnalyticsOverview", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.hasAnalytics = true
    mocks.useQuery.mockImplementation((reference) => {
      switch (getFunctionName(reference)) {
        case "bases:get":
          return {
            _id: "base_internal",
            name: "Product operations",
          }
        case "forms:list":
          return forms
        case "tables:list":
          return [
            {
              _id: "table_launch_internal",
              name: "Launch schedule",
            },
            {
              _id: "table_feedback_internal",
              name: "Feedback inbox",
            },
          ]
        default:
          return undefined
      }
    })
  })

  afterEach(cleanup)

  it("shows an all-forms overview and opens a named report from the selector", () => {
    const { container } = render(
      <ConnectedFormsAnalyticsOverview baseId="base_internal" />,
    )

    expect(
      screen.getByRole("heading", { name: "Form analytics" }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText("All forms summary")).toHaveTextContent(
      "100",
    )
    expect(screen.getByLabelText("All forms summary")).toHaveTextContent(
      "25",
    )
    expect(screen.getByLabelText("All forms summary")).toHaveTextContent(
      "25.0%",
    )
    expect(
      screen.getByRole("link", {
        name: "View Launch intake analytics",
      }),
    ).toHaveAttribute(
      "href",
      "/bases/base_internal/forms/form_launch_internal/analytics",
    )

    fireEvent.click(
      screen.getByRole("combobox", { name: "Jump to a report" }),
    )
    expect(
      screen.getAllByText("Customer feedback").length,
    ).toBeGreaterThan(0)
    fireEvent.click(
      screen
        .getAllByText("Customer feedback")
        .find((element) => element.closest('[role="option"]'))!,
    )
    expect(mocks.push).toHaveBeenCalledWith(
      "/bases/base_internal/forms/form_feedback_internal/analytics",
    )

    expect(container.textContent).not.toMatch(
      /base_internal|form_launch_internal|form_feedback_internal|table_launch_internal|table_feedback_internal/i,
    )
  })

  it("keeps workspace analytics behind the Clerk organization entitlement", () => {
    mocks.hasAnalytics = false
    render(<ConnectedFormsAnalyticsOverview baseId="base_internal" />)

    expect(screen.getByText("Unlock form analytics")).toBeInTheDocument()
    expect(mocks.useQuery).not.toHaveBeenCalled()
  })
})
