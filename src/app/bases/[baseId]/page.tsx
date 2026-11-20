import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { BaseOverview } from "@/components/workspace/base-overview"
import { getDb } from "@/db/client"
import { AppError } from "@/lib/domain"
import { getServerSession } from "@/server/auth"
import { getBaseDashboard } from "@/server/services/bases"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export const metadata: Metadata = {
  title: "Base",
  robots: { index: false, follow: false },
}

export default async function BasePage({
  params,
}: {
  params: Promise<{ baseId: string }>
}) {
  const { baseId } = await params
  const session = await getServerSession()
  if (!session.authenticated) {
    redirect(`/api/auth/login?returnTo=${encodeURIComponent(`/bases/${baseId}`)}`)
  }

  const db = await getDb()
  try {
    const dashboard = await getBaseDashboard(db, session.orgId, baseId)
    return (
      <BaseOverview
        base={{
          id: dashboard.base.id,
          name: dashboard.base.name,
          description: dashboard.base.description,
          color: dashboard.base.color,
        }}
        counts={dashboard.counts}
        forms={dashboard.forms}
        tables={dashboard.tables}
      />
    )
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") {
      redirect("/bases")
    }
    throw error
  }
}
