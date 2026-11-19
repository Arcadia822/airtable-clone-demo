import crypto from "node:crypto"
import { NextResponse } from "next/server"

import {
  getFactoryAuthConfig,
  isOriginDeniedResponse,
  resolveAppOrigin,
  sanitizeReturnTo,
  VISITOR_RETURN_COOKIE,
  VISITOR_STATE_COOKIE,
} from "@/server/auth"

export const runtime = "nodejs"

export async function handleVisitorAuthStart(
  request: Request,
  intent: "login" | "register",
): Promise<NextResponse> {
  const url = new URL(request.url)
  const returnTo = sanitizeReturnTo(url.searchParams.get("returnTo"))
  const config = getFactoryAuthConfig()

  if (!config) {
    return NextResponse.redirect(new URL(returnTo, resolveAppOrigin(request)), 303)
  }

  const origin = resolveAppOrigin(request)
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

  const response = NextResponse.redirect(redirectTarget, 303)
  const isSecure = origin.startsWith("https://")
  response.cookies.set(VISITOR_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure,
    path: "/",
    maxAge: 600,
  })
  response.cookies.set(VISITOR_RETURN_COOKIE, returnTo, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure,
    path: "/",
    maxAge: 600,
  })
  return response
}

export async function GET(request: Request) {
  return handleVisitorAuthStart(request, "login")
}
