import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { BaseList } from "@/components/workspace/base-list"
import { getDb } from "@/db/client"
import { getServerSession } from "@/server/auth"
import { listBases } from "@/server/services/bases"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export const metadata: Metadata = {
  title: "Bases",
}

export default async function BasesPage() {
  const session = await getServerSession()
  if (!session.authenticated) redirect("/api/auth/login?returnTo=/bases")

  const db = await getDb()
  const { bases } = await listBases(db, session.orgId, session.userId)

  return (
    <BaseList
      bases={bases.map((base) => ({
        id: base.id,
        name: base.name,
        description: base.description,
        color: base.color,
        tableCount: base.tableCount,
        recordCount: base.recordCount,
        tables: base.tables.map((table) => ({ id: table.id, name: table.name })),
      }))}
    />
  )
}
