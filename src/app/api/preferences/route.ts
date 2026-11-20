import { getDb } from "@/db/client"
import { requireSession } from "@/server/auth"
import { jsonError, jsonOk } from "@/server/http"
import { listPreferences, upsertPreference } from "@/server/services/preferences"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const session = await requireSession(request)
    const db = await getDb()
    return jsonOk(await listPreferences(db, session.orgId, session.userId))
  } catch (error) {
    return jsonError(error)
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireSession(request)
    const db = await getDb()
    const body = await request.json().catch(() => ({}))
    return jsonOk(await upsertPreference(db, session.orgId, session.userId, body))
  } catch (error) {
    return jsonError(error)
  }
}
