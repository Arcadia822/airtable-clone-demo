import { cookies } from "next/headers"

import { AppError } from "@/lib/domain"

export const VISITOR_STATE_COOKIE = "__Host-generated-visitor-state"
export const VISITOR_RETURN_COOKIE = "__Host-generated-visitor-return"

export interface AuthenticatedSession {
  authenticated: true
  userId: string
  email: string
  name: string
  orgId: string
  authMode: "factory" | "local"
}

export interface UnauthenticatedSession {
  authenticated: false
  authMode: "factory"
  originDenied?: boolean
}

export type ServerSession = AuthenticatedSession | UnauthenticatedSession

export function isFactoryAuthConfigured(): boolean {
  return Boolean(
    process.env.FACTORY_VISITOR_AUTH_URL?.trim() &&
      process.env.FACTORY_VISITOR_AUTH_TOKEN?.trim(),
  )
}

export function getFactoryAuthConfig(): { url: string; token: string } | null {
  const url = process.env.FACTORY_VISITOR_AUTH_URL?.trim().replace(/\/+$/, "")
  const token = process.env.FACTORY_VISITOR_AUTH_TOKEN?.trim()
  if (!url || !token) return null
  return { url, token }
}

export function resolveAppOrigin(request?: Request): string {
  const previewHost = process.env.FACTORY_PREVIEW_HOST?.trim()
  if (previewHost) {
    return previewHost.startsWith("http://") || previewHost.startsWith("https://")
      ? previewHost.replace(/\/+$/, "")
      : `https://${previewHost}`
  }
  if (request) {
    return new URL(request.url).origin
  }
  return process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") || "http://localhost:3000"
}

export function sanitizeReturnTo(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "/"
  if (!raw.startsWith("/")) return "/"
  if (raw.startsWith("//")) return "/"
  if (raw.includes("\\")) return "/"
  if (/[\u0000-\u001f\u007f]/.test(raw)) return "/"
  return raw
}

export function isOriginDeniedResponse(status: number, bodyText: string): boolean {
  if (status !== 403 && status !== 400) return false
  const lower = bodyText.toLowerCase()
  return (
    lower.includes("origin-denied") ||
    lower.includes("origin_denied") ||
    lower.includes("origin not allowed") ||
    lower.includes("disallowed origin")
  )
}

export async function getServerSession(request?: Request): Promise<ServerSession> {
  const config = getFactoryAuthConfig()
  if (!config) {
    return {
      authenticated: true,
      userId: "local-user",
      email: "local@factory.local",
      name: "Local Workspace",
      orgId: "local-org",
      authMode: "local",
    }
  }

  let cookieHeader = request?.headers.get("cookie") ?? ""
  if (!cookieHeader) {
    try {
      const store = await cookies()
      cookieHeader = store.toString()
    } catch {
      cookieHeader = ""
    }
  }

  const origin = resolveAppOrigin(request)
  const response = await fetch(`${config.url}/session`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "x-factory-visitor-origin": origin,
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
    cache: "no-store",
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    return {
      authenticated: false,
      authMode: "factory",
      originDenied: isOriginDeniedResponse(response.status, text) || undefined,
    }
  }

  const payload = (await response.json().catch(() => null)) as {
    visitor?: {
      id?: string
      userId?: string
      email?: string
      name?: string
      orgId?: string
    }
    userId?: string
    id?: string
    email?: string
    name?: string
    orgId?: string
  } | null

  const visitor = payload?.visitor ?? payload
  const userId = visitor?.userId ?? visitor?.id
  if (!userId) {
    return {
      authenticated: false,
      authMode: "factory",
    }
  }

  const email = visitor?.email ?? `${userId}@visitor.factory`
  const name = visitor?.name ?? email.split("@")[0] ?? "Workspace Member"
  const orgId = visitor?.orgId ?? `org_${userId}`

  return {
    authenticated: true,
    userId,
    email,
    name,
    orgId,
    authMode: "factory",
  }
}

export async function requireSession(request?: Request): Promise<AuthenticatedSession> {
  const session = await getServerSession(request)
  if (!session.authenticated) {
    throw new AppError("UNAUTHORIZED", "Authentication required.")
  }
  return session
}

export function forwardSetCookies(upstream: Response, target: Headers): void {
  const getSetCookie = (upstream.headers as Headers & { getSetCookie?: () => string[] })
    .getSetCookie
  if (typeof getSetCookie === "function") {
    for (const cookie of getSetCookie.call(upstream.headers)) {
      target.append("set-cookie", cookie)
    }
    return
  }
  const single = upstream.headers.get("set-cookie")
  if (single) {
    target.append("set-cookie", single)
  }
}
