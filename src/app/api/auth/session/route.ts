import { NextResponse } from "next/server"

import { getServerSession } from "@/server/auth"

export const runtime = "nodejs"

export async function GET(request: Request) {
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
