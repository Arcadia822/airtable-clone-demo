import { NextResponse } from "next/server"
import { ZodError } from "zod"

import { AppError, type AppErrorCode } from "@/lib/domain"

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  QUOTA_EXCEEDED: 429,
  FORM_UPDATED: 409,
  FORM_CLOSED: 410,
  RATE_LIMITED: 429,
  REVISION_CONFLICT: 409,
  VALIDATION_ERROR: 400,
  BILLING_UNAVAILABLE: 503,
}

export function jsonOk<T>(data: T, status = 200): NextResponse<T> {
  return NextResponse.json(data, { status })
}

export function jsonError(err: unknown): NextResponse<{ code: string; message: string; details?: unknown }> {
  if (err instanceof AppError) {
    return NextResponse.json(
      {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
      { status: STATUS_BY_CODE[err.code] ?? 400 },
    )
  }

  if (err instanceof ZodError) {
    const first = err.issues[0]
    return NextResponse.json(
      {
        code: "VALIDATION_ERROR",
        message: first?.message ?? "Invalid request payload.",
        details: err.issues,
      },
      { status: 400 },
    )
  }

  const message =
    err instanceof Error && err.message ? err.message : "Internal server error"
  return NextResponse.json(
    {
      code: "INTERNAL_ERROR",
      message,
    },
    { status: 500 },
  )
}
