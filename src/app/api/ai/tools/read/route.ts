import { z } from "zod"

import { getDb } from "@/db/client"
import { readOperationSchema } from "@/lib/eve/contracts"
import { runReadTool } from "@/server/ai/tools"
import { requireSession } from "@/server/auth"
import { jsonError, jsonOk } from "@/server/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const bodySchema = z
  .object({
    tool: readOperationSchema,
    input: z.record(z.string().max(240), z.unknown()).default({}),
  })
  .strict()

export async function POST(request: Request) {
  try {
    const session = await requireSession(request)
    const body = bodySchema.parse(await request.json())
    const db = await getDb()
    const result = await runReadTool({ db, session }, body.tool, body.input)
    return jsonOk({ ok: true, result })
  } catch (error) {
    return jsonError(error)
  }
}
