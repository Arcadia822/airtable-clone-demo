import { getDb } from "@/db/client"
import { getServerSession } from "@/server/auth"
import { AppError } from "@/lib/domain"
import { jsonError, jsonOk } from "@/server/http"
import { storePublicUpload, storeUpload } from "@/server/services/attachments"

export const runtime = "nodejs"

type Context = { params: Promise<{ sessionId: string }> }

async function handleUpload(request: Request, context: Context) {
  try {
    const { sessionId } = await context.params
    const publicFormSlug = new URL(request.url).searchParams.get("publicFormSlug")
    const db = await getDb()

    if (publicFormSlug) {
      return jsonOk(await storePublicUpload(db, publicFormSlug, sessionId, request), 201)
    }

    const session = await getServerSession(request)
    if (!session.authenticated) {
      throw new AppError("UNAUTHORIZED", "Authentication required.")
    }
    return jsonOk(await storeUpload(db, session.orgId, sessionId, request), 201)
  } catch (error) {
    return jsonError(error)
  }
}

export async function PUT(request: Request, context: Context) {
  return handleUpload(request, context)
}

export async function POST(request: Request, context: Context) {
  return handleUpload(request, context)
}
