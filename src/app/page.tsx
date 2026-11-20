import { redirect } from "next/navigation"

import { getDb } from "@/db/client"
import { getServerSession } from "@/server/auth"
import { listBases } from "@/server/services/bases"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export default async function HomePage() {
  const session = await getServerSession()
  if (!session.authenticated) redirect("/api/auth/login?returnTo=/")

  const db = await getDb()
  const { bases } = await listBases(db, session.orgId, session.userId)
  const firstTable = bases[0]?.tables[0]

  if (bases[0] && firstTable) {
    redirect(`/bases/${bases[0].id}/tables/${firstTable.id}`)
  }
  if (bases[0]) redirect(`/bases/${bases[0].id}`)
  redirect("/bases")
}
