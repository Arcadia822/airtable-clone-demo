import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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

import { ConnectedFormSubmissions } from "@/components/connected/form-submissions"

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  query: vi.fn(),
  loadMore: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  search: "",
}))

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    isLoaded: true,
    orgId: "organization",
  }),
}))

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
  }),
  usePaginatedQuery: () => ({
    loadMore: mocks.loadMore,
    results: [
      {
        submissionId: "submission_internal",
        recordId: "record_internal",
        submittedAt: Date.UTC(2026, 6, 30, 12),
        version: 3,
        responseLabel: "Acme rollout",
        recordStatus: "active",
      },
    ],
    status: "CanLoadMore",
  }),
  useConvex: () => ({ query: mocks.query }),
  useQuery: mocks.useQuery,
}))

vi.mock("next/navigation", () => ({
  usePathname: () =>
    "/bases/base_internal/forms/form_internal/submissions",
  useRouter: () => ({
    push: mocks.push,
    replace: mocks.replace,
  }),
  useSearchParams: () => new URLSearchParams(mocks.search),
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

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)
HTMLElement.prototype.scrollIntoView = vi.fn()
Element.prototype.getAnimations = vi.fn(() => [])

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.search = ""
})

function setupQueries() {
  mocks.query.mockResolvedValue({
    formName: "Campaign intake",
    columns: ["Campaign name", "Priority"],
    rows: [
      {
        submittedAt: Date.UTC(2026, 6, 30, 12),
        version: 3,
        responseLabel: "Acme rollout",
        answers: ["Acme rollout", "High"],
      },
    ],
    truncated: false,
  })
  mocks.useQuery.mockImplementation((reference, args) => {
    if (args === "skip") return undefined
    switch (getFunctionName(reference)) {
      case "forms:getSubmissionWorkspace":
        return {
          formName: "Campaign intake",
          formStatus: "published",
          baseId: "base_internal",
          baseName: "Marketing",
          tableId: "table_internal",
          tableName: "Campaigns",
        }
      case "forms:getSubmission":
        return {
          submittedAt: Date.UTC(2026, 6, 30, 12),
          version: 3,
          responseLabel: "Acme rollout",
          recordId: "record_internal",
          recordStatus: "active",
          baseId: "base_internal",
          tableId: "table_internal",
          tableName: "Campaigns",
          answers: [
            {
              question: "Campaign name",
              displayValue: "Acme rollout",
              hasAnswer: true,
              automatic: false,
            },
            {
              question: "Source",
              displayValue: "Website",
              hasAnswer: true,
              automatic: true,
            },
          ],
        }
      default:
        return undefined
    }
  })
}

describe("ConnectedFormSubmissions", () => {
  it("shows readable responses and named details without exposing internal keys", () => {
    setupQueries()
    mocks.search = "response=submission_internal"
    const { container } = render(
      <ConnectedFormSubmissions
        baseId="base_internal"
        formId="form_internal"
      />,
    )

    expect(container.querySelector("h1")).toHaveTextContent(
      "Campaign intake",
    )
    expect(screen.getByText("Campaign name")).toBeInTheDocument()
    expect(screen.getByText("Automatic value")).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: /Open record in Campaigns/i }),
    ).toBeInTheDocument()
    expect(container.textContent).not.toContain("record_internal")
    expect(container.textContent).not.toContain("table_internal")
  })

  it("opens responses in shareable URL state and restores that state by URL", () => {
    setupQueries()
    const { rerender } = render(
      <ConnectedFormSubmissions
        baseId="base_internal"
        formId="form_internal"
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: /Acme rollout/i }))
    expect(mocks.push).toHaveBeenCalledWith(
      "/bases/base_internal/forms/form_internal/submissions?response=submission_internal",
      { scroll: false },
    )

    mocks.search = "response=submission_internal"
    rerender(
      <ConnectedFormSubmissions
        baseId="base_internal"
        formId="form_internal"
      />,
    )
    expect(screen.getByText("Campaign name")).toBeInTheDocument()

    mocks.search = ""
    rerender(
      <ConnectedFormSubmissions
        baseId="base_internal"
        formId="form_internal"
      />,
    )
    const closedDetailCall = mocks.useQuery.mock.calls
      .filter(
        ([reference]) =>
          getFunctionName(reference) === "forms:getSubmission",
      )
      .at(-1)
    expect(closedDetailCall?.[1]).toBe("skip")
    expect(
      screen.queryByRole("dialog", { name: /Response details/i }),
    ).not.toBeInTheDocument()

    mocks.search = "response=submission_internal"
    rerender(
      <ConnectedFormSubmissions
        baseId="base_internal"
        formId="form_internal"
      />,
    )
    const restoredDetailCall = mocks.useQuery.mock.calls
      .filter(
        ([reference]) =>
          getFunctionName(reference) === "forms:getSubmission",
      )
      .at(-1)
    expect(restoredDetailCall?.[1]).toEqual({
      formId: "form_internal",
      submissionId: "submission_internal",
    })

    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    expect(mocks.replace).toHaveBeenCalledWith(
      "/bases/base_internal/forms/form_internal/submissions",
      { scroll: false },
    )
  })

  it("downloads a response CSV on demand and keeps pagination explicit", async () => {
    setupQueries()
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:form-responses")
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {})
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {})

    render(
      <ConnectedFormSubmissions
        baseId="base_internal"
        formId="form_internal"
      />,
    )

    fireEvent.click(
      screen.getByRole("button", { name: "Download responses" }),
    )
    await waitFor(() =>
      expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob)),
    )
    expect(mocks.query).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:form-responses")

    fireEvent.click(
      screen.getByRole("button", { name: "Load more responses" }),
    )
    expect(mocks.loadMore).toHaveBeenCalledWith(25)
  })
})
