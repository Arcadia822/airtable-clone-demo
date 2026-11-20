import { and, asc, eq } from "drizzle-orm"

import { tables as tablesTable } from "../../../../drizzle/schema"
import { getDb } from "@/db/client"
import { requireSession } from "@/server/auth"
import { jsonError, jsonOk } from "@/server/http"
import { createTableBundle, tableRowToJson } from "@/server/services/tables"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const session = await requireSession(request)
    const db = await getDb()
    const baseId = new URL(request.url).searchParams.get("baseId")
    const rows = await db
      .select()
      .from(tablesTable)
      .where(
        baseId
          ? and(
              eq(tablesTable.orgId, session.orgId),
              eq(tablesTable.baseId, baseId),
              eq(tablesTable.status, "active"),
            )
          : and(
              eq(tablesTable.orgId, session.orgId),
              eq(tablesTable.status, "active"),
            ),
      )
      .orderBy(asc(tablesTable.rank), asc(tablesTable.createdAt))
    return jsonOk({ tables: rows.map(tableRowToJson) })
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession(request)
    const db = await getDb()
    const body = (await request.json().catch(() => ({}))) as {
      baseId?: string
      name?: string
      description?: string
      fields?: unknown[]
    }
    const bundle = await createTableBundle(db, {
      orgId: session.orgId,
      userId: session.userId,
      baseId: body.baseId ?? "",
      name: body.name ?? "",
      description: body.description,
      fields: body.fields,
    })
    return jsonOk(bundle, 201)
  } catch (error) {
    return jsonError(error)
  }
}
