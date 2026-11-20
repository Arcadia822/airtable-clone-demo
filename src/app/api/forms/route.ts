import { getDb } from "@/db/client"
import { requireSession } from "@/server/auth"
import { jsonError, jsonOk, requireSameOrigin } from "@/server/http"
import { AppError } from "@/lib/domain"
import {
  createForm,
  getBaseFormsCatalog,
  listForms,
} from "@/server/services/forms"

export const runtime = "nodejs"

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

export async function GET(request: Request) {
  try {
    const session = await requireSession(request)
    const db = await getDb()
    const url = new URL(request.url)
    const baseId = url.searchParams.get("baseId") ?? undefined
    const forms = await listForms(db, session.orgId, {
      baseId,
      tableId: url.searchParams.get("tableId") ?? undefined,
    })

    if (url.searchParams.get("include") === "tables") {
      if (!baseId) {
        throw new AppError(
          "VALIDATION_ERROR",
          "baseId is required to list tables.",
        )
      }
      const catalog = await getBaseFormsCatalog(db, session.orgId, baseId)
      return jsonOk({ forms, base: catalog.base, tables: catalog.tables })
    }

    return jsonOk({ forms })
  } catch (error) {
    return jsonError(error)
  }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request)
    const session = await requireSession(request)
    const db = await getDb()
    const detail = await createForm(
      db,
      session.orgId,
      session.userId,
      await readJson(request),
    )
    return jsonOk(detail, 201)
  } catch (error) {
    return jsonError(error)
  }
}
