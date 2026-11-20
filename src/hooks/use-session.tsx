"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"

export interface ClientVisitor {
  userId: string
  email: string
  name: string
  orgId: string
}

export interface SessionState {
  loading: boolean
  authenticated: boolean
  visitor: ClientVisitor | null
  authMode: "factory" | "local"
  originDenied: boolean
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

const SessionContext = createContext<SessionState>({
  loading: true,
  authenticated: false,
  visitor: null,
  authMode: "local",
  originDenied: false,
  refresh: async () => {},
  logout: async () => {},
})

export function SessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [visitor, setVisitor] = useState<ClientVisitor | null>(null)
  const [authMode, setAuthMode] = useState<"factory" | "local">("local")
  const [originDenied, setOriginDenied] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store" })
      const data = (await response.json().catch(() => ({}))) as {
        visitor?: ClientVisitor | null
        authMode?: "factory" | "local"
        originDenied?: boolean
      }
      setAuthMode(data.authMode ?? "local")
      setOriginDenied(Boolean(data.originDenied))
      if (response.ok && data.visitor) {
        setVisitor(data.visitor)
      } else {
        setVisitor(null)
      }
    } catch {
      setVisitor(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined)
    await refresh()
  }, [refresh])

  useEffect(() => {
    // Defer the probe so the session request runs after the first paint.
    const handle = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(handle)
  }, [refresh])

  return (
    <SessionContext.Provider
      value={{
        loading,
        authenticated: Boolean(visitor),
        visitor,
        authMode,
        originDenied,
        refresh,
        logout,
      }}
    >
      {children}
    </SessionContext.Provider>
  )
}

export function useSession(): SessionState {
  return useContext(SessionContext)
}
