import { getDb } from "@/db/client"
import { jsonError, jsonOk } from "@/server/http"
import { recordPublicFormMetric } from "@/server/services/forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface RouteContext {
  params: Promise<{ slug: string }>
}

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
    return jsonOk(await recordPublicFormMetric(db, slug, body))
  } catch (error) {
    return jsonError(error)
  }
}
