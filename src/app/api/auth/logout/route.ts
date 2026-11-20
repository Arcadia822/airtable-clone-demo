import { NextResponse } from "next/server"

import {
  forwardSetCookies,
  getFactoryAuthConfig,
  resolveAppOrigin,
} from "@/server/auth"
import { jsonError, requireSameOrigin } from "@/server/http"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    requireSameOrigin(request)

    const config = getFactoryAuthConfig()
    if (!config) {
      return NextResponse.json({ ok: true, authMode: "local" })
    }

    const origin = resolveAppOrigin(request)
    const cookieHeader = request.headers.get("cookie") ?? ""

    const upstream = await fetch(`${config.url}/logout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "x-factory-visitor-origin": origin,
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
      },
      cache: "no-store",
    })

    const response = NextResponse.json(
      { ok: upstream.ok, authMode: "factory" },
      { status: upstream.ok ? 200 : upstream.status },
    )
    forwardSetCookies(upstream, response.headers)
    return response
  } catch (error) {
    return jsonError(error)
  }
}
