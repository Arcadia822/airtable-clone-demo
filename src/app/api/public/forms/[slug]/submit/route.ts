import { getDb } from "@/db/client"
import { jsonError, jsonOk } from "@/server/http"
import { submitPublicForm } from "@/server/services/forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface RouteContext {
  params: Promise<{ slug: string }>
}

/**
 * Public submissions arrive as JSON. File and image questions must be uploaded
 * first through `/api/attachments`, then referenced here by their attachment
 * metadata.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { slug } = await context.params
    const db = await getDb()
    let body: unknown = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }
    return jsonOk(await submitPublicForm(db, slug, body), 201)
  } catch (error) {
    return jsonError(error)
  }
}
