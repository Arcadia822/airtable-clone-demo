import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { getFunctionName } from "convex/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  ConnectedAppNavigation,
  parseConnectedLocation,
} from "@/components/connected/app-navigation"

const mocks = vi.hoisted(() => ({
  plan: "starter",
  pathname:
    "/bases/base_internal/forms/form_internal/analytics",
  setFavorite: vi.fn(() => Promise.resolve(undefined)),
  trackRouteOpen: vi.fn(() => Promise.resolve(null)),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}))

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    has: ({ plan }: { plan?: string }) => plan === mocks.plan,
    isLoaded: true,
    orgId: "org_internal",
  }),
}))

vi.mock("convex/react", () => ({
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery,
}))

describe("ConnectedAppNavigation", () => {
  beforeEach(() => {
    mocks.plan = "starter"
    mocks.pathname =
      "/bases/base_internal/forms/form_internal/analytics"
    mocks.useMutation.mockImplementation((reference) => {
      switch (getFunctionName(reference)) {
        case "resourcePreferences:trackRouteOpen":
          return mocks.trackRouteOpen
        case "resourcePreferences:setFavorite":
          return mocks.setFavorite
        default:
          return vi.fn()
      }
    })
    mocks.useQuery.mockImplementation((reference, args) => {
      if (args === "skip") return undefined
      switch (getFunctionName(reference)) {
        case "bases:list":
          return [
            {
              _id: "base_internal",
              name: "Product operations",
            },
          ]
        case "tables:list":
          return [
            {
              _id: "table_internal",
              name: "Launch schedule",
            },
            {
              _id: "table_feedback",
              name: "Customer feedback",
            },
          ]
        case "forms:list":
          return [
            {
              _id: "form_internal",
              name: "Launch request",
            },
          ]
        case "resourcePreferences:listNavigation":
          return {
            favorites: [
              {
                resourceType: "base",
                resourceId: "base_favorite",
                name: "North star planning",
                context: "Base",
                href: "/bases/base_favorite",
                isFavorite: true,
                lastOpenedAt: 20,
              },
            ],
            recent: [
              {
                resourceType: "form",
                resourceId: "form_recent",
                name: "Research intake",
                context: "Customer research · Form",
                href: "/bases/base_research/forms/form_recent",
                isFavorite: false,
                lastOpenedAt: 30,
              },
            ],
          }
        default:
          return undefined
      }
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it("shows every relevant destination by name and marks analytics from the URL", () => {
    const { container } = render(<ConnectedAppNavigation />)

    expect(screen.getByRole("link", { name: "Bases" })).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: /Tables.*2 tables/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: /Forms.*1 form/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", {
        name: /Analytics.*Launch request/,
      }),
    ).toHaveAttribute("aria-current", "page")
    expect(
      screen.getByRole("link", {
        name: /Form analytics.*All forms in this base/,
      }),
    ).not.toHaveAttribute("aria-current")
    expect(
      screen.getByRole("link", { name: "Launch schedule" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Customer feedback" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: /Upgrade.*Compare with Pro/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: /North star planning.*Base/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", {
        name: /Research intake.*Customer research.*Form/,
      }),
    ).toBeInTheDocument()
    expect(container.textContent).not.toMatch(
      /base_internal|table_internal|form_internal|Id|slug|key/i,
    )
  })

  it("removes the upgrade destination for an organization already on Pro", () => {
    mocks.plan = "pro"

    render(<ConnectedAppNavigation />)

    expect(
      screen.queryByRole("link", { name: /Upgrade|Plans/i }),
    ).not.toBeInTheDocument()
  })

  it("tracks route opens and exposes friendly star controls", async () => {
    render(<ConnectedAppNavigation />)

    await waitFor(() =>
      expect(mocks.trackRouteOpen).toHaveBeenCalledWith({
        baseId: "base_internal",
        formId: "form_internal",
      }),
    )
    fireEvent.click(
      screen.getByRole("button", {
        name: "Add Launch schedule to favorites",
      }),
    )
    await waitFor(() =>
      expect(mocks.setFavorite).toHaveBeenCalledWith({
        resourceType: "table",
        resourceId: "table_internal",
        favorite: true,
      }),
    )
    expect(
      screen.getByRole("button", {
        name: "Remove North star planning from favorites",
      }),
    ).toHaveAttribute("aria-pressed", "true")
    expect(document.body).not.toHaveTextContent(
      /base_internal|table_internal|form_internal/i,
    )
  })

  it("derives active base, table, and form context from stable routes", () => {
    expect(
      parseConnectedLocation(
        "/bases/base_internal/tables/table_internal",
      ),
    ).toEqual({
      baseId: "base_internal",
      tableId: "table_internal",
    })
    expect(
      parseConnectedLocation(
        "/bases/base_internal/forms/form_internal/submissions",
      ),
    ).toEqual({
      baseId: "base_internal",
      formId: "form_internal",
    })
    expect(
      parseConnectedLocation("/bases/base_internal/forms/analytics"),
    ).toEqual({
      baseId: "base_internal",
    })
    expect(parseConnectedLocation("/dashboard")).toEqual({})
  })
})
