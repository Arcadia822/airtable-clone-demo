import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { ConnectedPublicForm } from "@/components/forms/connected-public-form"

export const metadata: Metadata = {
  title: "Public form",
  description: "A secure public form.",
  robots: { index: false, follow: false },
}

export default async function PublicFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { slug } = await params
  if (!slug) notFound()

  const publicParameters = await searchParams
  const prefillQuery = new URLSearchParams()
  for (const [name, value] of Object.entries(publicParameters)) {
    if (Array.isArray(value)) {
      for (const item of value) prefillQuery.append(name, item)
    } else if (value !== undefined) {
      prefillQuery.set(name, value)
    }
  }

  return (
    <ConnectedPublicForm
      slug={slug}
      prefillQuery={prefillQuery.toString()}
    />
  )
}
