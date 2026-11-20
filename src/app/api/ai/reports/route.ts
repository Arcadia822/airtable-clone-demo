import { and, desc, eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { z } from "zod"

import { getDb } from "@/db/client"
import { AppError } from "@/lib/domain"
import {
  aiReports,
  bases,
} from "../../../../../drizzle/schema"
import {
  assistantChartSchema,
  assistantCitationSchema,
  entityIdSchema,
} from "@/lib/eve/contracts"
import { requireSession } from "@/server/auth"
import { jsonError, jsonOk } from "@/server/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const createSchema = z
  .object({
    baseId: entityIdSchema,
    tableId: entityIdSchema.nullable().optional(),
    name: z.string().trim().min(1).max(240),
    format: z.enum(["markdown", "chart"]).default("markdown"),
    scopeLabel: z.string().trim().max(240).default(""),
    content: z.string().min(1).max(200_000),
    chart: assistantChartSchema.nullable().optional(),
    citations: z.array(assistantCitationSchema).max(50).default([]),
  })
  .strict()

const listQuerySchema = z
  .object({
    baseId: entityIdSchema.optional(),
    tableId: entityIdSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict()

export async function GET(request: Request) {
  try {
    const session = await requireSession(request)
    const url = new URL(request.url)
    const query = listQuerySchema.parse({
      ...(url.searchParams.get("baseId")
        ? { baseId: url.searchParams.get("baseId") ?? undefined }
        : {}),
      ...(url.searchParams.get("tableId")
        ? { tableId: url.searchParams.get("tableId") ?? undefined }
        : {}),
      ...(url.searchParams.get("limit")
        ? { limit: url.searchParams.get("limit") ?? undefined }
        : {}),
    })

    const db = await getDb()
    const filters = [
      eq(aiReports.orgId, session.orgId),
      eq(aiReports.status, "active"),
      ...(query.baseId ? [eq(aiReports.baseId, query.baseId)] : []),
      ...(query.tableId ? [eq(aiReports.tableId, query.tableId)] : []),
    ]

    const rows = await db
      .select()
      .from(aiReports)
      .where(and(...filters))
      .orderBy(desc(aiReports.createdAt))
      .limit(query.limit)

    return jsonOk({ reports: rows.map(serializeReport) })
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession(request)
    const body = createSchema.parse(await request.json())
    const db = await getDb()

    const [base] = await db
      .select({ id: bases.id })
      .from(bases)
      .where(
        and(
          eq(bases.orgId, session.orgId),
          eq(bases.id, body.baseId),
          eq(bases.status, "active"),
        ),
      )
      .limit(1)
    if (!base) {
      throw new AppError("NOT_FOUND", "That base is no longer available.")
    }

    const id = `rpt_${nanoid(10)}`
    const [row] = await db
      .insert(aiReports)
      .values({
        id,
        orgId: session.orgId,
        baseId: body.baseId,
        tableId: body.tableId ?? null,
        name: body.name,
        format: body.format,
        scopeLabel: body.scopeLabel,
        content: body.content,
        chart: body.chart ?? null,
        citations: body.citations,
        status: "active",
        createdBy: session.userId,
      })
      .returning()

    return jsonOk({ report: serializeReport(row) }, 201)
  } catch (error) {
    return jsonError(error)
  }
}

function serializeReport(row: typeof aiReports.$inferSelect) {
  return {
    id: row.id,
    baseId: row.baseId,
    tableId: row.tableId,
    name: row.name,
    format: row.format,
    scopeLabel: row.scopeLabel,
    content: row.content,
    chart: row.chart,
    citations: row.citations,
    status: row.status,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}
