"use client"

import { useAuth } from "@clerk/nextjs"
import { useConvexAuth } from "convex/react"
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import {
  ActiveOrganizationRequired,
  ConnectedLoading,
  OrganizationConnectionRecovery,
  SignedOutState,
} from "@/components/connected/org-states"
import { requestOrganizationAuthRefresh } from "@/lib/organization-auth"

export const ORGANIZATION_AUTH_RECOVERY_TIMEOUT_MS = 8_000

type ClerkAuth = ReturnType<typeof useAuth>

export type OrganizationAuthContext = {
  auth: ClerkAuth
  orgId: string | null
}

export function OrganizationAuthGate({
  children,
  requireOrganization = true,
  signedOutFallback,
}: {
  children: (context: OrganizationAuthContext) => ReactNode
  requireOrganization?: boolean
  signedOutFallback?: ReactNode
}) {
  const auth = useAuth()
  const convexAuth = useConvexAuth()
  const [attempt, setAttempt] = useState(0)
  const {
    getToken,
    isLoaded: clerkLoaded,
    isSignedIn: clerkSignedIn,
    orgId,
    sessionId,
  } = auth

  const clerkSignedOut =
    clerkLoaded && clerkSignedIn === false
  const waitingForClerk = !clerkLoaded
  const waitingForConvex =
    convexAuth.isLoading ||
    (!convexAuth.isAuthenticated && !clerkSignedOut) ||
    (convexAuth.isAuthenticated && clerkSignedOut)
  const pending = waitingForClerk || waitingForConvex
  const pendingKey = pending
    ? [
        sessionId ?? "session",
        orgId ?? "no-organization",
        convexAuth.isAuthenticated ? "connected" : "connecting",
        attempt,
      ].join(":")
    : null
  const [timedOutKey, setTimedOutKey] = useState<string | null>(null)
  const timedOut = pendingKey !== null && timedOutKey === pendingKey
  const shouldRefreshToken =
    clerkLoaded &&
    clerkSignedIn !== false &&
    Boolean(orgId) &&
    !convexAuth.isAuthenticated

  useEffect(() => {
    if (!pendingKey) return
    const timeout = window.setTimeout(() => {
      setTimedOutKey(pendingKey)
    }, ORGANIZATION_AUTH_RECOVERY_TIMEOUT_MS)
    return () => window.clearTimeout(timeout)
  }, [pendingKey])

  useEffect(() => {
    if (!shouldRefreshToken) return
    void getToken({ skipCache: true })
      .catch(() => undefined)
  }, [
    getToken,
    orgId,
    shouldRefreshToken,
  ])

  const retry = useCallback(() => {
    setAttempt((current) => current + 1)
    if (!clerkLoaded || clerkSignedIn === false) return
    void getToken({ skipCache: true })
      .catch(() => undefined)
      .finally(requestOrganizationAuthRefresh)
  }, [clerkLoaded, clerkSignedIn, getToken])

  const reload = useCallback(() => {
    window.location.reload()
  }, [])

  const context = useMemo<OrganizationAuthContext>(
    () => ({
      auth,
      orgId: orgId ?? null,
    }),
    [auth, orgId],
  )

  if (timedOut) {
    return (
      <OrganizationConnectionRecovery
        onReload={reload}
        onRetry={retry}
      />
    )
  }
  if (pending) {
    return (
      <ConnectedLoading
        label={
          orgId
            ? "Finishing workspace setup…"
            : "Opening workspace…"
        }
      />
    )
  }
  if (!convexAuth.isAuthenticated) {
    return signedOutFallback ?? <SignedOutState />
  }
  if (requireOrganization && !orgId) {
    return <ActiveOrganizationRequired />
  }
  return children(context)
}
