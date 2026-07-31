import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react"
import { getFunctionName } from "convex/server"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ConnectedFormsList } from "@/components/connected/forms-list"

const mocks = vi.hoisted(() => ({
  archive: vi.fn(async () => null),
  copyPublicLink: vi.fn(async () => undefined),
  create: vi.fn(async () => "form_created"),
  duplicate: vi.fn(async () => ({
    formId: "form_copy",
    name: "Customer intake copy",
  })),
  push: vi.fn(),
  replace: vi.fn(),
  restore: vi.fn(async () => ({
    formId: "form_archived",
    name: "Previous feedback",
    status: "closed" as const,
  })),
  useAuth: vi.fn(),
  useConnectionState: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}))

vi.mock("@clerk/nextjs", () => ({
  useAuth: mocks.useAuth,
}))

vi.mock("next/navigation", () => ({
  usePathname: () => "/bases/base_demo/forms",
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  useSearchParams: mocks.useSearchParams,
}))

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
  }),
  useConvexConnectionState: mocks.useConnectionState,
  useMutation: mocks.useMutation,
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

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)
HTMLElement.prototype.scrollIntoView = vi.fn()

const currentForm = {
  _creationTime: 1,
  _id: "form_current",
  allowMultipleSubmissions: false,
  appearance: {
    accentColor: "#111111",
    backgroundColor: "#ffffff",
    buttonLabel: "Submit",
    layout: "centered",
  },
  baseId: "base_demo",
  createdByUserId: "person",
  draftRevision: 2,
  name: "Customer intake",
  orgId: "organization",
  rank: "a",
  slug: "private-address",
  status: "published" as const,
  stats: {
    views: 200,
    submissions: 50,
    conversionRate: 0.25,
  },
  tableId: "table_customers",
  thankYou: {
    message: "Thank you",
    title: "Received",
  },
  title: "Tell us about your request",
  updatedAt: 100,
}

