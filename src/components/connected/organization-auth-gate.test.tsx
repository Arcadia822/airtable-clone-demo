import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  ORGANIZATION_AUTH_RECOVERY_TIMEOUT_MS,
  OrganizationAuthGate,
} from "@/components/connected/organization-auth-gate"

const mocks = vi.hoisted(() => ({
  auth: {
    getToken: vi.fn(),
    isLoaded: true,
    isSignedIn: true as boolean | undefined,
    orgId: "org_workspace" as string | null,
    orgRole: "org:admin" as string | null,
    sessionId: "session_current" as string | null,
  },
  convexAuth: {
    isAuthenticated: true,
    isLoading: false,
  },
}))

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => mocks.auth,
}))

vi.mock("convex/react", () => ({
  useConvexAuth: () => mocks.convexAuth,
}))

vi.mock("@/components/connected/org-states", () => ({
  ActiveOrganizationRequired: () => <div>Choose a workspace</div>,
  ConnectedLoading: ({ label }: { label?: string }) => (
    <div>{label ?? "Opening workspace…"}</div>
  ),
  OrganizationConnectionRecovery: ({
    onReload,
    onRetry,
  }: {
    onReload: () => void
    onRetry: () => void
  }) => (
    <div>
      <p>Workspace is taking longer to open</p>
      <button onClick={onRetry}>Try again</button>
      <button onClick={onReload}>Reload page</button>
    </div>
  ),
  SignedOutState: () => <div>Sign in to Basecraft</div>,
}))

function renderGate() {
  return render(
    <OrganizationAuthGate>
      {({ orgId }) => <div>Opened {orgId}</div>}
    </OrganizationAuthGate>,
  )
}

beforeEach(() => {
  vi.useRealTimers()
  mocks.auth.getToken.mockReset()
  mocks.auth.getToken.mockResolvedValue("fresh-token")
  Object.assign(mocks.auth, {
    isLoaded: true,
    isSignedIn: true,
    orgId: "org_workspace",
    orgRole: "org:admin",
    sessionId: "session_current",
  })
  Object.assign(mocks.convexAuth, {
    isAuthenticated: true,
    isLoading: false,
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("OrganizationAuthGate", () => {
  it("shows the signed-out state only after both providers have settled", () => {
    mocks.auth.isSignedIn = false
    mocks.auth.orgId = null
    mocks.convexAuth.isAuthenticated = false

    renderGate()

    expect(screen.getByText("Sign in to Basecraft")).toBeInTheDocument()
  })

  it("asks an authenticated user to choose a workspace when none is active", () => {
    mocks.auth.orgId = null

    renderGate()

    expect(screen.getByText("Choose a workspace")).toBeInTheDocument()
  })

  it("refreshes the selected workspace token while Convex validates it", async () => {
    mocks.convexAuth.isAuthenticated = false

    const rendered = renderGate()

    expect(screen.getByText("Finishing workspace setup…")).toBeInTheDocument()
    await waitFor(() =>
      expect(mocks.auth.getToken).toHaveBeenCalledWith({
        skipCache: true,
      }),
    )

    mocks.convexAuth.isAuthenticated = true
    rendered.rerender(
      <OrganizationAuthGate>
        {({ orgId }) => <div>Opened {orgId}</div>}
      </OrganizationAuthGate>,
    )
    expect(screen.getByText("Opened org_workspace")).toBeInTheDocument()
  })

  it("replaces a stalled transition with retry and reload actions", async () => {
    vi.useFakeTimers()
    mocks.convexAuth.isAuthenticated = false
    mocks.convexAuth.isLoading = true

    renderGate()
    await act(async () => {
      vi.advanceTimersByTime(ORGANIZATION_AUTH_RECOVERY_TIMEOUT_MS)
    })

    expect(
      screen.getByText("Workspace is taking longer to open"),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(mocks.auth.getToken).toHaveBeenCalledWith({
      skipCache: true,
    })
    expect(screen.getByText("Finishing workspace setup…")).toBeInTheDocument()
  })

  it("renders protected content only after Convex confirms the session", () => {
    renderGate()

    expect(screen.getByText("Opened org_workspace")).toBeInTheDocument()
    expect(mocks.auth.getToken).not.toHaveBeenCalled()
  })
})
