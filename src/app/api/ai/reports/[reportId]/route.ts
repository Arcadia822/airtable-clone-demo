import { and, eq } from "drizzle-orm"

import { getDb } from "@/db/client"
import { aiReports } from "../../../../../../drizzle/schema"
import { AppError } from "@/lib/domain"
import { requireSession } from "@/server/auth"
import { jsonError, jsonOk } from "@/server/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ reportId: string }> }

export async function GET(request: Request, context: RouteContext) {
  try {
    const session = await requireSession(request)
    const { reportId } = await context.params
    const db = await getDb()

    const [row] = await db
      .select()
      .from(aiReports)
      .where(
        and(
          eq(aiReports.orgId, session.orgId),
          eq(aiReports.id, reportId),
          eq(aiReports.status, "active"),
        ),
      )
      .limit(1)
    if (!row) {
      throw new AppError("NOT_FOUND", "That report is no longer available.")
    }

    return jsonOk({ report: serializeReport(row) })
  } catch (error) {
    return jsonError(error)
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const session = await requireSession(request)
    const { reportId } = await context.params
    const db = await getDb()

    const archived = await db
      .update(aiReports)
      .set({ status: "archived", updatedAt: new Date() })
      .where(
        and(
          eq(aiReports.orgId, session.orgId),
          eq(aiReports.id, reportId),
          eq(aiReports.status, "active"),
        ),
      )
      .returning({ id: aiReports.id })
    if (archived.length === 0) {
      throw new AppError("NOT_FOUND", "That report is no longer available.")
    }

    return jsonOk({ ok: true, id: archived[0].id })
  } catch (error) {
    return jsonError(error)
  }
}

function serializeReport(row: typeof aiReports.$inferSelect) {
  return {
    id: row.id,
    baseId: row.baseId,
    tableId: row.tableId,
    name: row.name,
    format: row.format,
    scopeLabel: row.scopeLabel,
    content: row.content,
    chart: row.chart,
    citations: row.citations,
    status: row.status,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}
