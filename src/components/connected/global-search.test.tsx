import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react"
import { getFunctionName } from "convex/server"
import { StrictMode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ConnectedGlobalSearch } from "@/components/connected/global-search"
import { ConnectedTopBar } from "@/components/connected/org-states"

const mocks = vi.hoisted(() => ({
  pathname: "/dashboard",
  push: vi.fn(),
  searchParams: new URLSearchParams(),
  useQuery: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => mocks.searchParams,
}))

vi.mock("convex/react", () => ({
  useConvexConnectionState: () => ({
    connectionRetries: 0,
    hasEverConnected: true,
    inflightMutations: 0,
    isWebSocketConnected: true,
    timeOfOldestInflightRequest: null,
  }),
  useMutation: () => vi.fn(async () => null),
  useQuery: mocks.useQuery,
}))

vi.mock("@clerk/nextjs", () => ({
  OrganizationSwitcher: () => (
    <button type="button">Northstar Studio</button>
  ),
  UserButton: () => <button type="button">Account menu</button>,
  useAuth: () => ({
    has: ({ plan }: { plan?: string }) => plan === "pro",
    isLoaded: true,
    orgId: "org_internal",
  }),
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

const recentDestination = {
  kind: "view",
  name: "Weekly priorities",
  context: "Product operations / Launch schedule",
  detail: "Board view",
  favorite: true,
  href: "/bases/base_internal/tables/table_internal?view=view_internal",
}

describe("connected global search", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.pathname = "/dashboard"
    mocks.searchParams = new URLSearchParams()
    mocks.useQuery.mockImplementation((reference, args) => {
      if (args === "skip") return undefined
      switch (getFunctionName(reference)) {
        case "bases:get":
          return {
            _id: "base_internal",
            name: "Product operations",
          }
        case "tables:list":
          return [
            {
              _id: "table_internal",
              name: "Launch schedule",
            },
          ]
        case "search:recent":
          return [recentDestination]
        case "search:destinations":
          return [
            {
              kind: "table",
              name: "Customer roadmap",
              context: "Product operations",
              detail: "Table",
              href: "/bases/base_internal/tables/table_customer",
            },
            {
              kind: "form",
              name: "Launch request",
              context: "Product operations / Launch schedule",
              detail: "Published form",
              href: "/bases/base_internal/forms/form_internal",
            },
          ]
        default:
          return undefined
      }
    })
  })

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    vi.useRealTimers()
  })

  it("keeps organization controls and active navigation alongside a responsive search trigger", () => {
    render(<ConnectedTopBar />)

    expect(screen.getByText("Northstar Studio")).toBeInTheDocument()
    expect(screen.getByText("Account menu")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Bases" })).toHaveAttribute(
      "aria-current",
      "page",
    )
    const trigger = screen.getByRole("button", {
      name: "Search workspace",
    })
    expect(trigger).toHaveAttribute(
      "aria-keyshortcuts",
      "Meta+K Control+K",
    )
    expect(trigger.className).toContain("min-[920px]:w-44")
  })

  it("restores and updates the collapsed workspace navigation preference", async () => {
    window.localStorage.setItem(
      "basecraft:workspace-navigation",
      "collapsed",
    )

    render(
      <StrictMode>
        <ConnectedTopBar />
      </StrictMode>,
    )
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    const expand = screen.getByRole("button", {
      name: "Expand workspace navigation",
    })
    expect(expand).toBeInTheDocument()
    expect(
      document.documentElement.style.getPropertyValue(
        "--workspace-sidebar-width",
      ),
    ).toBe("4rem")
    expect(
      window.localStorage.getItem("basecraft:workspace-navigation"),
    ).toBe("collapsed")

    fireEvent.click(expand)

    expect(
      screen.getByRole("button", {
        name: "Collapse workspace navigation",
      }),
    ).toBeInTheDocument()
    expect(
      document.documentElement.style.getPropertyValue(
        "--workspace-sidebar-width",
      ),
    ).toBe("15rem")
    expect(
      window.localStorage.getItem("basecraft:workspace-navigation"),
    ).toBe("expanded")
  })

  it("opens from the keyboard and shows recent destinations by friendly name", () => {
    const { container } = render(<ConnectedGlobalSearch />)

    fireEvent.keyDown(window, { key: "k", metaKey: true })

    expect(
      screen.getByRole("dialog", { name: "Search workspace" }),
    ).toBeInTheDocument()
    expect(screen.getByText("Weekly priorities")).toBeInTheDocument()
    expect(
      screen.getByText("Product operations / Launch schedule · Board view"),
    ).toBeInTheDocument()
    expect(screen.getByLabelText("Favorite")).toBeInTheDocument()
    expect(container.textContent).not.toContain("base_internal")
    expect(container.textContent).not.toContain("table_internal")
    expect(container.textContent).not.toContain("view_internal")
  })

  it("offers named create actions for the active table without rendering internal keys", () => {
    mocks.pathname = "/bases/base_internal/tables/table_internal"
    mocks.searchParams = new URLSearchParams("view=view_internal")
    const { container } = render(<ConnectedGlobalSearch />)

    fireEvent.click(
      screen.getByRole("button", { name: "Search workspace" }),
    )

    expect(screen.getByRole("option", { name: /New base/ })).toBeInTheDocument()
    expect(
      screen.getByRole("option", {
        name: /New table.*Add a table to Product operations/,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("option", {
        name: /New form.*Build a public form in Product operations/,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("option", {
        name: /New view.*Create a named view for Launch schedule/,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("option", {
        name: /New record.*Add a row to Launch schedule/,
      }),
    ).toBeInTheDocument()
    expect(container.textContent).not.toMatch(
      /base_internal|table_internal|view_internal|Id|slug|key/i,
    )

    fireEvent.click(screen.getByRole("option", { name: /New view/ }))
    expect(mocks.push).toHaveBeenCalledWith(
      "/bases/base_internal/tables/table_internal?view=view_internal&action=new-view",
    )
  })

  it("searches named destinations after a short pause and navigates to the selection", () => {
    render(<ConnectedGlobalSearch />)
    fireEvent.click(
      screen.getByRole("button", { name: "Search workspace" }),
    )
    fireEvent.change(
      screen.getByPlaceholderText(
        "Search by base, table, view, or form name…",
      ),
      { target: { value: "launch" } },
    )
    act(() => vi.advanceTimersByTime(200))

    expect(screen.getByText("Launch request")).toBeInTheDocument()
    expect(
      screen.getByText(
        "Product operations / Launch schedule · Published form",
      ),
    ).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("option", { name: /Launch request/ }),
    )
    expect(mocks.push).toHaveBeenCalledWith(
      "/bases/base_internal/forms/form_internal",
    )
  })

  it("marks only the matching saved view as the current destination", () => {
    mocks.pathname = "/bases/base_internal/tables/table_internal"
    mocks.searchParams = new URLSearchParams("view=view_internal")
    render(<ConnectedGlobalSearch />)
    fireEvent.click(
      screen.getByRole("button", { name: "Search workspace" }),
    )

    expect(
      screen.getByRole("option", { name: /Weekly priorities/ }),
    ).toHaveAttribute("aria-current", "page")
    expect(screen.getByText("Current")).toBeInTheDocument()
  })
})
