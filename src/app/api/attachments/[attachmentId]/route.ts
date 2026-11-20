import { getDb } from "@/db/client"
import { requireSession } from "@/server/auth"
import { jsonError, jsonOk, requireSameOrigin } from "@/server/http"
import { deleteAttachment } from "@/server/services/attachments"

export const runtime = "nodejs"

type Context = { params: Promise<{ attachmentId: string }> }

export async function DELETE(request: Request, context: Context) {
  try {
    requireSameOrigin(request)
    const session = await requireSession(request)
    const { attachmentId } = await context.params
    const db = await getDb()
    return jsonOk(await deleteAttachment(db, session.orgId, attachmentId))
  } catch (error) {
    return jsonError(error)
  }
}
