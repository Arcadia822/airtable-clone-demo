import { getDb } from "@/db/client"
import { jsonError, jsonOk } from "@/server/http"
import { getPublicForm } from "@/server/services/forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface RouteContext {
  params: Promise<{ slug: string }>
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { slug } = await context.params
    const db = await getDb()
    const payload = await getPublicForm(db, slug)
    return jsonOk(payload, 200)
  } catch (error) {
    return jsonError(error)
  }
}
