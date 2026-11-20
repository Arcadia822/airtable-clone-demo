import { getDb } from "@/db/client"
import { requireSession } from "@/server/auth"
import { jsonError, jsonOk } from "@/server/http"
import { createBase, listBases } from "@/server/services/bases"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const session = await requireSession(request)
    const db = await getDb()
    return jsonOk(await listBases(db, session.orgId, session.userId))
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession(request)
    const db = await getDb()
    const body = await request.json().catch(() => ({}))
    return jsonOk(await createBase(db, session.orgId, session.userId, body), 201)
  } catch (error) {
    return jsonError(error)
  }
}
