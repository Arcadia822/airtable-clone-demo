import { getDb } from "@/db/client"
import { requireSession } from "@/server/auth"
import { jsonError, jsonOk } from "@/server/http"
import { getFormAnalytics } from "@/server/services/forms"

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
    const rawDays = Number(url.searchParams.get("days") ?? "30")
    const days = Number.isFinite(rawDays) ? rawDays : 30
    return jsonOk(await getFormAnalytics(db, session.orgId, formId, { days }))
  } catch (error) {
    return jsonError(error)
  }
}
