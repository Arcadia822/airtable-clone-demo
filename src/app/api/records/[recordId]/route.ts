import { getDb } from "@/db/client"
import { requireSession } from "@/server/auth"
import { jsonError, jsonOk } from "@/server/http"
import { deleteRecord, getRecord, updateRecord } from "@/server/services/records"

export const runtime = "nodejs"

type Context = { params: Promise<{ recordId: string }> }

export async function GET(request: Request, context: Context) {
  try {
    const session = await requireSession(request)
    const { recordId } = await context.params
    const db = await getDb()
    return jsonOk(await getRecord(db, session.orgId, recordId))
  } catch (error) {
    return jsonError(error)
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const session = await requireSession(request)
    const { recordId } = await context.params
    const db = await getDb()
    const body = await request.json().catch(() => ({}))
    return jsonOk(await updateRecord(db, session.orgId, session.userId, recordId, body))
  } catch (error) {
    return jsonError(error)
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const session = await requireSession(request)
    const { recordId } = await context.params
    const db = await getDb()
    return jsonOk(await deleteRecord(db, session.orgId, recordId))
  } catch (error) {
    return jsonError(error)
  }
}
