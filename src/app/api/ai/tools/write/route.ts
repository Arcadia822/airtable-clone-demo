import { z } from "zod"

import { getDb } from "@/db/client"
import { writeOperationSchema } from "@/lib/eve/contracts"
import {
  consumeWriteProposalToken,
  executeApprovedWrite,
} from "@/server/ai/tools"
import { requireSession } from "@/server/auth"
import { jsonError, jsonOk } from "@/server/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const bodySchema = z
  .object({
    operation: writeOperationSchema,
    input: z.record(z.string().max(240), z.unknown()),
    token: z.string().trim().min(8).max(120),
  })
  .strict()

/**
 * Executes a change the workspace member explicitly approved in the assistant
 * panel.
 *
 * The proposal is only actionable through a server-issued, single-use token
 * that `POST /api/ai/chat` created when it emitted the `proposal` event — a
 * client-supplied operation and input alone are rejected. Consuming the token
 * also returns the stored input, so the server executes exactly what it showed
 * the member, not a client-edited copy.
 */
export async function POST(request: Request) {
  try {
    const session = await requireSession(request)
    const body = bodySchema.parse(await request.json())
    const db = await getDb()
    const ctx = { db, session }
    const approved = await consumeWriteProposalToken(
      ctx,
      body.token,
      body.operation,
      body.input,
    )
    const execution = await executeApprovedWrite(
      ctx,
      approved.operation,
      approved.input,
    )
    return jsonOk({ ok: true, result: execution })
  } catch (error) {
    return jsonError(error)
  }
}
