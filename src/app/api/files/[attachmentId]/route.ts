import { getDb } from "@/db/client"
import { getServerSession } from "@/server/auth"
import { jsonError } from "@/server/http"
import { resolveAttachmentDownload } from "@/server/services/attachments"
import { createAttachmentStorage } from "@/server/storage"

export const runtime = "nodejs"

type Context = { params: Promise<{ attachmentId: string }> }

function disposition(kind: "inline" | "attachment", name: string): string {
  const fallback = name.replace(/[^\u0020-\u007e]/g, "_").replace(/["\\]/g, "_")
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

/**
 * Serves stored attachment bytes from the configured storage adapter.
 * Organization members always pass; otherwise a published form for the
 * attachment's table grants public read access.
 */
export async function GET(request: Request, context: Context) {
  try {
    const { attachmentId } = await context.params
    const session = await getServerSession(request)
    const viewerOrgId = session.authenticated ? session.orgId : undefined
    const db = await getDb()
    const { row } = await resolveAttachmentDownload(db, attachmentId, viewerOrgId)

    const storage = await createAttachmentStorage(db)
    const stored = await storage.read(attachmentId)
    const inline = row.mimeType.toLowerCase().startsWith("image/")

    return new Response(stored.stream, {
      status: 200,
      headers: {
        "Content-Type": row.mimeType,
        "Content-Length": String(stored.size),
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": disposition(inline ? "inline" : "attachment", row.name),
      },
    })
  } catch (error) {
    return jsonError(error)
  }
}
