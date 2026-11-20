import crypto from "node:crypto"
import { NextResponse } from "next/server"

import {
  assertTrustedAuthorizeUrl,
  getFactoryAuthConfig,
  isAuthMisconfigured,
  isOriginDeniedResponse,
  resolveAppOrigin,
  sanitizeReturnTo,
  VISITOR_COOKIES_ARE_HOST_PREFIXED,
  VISITOR_RETURN_COOKIE,
  VISITOR_STATE_COOKIE,
} from "@/server/auth"
import { HttpStatusError, jsonError } from "@/server/http"

export const runtime = "nodejs"

export async function handleVisitorAuthStart(
  request: Request,
  intent: "login" | "register",
): Promise<NextResponse> {
  const url = new URL(request.url)
  const returnTo = sanitizeReturnTo(url.searchParams.get("returnTo"))
  const config = getFactoryAuthConfig()

  if (!config) {
    // A deployed instance with no credentials must not pretend the user is
    // signed in; it reports the misconfiguration instead.
    if (isAuthMisconfigured()) {
      return jsonError(
        new HttpStatusError(
          "AUTH_NOT_CONFIGURED",
          "Authentication is not configured for this deployment.",
          503,
        ),
      )
    }
    return NextResponse.redirect(new URL(returnTo, resolveAppOrigin(request)), 303)
  }

  const origin = resolveAppOrigin(request)
  const secureOrigin = origin.startsWith("https://")

  // `__Host-` cookies are only accepted with `Secure`, which browsers refuse to
  // store over plain http. Refuse up front instead of issuing a cookie that
  // silently never arrives.
  if (VISITOR_COOKIES_ARE_HOST_PREFIXED && !secureOrigin) {
    return jsonError(
      new HttpStatusError(
        "AUTH_INSECURE_ORIGIN",
        "Sign-in requires a secure (https) origin. Open the app from its registered https URL.",
        503,
        { origin },
      ),
    )
  }

  const state = crypto.randomBytes(24).toString("base64url")
  const callbackUrl = `${origin}/api/auth/callback`

  const upstream = await fetch(`${config.url}/authorize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      "x-factory-visitor-origin": origin,
    },
    body: JSON.stringify({
      intent,
      state,
      redirectUri: callbackUrl,
      returnTo,
    }),
    cache: "no-store",
  })

  if (!upstream.ok) {
    const bodyText = await upstream.text().catch(() => "")
    if (isOriginDeniedResponse(upstream.status, bodyText)) {
      return NextResponse.json(
        {
          code: "ORIGIN_DENIED",
          originDenied: true,
          message:
            "This preview origin is not authorized for visitor sign-in. Open the app from its registered preview URL.",
        },
        { status: 403 },
      )
    }
    return NextResponse.json(
      {
        code: "AUTH_START_FAILED",
        message: "Unable to start sign-in flow.",
      },
      { status: upstream.status >= 400 ? upstream.status : 502 },
    )
  }

  const data = (await upstream.json().catch(() => null)) as {
    authorizeUrl?: string
    url?: string
  } | null
  const redirectTarget = data?.authorizeUrl ?? data?.url
  if (!redirectTarget) {
    return NextResponse.json(
      { code: "AUTH_START_FAILED", message: "Missing authorizeUrl from auth provider." },
      { status: 502 },
    )
  }

  let trustedRedirect: string
  try {
    trustedRedirect = assertTrustedAuthorizeUrl(redirectTarget, config.url)
  } catch (error) {
    return jsonError(error)
  }

  const response = NextResponse.redirect(trustedRedirect, 303)
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    // Always Secure for `__Host-` names; https otherwise.
    secure: VISITOR_COOKIES_ARE_HOST_PREFIXED || secureOrigin,
    path: "/",
    maxAge: 600,
  }
  response.cookies.set(VISITOR_STATE_COOKIE, state, cookieOptions)
  response.cookies.set(VISITOR_RETURN_COOKIE, returnTo, cookieOptions)
  return response
}

export async function GET(request: Request) {
  return handleVisitorAuthStart(request, "login")
}
