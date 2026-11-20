import { getDb } from "@/db/client"
import { requireSession } from "@/server/auth"
import { jsonError, jsonOk, requireSameOrigin } from "@/server/http"
import { createField } from "@/server/services/fields"
import { fieldRowToDefinition, listActiveFields, requireTable } from "@/server/services/tables"

export const runtime = "nodejs"

type Context = { params: Promise<{ tableId: string }> }

export async function GET(request: Request, context: Context) {
  try {
    const session = await requireSession(request)
    const { tableId } = await context.params
    const db = await getDb()
    await requireTable(db, session.orgId, tableId)
    const rows = await listActiveFields(db, session.orgId, tableId)
    return jsonOk({ fields: rows.map(fieldRowToDefinition) })
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request)
    const session = await requireSession(request)
    const { tableId } = await context.params
    const db = await getDb()
    const body = await request.json().catch(() => ({}))
    return jsonOk(await createField(db, session.orgId, tableId, body), 201)
  } catch (error) {
    return jsonError(error)
  }
}
