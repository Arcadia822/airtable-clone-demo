import { getDb } from "@/db/client"
import { requireSession } from "@/server/auth"
import { jsonError, jsonOk, requireSameOrigin } from "@/server/http"
import {
  deleteForm,
  getFormDetail,
  updateForm,
} from "@/server/services/forms"

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

export async function GET(request: Request, context: RouteContext) {
  try {
    const session = await requireSession(request)
    const { formId } = await context.params
    const db = await getDb()
    return jsonOk(await getFormDetail(db, session.orgId, formId))
  } catch (error) {
    return jsonError(error)
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    requireSameOrigin(request)
    const session = await requireSession(request)
    const { formId } = await context.params
    const db = await getDb()
    return jsonOk(
      await updateForm(db, session.orgId, formId, await readJson(request)),
    )
  } catch (error) {
    return jsonError(error)
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    requireSameOrigin(request)
    const session = await requireSession(request)
    const { formId } = await context.params
    const db = await getDb()
    return jsonOk(await deleteForm(db, session.orgId, formId))
  } catch (error) {
    return jsonError(error)
  }
}
