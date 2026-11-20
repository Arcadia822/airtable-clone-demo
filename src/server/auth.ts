import { cookies } from "next/headers"

import { AppError } from "@/lib/domain"
import { HttpStatusError, normalizeOrigin } from "@/server/http"

/**
 * Cookie names are decided once per deployment from the configured origin,
 * because the callback route reads the same constant. `__Host-` cookies are
 * only stored by browsers when they are `Secure` and `Path=/`, so an http
 * deployment must use plain names or sign-in silently breaks.
 */
function visitorCookiePrefix(): "" | "__Host-" {
  const origin =
    normalizeOrigin(process.env.FACTORY_PREVIEW_HOST) ??
    normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL)
  return origin?.startsWith("https://") ? "__Host-" : ""
}

const VISITOR_COOKIE_PREFIX = visitorCookiePrefix()

export const VISITOR_STATE_COOKIE = `${VISITOR_COOKIE_PREFIX}generated-visitor-state`
export const VISITOR_RETURN_COOKIE = `${VISITOR_COOKIE_PREFIX}generated-visitor-return`
/** True when the deployment origin is https and `__Host-` semantics apply. */
export const VISITOR_COOKIES_ARE_HOST_PREFIXED = VISITOR_COOKIE_PREFIX === "__Host-"

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

/**
 * `NODE_ENV=production` covers `next build`-style deployments; `VERCEL_ENV` is
 * set on every Vercel deployment (including previews and dev branches), where
 * the process also reports production.
 */
export function isProductionDeployment(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    Boolean(process.env.VERCEL_ENV?.trim())
  )
}

/**
 * Single-tenant "everyone is the local user" mode is a development
 * convenience. It must be opted into explicitly on a deployed environment.
 */
export function isLocalWorkspaceAllowed(): boolean {
  if (process.env.ALLOW_LOCAL_WORKSPACE?.trim() === "1") return true
  return !isProductionDeployment()
}

/**
 * A deployment with neither Factory credentials nor an explicit local-mode
 * opt-in cannot authenticate anyone. Every authenticated route must fail with
 * `AUTH_NOT_CONFIGURED` instead of handing out a local session.
 */
export function isAuthMisconfigured(): boolean {
  return !isFactoryAuthConfigured() && !isLocalWorkspaceAllowed()
}

export function getFactoryAuthConfig(): { url: string; token: string } | null {
  const url = process.env.FACTORY_VISITOR_AUTH_URL?.trim().replace(/\/+$/, "")
  const token = process.env.FACTORY_VISITOR_AUTH_TOKEN?.trim()
  if (!url || !token) return null
  return { url, token }
}

export function resolveAppOrigin(request?: Request): string {
  const previewOrigin = normalizeOrigin(process.env.FACTORY_PREVIEW_HOST)
  if (previewOrigin) return previewOrigin
  if (request) {
    try {
      return new URL(request.url).origin
    } catch {
      // Fall through to the configured origin.
    }
  }
  return normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL) ?? "http://localhost:3000"
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

/**
 * Validates that an upstream `authorizeUrl` points at the configured auth
 * host. Without this an attacker who can influence the upstream response (or a
 * compromised/misconfigured provider) turns the login endpoint into an open
 * redirect. http is only tolerated for a loopback development host.
 */
export function assertTrustedAuthorizeUrl(
  rawAuthorizeUrl: string,
  authUrl: string,
): string {
  let target: URL
  let auth: URL
  try {
    target = new URL(rawAuthorizeUrl)
    auth = new URL(authUrl)
  } catch {
    throw new HttpStatusError(
      "AUTH_START_FAILED",
      "The sign-in provider returned an invalid redirect.",
      502,
    )
  }

  const loopback = target.hostname === "localhost" || target.hostname === "127.0.0.1"
  const protocolAllowed =
    target.protocol === "https:" || (target.protocol === "http:" && loopback)
  if (!protocolAllowed || target.host !== auth.host) {
    throw new HttpStatusError(
      "AUTH_START_FAILED",
      "The sign-in provider returned an untrusted redirect.",
      502,
    )
  }
  return target.toString()
}

export async function getServerSession(request?: Request): Promise<ServerSession> {
  const config = getFactoryAuthConfig()
  if (!config) {
    // Fail closed: a deployed instance without credentials is anonymous, never
    // a local workspace. Callers that need a session get AUTH_NOT_CONFIGURED
    // from `requireSession`.
    if (!isLocalWorkspaceAllowed()) {
      return { authenticated: false, authMode: "factory" }
    }
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
  if (isAuthMisconfigured()) {
    throw new HttpStatusError(
      "AUTH_NOT_CONFIGURED",
      "Authentication is not configured for this deployment.",
      503,
    )
  }

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
