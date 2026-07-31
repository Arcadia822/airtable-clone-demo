"use client"

import { useAuth } from "@clerk/nextjs"
import { ConvexProviderWithClerk } from "convex/react-clerk"
import { ConvexProvider, ConvexReactClient } from "convex/react"
import { useEffect, useMemo, useState, type ReactNode } from "react"

import { ORGANIZATION_AUTH_REFRESH_EVENT } from "@/lib/organization-auth"

const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL

export function ConvexBridge({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const [manualRefresh, setManualRefresh] = useState(0)
  const client = useMemo(
    () => (convexUrl ? new ConvexReactClient(convexUrl) : null),
    [],
  )
  const authScope = [
    auth.isLoaded ? auth.sessionId ?? "signed-out" : "loading",
    auth.isLoaded ? auth.orgId ?? "no-organization" : "loading",
    manualRefresh,
  ].join(":")

  useEffect(() => {
    const refresh = () => setManualRefresh((current) => current + 1)
    window.addEventListener(ORGANIZATION_AUTH_REFRESH_EVENT, refresh)
    return () =>
      window.removeEventListener(
        ORGANIZATION_AUTH_REFRESH_EVENT,
        refresh,
      )
  }, [])

  if (!client) return children

  return (
    <ConvexProviderWithClerk
      client={client}
      key={authScope}
      useAuth={useAuth}
    >
      {children}
    </ConvexProviderWithClerk>
  )
}

export function PublicConvexBridge({ children }: { children: ReactNode }) {
  const client = useMemo(
    () => (convexUrl ? new ConvexReactClient(convexUrl) : null),
    [],
  )

  if (!client) return children

  return (
    <ConvexProvider client={client}>{children}</ConvexProvider>
  )
}

export const isClerkConfigured = Boolean(clerkPublishableKey)
export const isConvexConfigured = Boolean(convexUrl)
