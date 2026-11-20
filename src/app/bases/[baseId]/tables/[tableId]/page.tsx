import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"

import { TableWorkspace } from "@/components/workspace/table-workspace"
import { getDb } from "@/db/client"
import { AppError } from "@/lib/domain"
import { getServerSession } from "@/server/auth"
import { getBase } from "@/server/services/bases"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export const metadata: Metadata = {
  title: "Table",
  robots: { index: false, follow: false },
}

export default async function TablePage({
  params,
}: {
  params: Promise<{ baseId: string; tableId: string }>
}) {
  const { baseId, tableId } = await params
  const session = await getServerSession()
  if (!session.authenticated) {
    redirect(
      `/api/auth/login?returnTo=${encodeURIComponent(
        `/bases/${baseId}/tables/${tableId}`,
      )}`,
    )
  }

  const db = await getDb()
  let baseName: string
  try {
    const detail = await getBase(db, session.orgId, baseId)
    baseName = detail.base.name
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound()
    throw error
  }

  return (
    <TableWorkspace baseId={baseId} baseName={baseName} tableId={tableId} />
  )
}
