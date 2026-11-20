import { getDb } from "@/db/client"
import { requireSession } from "@/server/auth"
import { jsonError, jsonOk, requireSameOrigin } from "@/server/http"
import { publishForm } from "@/server/services/forms"

export const runtime = "nodejs"

interface RouteContext {
  params: Promise<{ formId: string }>
}

export async function POST(request: Request, context: RouteContext) {
  try {
    requireSameOrigin(request)
    const session = await requireSession(request)
    const { formId } = await context.params
    const db = await getDb()
    return jsonOk(await publishForm(db, session.orgId, session.userId, formId))
  } catch (error) {
    return jsonError(error)
  }
}
