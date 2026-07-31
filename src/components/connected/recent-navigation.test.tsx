import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { getFunctionName } from "convex/server"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ConnectedBaseOverview } from "@/components/connected/base-overview"
import { ConnectedDashboard } from "@/components/connected/dashboard"

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  useAuth: vi.fn(),
  useMutation: vi.fn(),
  useQueries: vi.fn(),
  useQuery: vi.fn(),
}))

vi.mock("@clerk/nextjs", () => ({
  useAuth: mocks.useAuth,
  useOrganization: () => ({
    isLoaded: true,
    organization: { name: "Northstar Studio" },
  }),
}))

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
  }),
  useConvexConnectionState: () => ({
    connectionRetries: 0,
    hasEverConnected: true,
    inflightMutations: 0,
    isWebSocketConnected: true,
    timeOfOldestInflightRequest: null,
  }),
  useMutation: mocks.useMutation,
  useQueries: mocks.useQueries,
  useQuery: mocks.useQuery,
}))

vi.mock("@/components/connected/org-states", () => ({
  ActiveOrganizationRequired: () => <div>Choose a workspace</div>,
  ConnectedLoading: () => <div>Loading</div>,
  ConnectedTopBar: ({ children }: { children?: ReactNode }) => (
    <header>{children}</header>
  ),
  SignedOutState: () => <div>Sign in</div>,
}))

vi.mock("@/components/assistant/floating-assistant-launcher", () => ({
  FloatingAssistantLauncher: () => null,
}))

vi.mock("@/components/connected/assistant-sheet", () => ({
  ConnectedAssistantSheet: () => null,
}))

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)

const base = {
  _creationTime: 1,
  _id: "base_alpha",
  color: "#334155",
  createdByUserId: "person",
  description: "Plan and ship customer work.",
  name: "Product operations",
  orgId: "organization",
  rank: "a",
  status: "active",
  updatedAt: 100,
}

const dashboardBase = {
  baseId: "base_alpha",
  color: "#334155",
  description: "Plan and ship customer work.",
  formCount: 1,
  isFavorite: false,
  lastOpenedAt: 119,
  name: "Product operations",
  rank: "a",
  tableCount: 2,
  updatedAt: 100,
}

const table = {
  _creationTime: 1,
  _id: "table_launches",
  baseId: "base_alpha",
  createdByUserId: "person",
  name: "Launch schedule",
  orgId: "organization",
  primaryFieldId: "field_name",
  rank: "a",
  status: "active",
  updatedAt: 100,
}

const secondTable = {
  ...table,
  _id: "table_research",
  name: "Research backlog",
  rank: "b",
  updatedAt: 110,
}

const form = {
  _creationTime: 1,
  _id: "form_feedback",
  baseId: "base_alpha",
  createdByUserId: "person",
  description: "Collect product feedback.",
  name: "Product feedback",
  orgId: "organization",
  rank: "a",
  stats: {
    conversionRate: 0.5,
    submissions: 42,
    views: 84,
  },
  status: "published",
  tableId: "table_launches",
  theme: {},
  title: "Share feedback",
  updatedAt: 100,
}

let navigationRecent = [
  {
    context: "Product operations",
    href: "/bases/base_alpha/tables/table_research",
    isFavorite: false,
    lastOpenedAt: 120,
    name: "Research backlog",
    resourceId: "table_research",
    resourceType: "table" as const,
  },
  {
    context: "Base",
    href: "/bases/base_alpha",
    isFavorite: false,
    lastOpenedAt: 119,
    name: "Product operations",
    resourceId: "base_alpha",
    resourceType: "base" as const,
  },
  {
    context: "Product operations",
    href: "/bases/base_alpha/tables/table_launches",
    isFavorite: false,
    lastOpenedAt: 118,
    name: "Launch schedule",
    resourceId: "table_launches",
    resourceType: "table" as const,
  },
]
let activeTables = [table, secondTable]

const recentViews = [
  {
    baseId: "base_alpha",
    isFavorite: true,
    lastOpenedAt: 100,
    name: "This quarter",
    tableId: "table_launches",
    type: "kanban",
    viewId: "view_quarter",
    visibility: "shared",
  },
  {
    baseId: "base_elsewhere",
    isFavorite: false,
    lastOpenedAt: 90,
    name: "Other work",
    tableId: "table_elsewhere",
    type: "grid",
    viewId: "view_elsewhere",
    visibility: "shared",
  },
]

