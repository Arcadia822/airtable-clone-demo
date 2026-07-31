import { clerkMiddleware } from "@clerk/nextjs/server"
import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from "next/server"

function isPathOrChild(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`)
}

function isPublicRoute(request: NextRequest): boolean {
  const { pathname } = request.nextUrl
  return (
    pathname === "/" ||
    pathname === "/pricing" ||
    isPathOrChild(pathname, "/sign-in") ||
    isPathOrChild(pathname, "/sign-up") ||
    isPathOrChild(pathname, "/onboarding") ||
    isPathOrChild(pathname, "/demo") ||
    isPathOrChild(pathname, "/f")
  )
}

function isAnonymousDataRoute(request: NextRequest): boolean {
  const { pathname } = request.nextUrl
  return isPathOrChild(pathname, "/demo") || isPathOrChild(pathname, "/f")
}

const clerkConfigured = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() &&
    process.env.CLERK_SECRET_KEY?.trim(),
)
const isProduction = process.env.NODE_ENV === "production"

// Clerk initializes request auth here. Connected UI waits for Convex to validate
// the Clerk token, and every Convex read/write validates the active organization
// again before accessing data.
const configuredClerkMiddleware = clerkMiddleware()

export default function proxy(
  request: NextRequest,
  event: NextFetchEvent,
) {
  // Demo data and published forms are intentionally anonymous. Skipping Clerk
  // entirely keeps expired signed-in cookies from affecting these share links.
  if (isAnonymousDataRoute(request)) {
    return NextResponse.next()
  }

  if (clerkConfigured) {
    return configuredClerkMiddleware(request, event)
  }

  if (!isProduction || isPublicRoute(request)) {
    return NextResponse.next()
  }

  return new NextResponse("Authentication is not configured.", {
    status: 503,
  })
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
}
