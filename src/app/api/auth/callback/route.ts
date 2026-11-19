import { NextRequest, NextResponse } from "next/server"

import {
  forwardSetCookies,
  getFactoryAuthConfig,
  resolveAppOrigin,
  sanitizeReturnTo,
  VISITOR_RETURN_COOKIE,
  VISITOR_STATE_COOKIE,
} from "@/server/auth"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const origin = resolveAppOrigin(request)
  const config = getFactoryAuthConfig()
  if (!config) {
    return NextResponse.redirect(new URL("/", origin), 303)
  }

  const code = request.nextUrl.searchParams.get("code")
  const state = request.nextUrl.searchParams.get("state")
  const expectedState = request.cookies.get(VISITOR_STATE_COOKIE)?.value
  const returnTo = sanitizeReturnTo(request.cookies.get(VISITOR_RETURN_COOKIE)?.value)

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.json(
      { code: "INVALID_STATE", message: "Invalid or expired sign-in state." },
      { status: 400 },
    )
  }

  const upstream = await fetch(`${config.url}/exchange`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      "x-factory-visitor-origin": origin,
    },
    body: JSON.stringify({
      code,
      state,
      redirectUri: `${origin}/api/auth/callback`,
    }),
    cache: "no-store",
  })

  if (!upstream.ok) {
    return NextResponse.json(
      { code: "EXCHANGE_FAILED", message: "Sign-in exchange failed." },
      { status: upstream.status >= 400 ? upstream.status : 502 },
    )
  }

  const response = NextResponse.redirect(new URL(returnTo, origin), 303)
  forwardSetCookies(upstream, response.headers)
  const isSecure = origin.startsWith("https://")
  response.cookies.set(VISITOR_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure,
    path: "/",
    maxAge: 0,
  })
  response.cookies.set(VISITOR_RETURN_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure,
    path: "/",
    maxAge: 0,
  })
  return response
}
