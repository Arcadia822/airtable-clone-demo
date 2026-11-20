import { getDb } from "@/db/client"
import { requireSession } from "@/server/auth"
import { jsonError, jsonOk } from "@/server/http"
import { generateFormDraft } from "@/server/services/forms"

export const runtime = "nodejs"

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

interface RouteContext {
  params: Promise<{ formId: string }>
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const session = await requireSession(request)
    const { formId } = await context.params
    const db = await getDb()
    return jsonOk(
      await generateFormDraft(
        db,
        session.orgId,
        formId,
        await readJson(request),
      ),
    )
  } catch (error) {
    return jsonError(error)
  }
}
