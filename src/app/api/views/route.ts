import { getDb } from "@/db/client"
import { requireSession } from "@/server/auth"
import { jsonError, jsonOk } from "@/server/http"
import { createView, listViews } from "@/server/services/views"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const session = await requireSession(request)
    const db = await getDb()
    const tableId = new URL(request.url).searchParams.get("tableId") ?? undefined
    return jsonOk(await listViews(db, session.orgId, tableId))
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession(request)
    const db = await getDb()
    const body = await request.json().catch(() => ({}))
    return jsonOk(await createView(db, session.orgId, body), 201)
  } catch (error) {
    return jsonError(error)
  }
}