describe("ConnectedFormsList lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: mocks.copyPublicLink },
    })
    mocks.useAuth.mockReturnValue({
      isLoaded: true,
      orgId: "organization",
      orgRole: "org:admin",
    })
    mocks.useConnectionState.mockReturnValue({
      connectionRetries: 0,
      hasEverConnected: true,
      inflightMutations: 0,
      isWebSocketConnected: true,
      timeOfOldestInflightRequest: null,
    })
    mocks.useSearchParams.mockReturnValue(new URLSearchParams())
    mocks.useQuery.mockImplementation((reference) => {
      switch (getFunctionName(reference)) {
        case "bases:get":
          return { _id: "base_demo", name: "Customer operations" }
        case "tables:list":
          return [{ _id: "table_customers", name: "Customer requests" }]
        case "forms:list":
          return [currentForm]
        case "forms:listArchived":
          return [
            {
              archivedAt: 50,
              formId: "form_archived",
              name: "Previous feedback",
              tableName: "Customer requests",
              title: "Share your feedback",
              willRestoreAs: "Closed",
            },
          ]
        default:
          return undefined
      }
    })
    mocks.useMutation.mockImplementation((reference) => {
      switch (getFunctionName(reference)) {
        case "forms:archive":
          return mocks.archive
        case "forms:duplicate":
          return mocks.duplicate
        case "forms:restore":
          return mocks.restore
        case "forms:create":
          return mocks.create
        default:
          throw new Error(`Unexpected mutation: ${getFunctionName(reference)}`)
      }
    })
  })

  afterEach(cleanup)

  it("explains and performs duplicate, archive, and restore actions by name", async () => {
    const { container } = render(<ConnectedFormsList baseId="base_demo" />)

    fireEvent.click(
      screen.getByRole("button", { name: "Duplicate Customer intake" }),
    )
    expect(
      screen.getByText(/new, unpublished draft with the same questions/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Responses and response history are not copied/i),
    ).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", { name: "Create draft copy" }),
    )

    await waitFor(() => {
      expect(mocks.duplicate).toHaveBeenCalledWith({
        afterRank: "a",
        formId: "form_current",
      })
      expect(mocks.push).toHaveBeenCalledWith(
        "/bases/base_demo/forms/form_copy",
      )
    })

    fireEvent.click(
      screen.getByRole("button", { name: "Archive Customer intake" }),
    )
    expect(
      screen.getByText(/public link will stop accepting responses/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/responses, analytics, and version history are kept/i),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Archive form" }))

    await waitFor(() =>
      expect(mocks.archive).toHaveBeenCalledWith({
        formId: "form_current",
      }),
    )

    fireEvent.click(screen.getByRole("button", { name: /Archived forms/ }))
    expect(screen.getByText("Previous feedback")).toBeInTheDocument()
    expect(screen.getByText(/Customer requests · Archived/)).toBeInTheDocument()
    expect(screen.getByText("Restores as closed")).toBeInTheDocument()
    expect(
      screen.getByRole("button", {
        name: "View Previous feedback analytics",
      }),
    ).toHaveAttribute(
      "href",
      "/bases/base_demo/forms/form_archived/analytics",
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Restore Previous feedback" }),
    )

    await waitFor(() =>
      expect(mocks.restore).toHaveBeenCalledWith({
        formId: "form_archived",
      }),
    )

    expect(container.textContent).not.toContain("form_current")
    expect(container.textContent).not.toContain("form_archived")
    expect(container.textContent).not.toContain("table_customers")
    expect(container.textContent).not.toContain("private-address")
  })

  it("shows readable activity and copies the public link by form name", async () => {
    const { container } = render(<ConnectedFormsList baseId="base_demo" />)

    expect(
      screen.getByLabelText("Customer intake activity"),
    ).toHaveTextContent("50")
    expect(
      screen.getByLabelText("Customer intake activity"),
    ).toHaveTextContent("25.0%")
    expect(
      screen.getByRole("button", { name: "Form analytics" }),
    ).toHaveAttribute("href", "/bases/base_demo/forms/analytics")

    fireEvent.click(
      screen.getByRole("button", {
        name: "Copy public link for Customer intake",
      }),
    )
    await waitFor(() =>
      expect(mocks.copyPublicLink).toHaveBeenCalledWith(
        `${window.location.origin}/f/private-address`,
      ),
    )
    expect(container.textContent).not.toContain("private-address")
  })

  it("keeps lifecycle controls admin-only", () => {
    mocks.useAuth.mockReturnValue({
      isLoaded: true,
      orgId: "organization",
      orgRole: "org:member",
    })

    render(<ConnectedFormsList baseId="base_demo" />)

    expect(
      screen.queryByRole("button", { name: /Archived forms/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /Duplicate Customer intake/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /Archive Customer intake/ }),
    ).not.toBeInTheDocument()
  })

  it("keeps a new form draft intact while writes are paused and creates it after recovery", async () => {
    mocks.useConnectionState.mockReturnValue({
      connectionRetries: 1,
      hasEverConnected: true,
      inflightMutations: 0,
      isWebSocketConnected: false,
      timeOfOldestInflightRequest: null,
    })
    mocks.useSearchParams.mockReturnValue(
      new URLSearchParams("action=new-form"),
    )

    const view = render(<ConnectedFormsList baseId="base_demo" />)
    const dialog = screen.getByRole("dialog", {
      name: "Create a public form",
    })
    fireEvent.change(
      within(dialog).getByLabelText("Form name"),
      { target: { value: "Partner applications" } },
    )
    fireEvent.click(
      within(dialog).getByRole("combobox", {
        name: "Save responses in",
      }),
    )
    fireEvent.click(
      await screen.findByRole("option", {
        name: "Customer requests",
      }),
    )

    expect(
      within(dialog).getByRole("button", { name: "Create form" }),
    ).toBeDisabled()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(screen.getByText(/Form changes are paused/i)).toHaveTextContent(
      /wait for the status to say Live/i,
    )

    mocks.useConnectionState.mockReturnValue({
      connectionRetries: 0,
      hasEverConnected: true,
      inflightMutations: 0,
      isWebSocketConnected: true,
      timeOfOldestInflightRequest: null,
    })
    view.rerender(<ConnectedFormsList baseId="base_demo" />)

    const recoveredDialog = screen.getByRole("dialog", {
      name: "Create a public form",
    })
    expect(
      within(recoveredDialog).getByLabelText("Form name"),
    ).toHaveValue("Partner applications")
    const createButton = within(recoveredDialog).getByRole("button", {
      name: "Create form",
    })
    expect(createButton).toBeEnabled()
    fireEvent.click(createButton)

    await waitFor(() => {
      expect(mocks.create).toHaveBeenCalledWith({
        afterRank: "a",
        name: "Partner applications",
        tableId: "table_customers",
      })
      expect(mocks.push).toHaveBeenCalledWith(
        "/bases/base_demo/forms/form_created",
      )
    })
  })

  it("blocks duplicate, archive, and restore confirmations until the connection is live", () => {
    mocks.useConnectionState.mockReturnValue({
      connectionRetries: 1,
      hasEverConnected: true,
      inflightMutations: 0,
      isWebSocketConnected: false,
      timeOfOldestInflightRequest: null,
    })

    render(<ConnectedFormsList baseId="base_demo" />)

    fireEvent.click(
      screen.getByRole("button", { name: "Duplicate Customer intake" }),
    )
    expect(
      screen.getByRole("button", { name: "Create draft copy" }),
    ).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))

    fireEvent.click(
      screen.getByRole("button", { name: "Archive Customer intake" }),
    )
    expect(
      screen.getByRole("button", { name: "Archive form" }),
    ).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))

    fireEvent.click(screen.getByRole("button", { name: /Archived forms/ }))
    expect(
      screen.getByRole("button", { name: "Restore Previous feedback" }),
    ).toBeDisabled()
    expect(mocks.duplicate).not.toHaveBeenCalled()
    expect(mocks.archive).not.toHaveBeenCalled()
    expect(mocks.restore).not.toHaveBeenCalled()
  })
})
