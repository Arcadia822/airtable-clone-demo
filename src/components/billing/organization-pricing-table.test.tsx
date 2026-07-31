import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { OrganizationPricingTable } from "./organization-pricing-table"

type MockPlan = {
  id: string
  slug: string
  fee?: {
    amount: number
    amountFormatted: string
    currency: string
    currencySymbol: string
  }
  annualFee?: {
    amount: number
    amountFormatted: string
    currency: string
    currencySymbol: string
  }
}

const mocks = vi.hoisted(() => ({
  auth: {
    has: vi.fn(() => false),
    isLoaded: true,
    orgId: "organization_1" as string | null,
    orgRole: "org:admin" as string | null,
  },
  convexAuth: {
    isAuthenticated: true,
    isLoading: false,
  },
  plans: {
    data: [
      { id: "plan_starter", slug: "starter" },
      { id: "plan_pro", slug: "pro" },
    ] as MockPlan[],
    error: undefined as Error | undefined,
    isLoading: false,
  },
}))

vi.mock("@clerk/nextjs", () => ({
  SignInButton: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => mocks.auth,
  useOrganization: () => ({
    organization: { name: "Northstar Studio" },
  }),
}))

vi.mock("convex/react", () => ({
  useConvexAuth: () => mocks.convexAuth,
}))

vi.mock("@clerk/nextjs/experimental", () => ({
  CheckoutButton: ({
    children,
    planId,
  }: {
    children: React.ReactNode
    planId: string
  }) => <div data-checkout-plan={planId}>{children}</div>,
  SubscriptionDetailsButton: ({
    children,
  }: {
    children: React.ReactNode
  }) => children,
  usePlans: () => mocks.plans,
  useSubscription: () => ({
    data: { status: "active" },
    isLoading: false,
  }),
}))

describe("OrganizationPricingTable", () => {
  beforeEach(() => {
    mocks.auth.has.mockReturnValue(false)
    mocks.auth.isLoaded = true
    mocks.auth.orgId = "organization_1"
    mocks.auth.orgRole = "org:admin"
    mocks.convexAuth.isAuthenticated = true
    mocks.convexAuth.isLoading = false
    mocks.plans.data = [
      { id: "plan_starter", slug: "starter" },
      { id: "plan_pro", slug: "pro" },
    ]
    mocks.plans.error = undefined
    mocks.plans.isLoading = false
  })

  afterEach(cleanup)

  it("keeps custom cards visible and connects named choices to Clerk checkout", () => {
    render(<OrganizationPricingTable clerkEnabled />)

    expect(
      screen.getByRole("heading", {
        name: "One workspace. Three clear plans.",
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Free" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Starter" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Pro" })).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Choose Starter" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Choose Pro" }),
    ).toBeInTheDocument()
    expect(
      document.querySelector('[data-checkout-plan="plan_starter"]'),
    ).toBeInTheDocument()
    expect(
      document.querySelector('[data-checkout-plan="plan_pro"]'),
    ).toBeInTheDocument()
    expect(screen.queryByText("Sign in")).not.toBeInTheDocument()
  })

  it("keeps comparison cards readable but disables unresolved upgrades", () => {
    mocks.plans.data = [{ id: "plan_starter", slug: "starter" }]

    render(<OrganizationPricingTable clerkEnabled />)

    expect(
      screen.getByText("Some upgrades are temporarily unavailable"),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Upgrade unavailable" }),
    ).toBeDisabled()
    expect(screen.getByRole("heading", { name: "Pro" })).toBeInTheDocument()
  })

  it("shows the exact Clerk catalog price on custom cards", async () => {
    mocks.plans.data = [
      {
        id: "plan_starter",
        slug: "starter",
        fee: {
          amount: 1_900,
          amountFormatted: "19.00",
          currency: "USD",
          currencySymbol: "$",
        },
        annualFee: {
          amount: 18_996,
          amountFormatted: "189.96",
          currency: "USD",
          currencySymbol: "$",
        },
      },
      {
        id: "plan_pro",
        slug: "pro",
        fee: {
          amount: 5_900,
          amountFormatted: "59.00",
          currency: "USD",
          currencySymbol: "$",
        },
        annualFee: {
          amount: 59_004,
          amountFormatted: "590.04",
          currency: "USD",
          currencySymbol: "$",
        },
      },
    ]

    render(<OrganizationPricingTable clerkEnabled />)
    screen.getByRole("button", { name: /Annual/ }).click()

    expect(await screen.findByText("$189.96 billed annually")).toBeVisible()
    expect(screen.getByText("$590.04 billed annually")).toBeVisible()
  })
})
