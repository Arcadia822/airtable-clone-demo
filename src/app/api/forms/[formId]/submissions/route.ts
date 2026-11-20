import { NextResponse } from "next/server"

import { getDb } from "@/db/client"
import { requireSession } from "@/server/auth"
import { jsonError, jsonOk } from "@/server/http"
import {
  getFormSubmissions,
  getFormSubmissionsCsv,
} from "@/server/services/forms"

export const runtime = "nodejs"

interface RouteContext {
  params: Promise<{ formId: string }>
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const session = await requireSession(request)
    const { formId } = await context.params
    const db = await getDb()
    const url = new URL(request.url)

    if (url.searchParams.get("format") === "csv") {
      const { csv, fileName } = await getFormSubmissionsCsv(
        db,
        session.orgId,
        formId,
      )
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${fileName}"`,
          "cache-control": "no-store",
        },
      })
    }

    return jsonOk(await getFormSubmissions(db, session.orgId, formId))
  } catch (error) {
    return jsonError(error)
  }
}
