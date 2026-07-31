import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { MarketingHeader } from "@/components/marketing-header"

const authState = vi.hoisted(() => ({
  isAuthenticated: false,
  isLoading: false,
}))

vi.mock("convex/react", () => ({
  useConvexAuth: () => authState,
}))

vi.mock("@clerk/nextjs", () => ({
  OrganizationSwitcher: () => <div data-testid="organization-switcher" />,
  UserButton: () => <div data-testid="user-button" />,
}))

describe("MarketingHeader", () => {
  afterEach(cleanup)

  beforeEach(() => {
    authState.isAuthenticated = false
    authState.isLoading = false
  })

  it("shows signed-out actions after Convex confirms there is no authenticated session", () => {
    render(<MarketingHeader active="pricing" authEnabled />)

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/sign-in",
    )
    expect(
      screen.getByRole("link", { name: /Create workspace/ }),
    ).toHaveAttribute("href", "/onboarding")
    expect(
      screen.getByRole("link", { name: "Pricing" }),
    ).toHaveAttribute("aria-current", "page")
    expect(screen.queryByTestId("user-button")).not.toBeInTheDocument()
  })

  it("never flashes a stale sign-in action while Convex is checking the token", () => {
    authState.isLoading = true

    render(<MarketingHeader authEnabled />)

    expect(
      screen.getByRole("status", { name: "Checking your session" }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: "Sign in" }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: /Create workspace/ }),
    ).not.toBeInTheDocument()
  })

  it("replaces sign-in with workspace, organization, and user controls once Convex authenticates", () => {
    authState.isAuthenticated = true

    render(<MarketingHeader authEnabled />)

    expect(
      screen.getByRole("link", { name: "Open workspace" }),
    ).toHaveAttribute("href", "/dashboard")
    expect(screen.getByTestId("organization-switcher")).toBeInTheDocument()
    expect(screen.getByTestId("user-button")).toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: "Sign in" }),
    ).not.toBeInTheDocument()
  })

  it("keeps a usable signed-out header when connected auth is not configured", () => {
    authState.isAuthenticated = true

    render(<MarketingHeader authEnabled={false} />)

    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument()
    expect(screen.queryByTestId("user-button")).not.toBeInTheDocument()
  })
})
