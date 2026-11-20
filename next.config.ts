import type { NextConfig } from "next"

const isDevelopment = process.env.NODE_ENV !== "production"

/**
 * Baseline response headers for every route.
 *
 * CSP notes: Next injects its bootstrap script inline and we do not run a
 * nonce-aware middleware, so `script-src` allows `'unsafe-inline'` (and
 * `'unsafe-eval'` in development only, which React Refresh needs). Every other
 * directive is locked down: no framing (`frame-ancestors 'none'` +
 * `X-Frame-Options`), no plugins (`object-src 'none'`), same-origin base and
 * form targets, and same-origin/data/blob images plus the Turnstile frame.
 */
export function securityHeaders(): { key: string; value: string }[] {
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${
      isDevelopment ? " 'unsafe-eval'" : ""
    } https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://challenges.cloudflare.com",
    "frame-src https://challenges.cloudflare.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ")

  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "no-referrer" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
    { key: "Content-Security-Policy", value: csp },
  ]
}

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  reactCompiler: true,
  // Both drivers are loaded at runtime only: bundling them breaks their
  // native/conditional entry points (and bloats the published Worker build).
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders() }]
  },
}

export default nextConfig
