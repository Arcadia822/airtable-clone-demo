import { NextResponse } from "next/server"

import { getServerSession, isAuthMisconfigured } from "@/server/auth"
import { HttpStatusError, jsonError } from "@/server/http"

export const runtime = "nodejs"

export async function GET(request: Request) {
  // A deployment with no credentials and no local-mode opt-in cannot know who
  // is calling; report the misconfiguration instead of a fake signed-out state.
  if (isAuthMisconfigured()) {
    return jsonError(
      new HttpStatusError(
        "AUTH_NOT_CONFIGURED",
        "Authentication is not configured for this deployment.",
        503,
      ),
    )
  }

  const session = await getServerSession(request)
  if (!session.authenticated) {
    return NextResponse.json(
      {
        visitor: null,
        authMode: session.authMode,
        ...(session.originDenied ? { originDenied: true } : {}),
      },
      { status: 401 },
    )
  }

  return NextResponse.json({
    visitor: {
      userId: session.userId,
      email: session.email,
      name: session.name,
      orgId: session.orgId,
    },
    authMode: session.authMode,
  })
}