describe("recent view navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useAuth.mockReturnValue({
      has: () => true,
      isLoaded: true,
      orgId: "organization",
      orgRole: "org:admin",
    })
    mocks.useMutation.mockReturnValue(vi.fn())
    navigationRecent = [
      {
        context: "Product operations",
        href: "/bases/base_alpha/tables/table_research",
        isFavorite: false,
        lastOpenedAt: 120,
        name: "Research backlog",
        resourceId: "table_research",
        resourceType: "table",
      },
      {
        context: "Base",
        href: "/bases/base_alpha",
        isFavorite: false,
        lastOpenedAt: 119,
        name: "Product operations",
        resourceId: "base_alpha",
        resourceType: "base",
      },
      {
        context: "Product operations",
        href: "/bases/base_alpha/tables/table_launches",
        isFavorite: false,
        lastOpenedAt: 118,
        name: "Launch schedule",
        resourceId: "table_launches",
        resourceType: "table",
      },
    ]
    activeTables = [table, secondTable]
    mocks.useQueries.mockImplementation(
      (queries: Record<string, unknown>) =>
        Object.fromEntries(
          Object.keys(queries).map((key) => {
            if (key === "tables:base_alpha") {
              return [key, activeTables]
            }
            if (key === "forms:base_alpha") {
              return [key, [form]]
            }
            return [key, []]
          }),
        ),
    )
    mocks.useQuery.mockImplementation((reference) => {
      switch (getFunctionName(reference)) {
        case "bases:listDashboardSummaries":
          return [dashboardBase]
        case "bases:list":
          return [base]
        case "bases:get":
          return base
        case "tables:list":
          return activeTables
        case "forms:list":
          return [form]
        case "views:listRecent":
          return recentViews
        case "resourcePreferences:listNavigation":
          return {
            favorites: [],
            recent: navigationRecent,
          }
        default:
          return undefined
      }
    })
  })

  afterEach(cleanup)

  it("shows named recent views across bases on the dashboard", () => {
    const { container } = render(<ConnectedDashboard />)

    expect(
      screen.getByRole("heading", { name: "Jump back in" }),
    ).toBeInTheDocument()
    expect(screen.getByText("This quarter")).toBeInTheDocument()
    expect(screen.getByText("Product operations / Launch schedule")).toBeInTheDocument()
    expect(screen.getByText("Board view")).toBeInTheDocument()
    expect(screen.getByLabelText("Favorite")).toBeInTheDocument()
    expect(screen.getByText("Tables")).toBeInTheDocument()
    expect(screen.getByText("Forms")).toBeInTheDocument()
    const baseLink = screen.getByRole("link", {
      name: "Product operations Base",
    })
    expect(baseLink).toHaveTextContent("2 tables")
    expect(baseLink).toHaveTextContent("1 form")
    expect(baseLink).toHaveAttribute(
      "href",
      "/bases/base_alpha/tables/table_research",
    )
    expect(
      screen.getByRole("link", {
        name: "Open This quarter in Launch schedule",
      }),
    ).toHaveAttribute(
      "href",
      "/bases/base_alpha/tables/table_launches?view=view_quarter",
    )
    expect(container.textContent).not.toContain("base_alpha")
    expect(container.textContent).not.toContain("table_launches")
    expect(container.textContent).not.toContain("view_quarter")
  })

  it("returns a base route to its most recently opened table", async () => {
    render(<ConnectedBaseOverview baseId="base_alpha" />)

    expect(
      screen.getByRole("heading", { name: "Opening Research backlog" }),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith(
        "/bases/base_alpha/tables/table_research",
      )
    })
  })

  it("falls back to the first active table when there is no recent table", async () => {
    navigationRecent = []

    render(<ConnectedBaseOverview baseId="base_alpha" />)

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith(
        "/bases/base_alpha/tables/table_launches",
      )
    })
  })

  it("keeps an empty base on a focused first-table state", () => {
    activeTables = []
    navigationRecent = []

    render(<ConnectedBaseOverview baseId="base_alpha" />)

    expect(
      screen.getByRole("heading", { name: "No tables yet" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Create first table" }),
    ).toBeEnabled()
    expect(mocks.replace).not.toHaveBeenCalled()
  })
})
