import { z } from "zod"

import { getDb } from "@/db/client"
import { writeOperationSchema } from "@/lib/eve/contracts"
import { executeApprovedWrite } from "@/server/ai/tools"
import { requireSession } from "@/server/auth"
import { jsonError, jsonOk } from "@/server/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const bodySchema = z
  .object({
    operation: writeOperationSchema,
    input: z.record(z.string().max(240), z.unknown()),
  })
  .strict()

/**
 * Executes a change the workspace member explicitly approved in the assistant
 * panel. Nothing here runs unless the client sends the proposal input back.
 */
export async function POST(request: Request) {
  try {
    const session = await requireSession(request)
    const body = bodySchema.parse(await request.json())
    const db = await getDb()
    const execution = await executeApprovedWrite(
      { db, session },
      body.operation,
      body.input,
    )
    return jsonOk({ ok: true, result: execution })
  } catch (error) {
    return jsonError(error)
  }
}
