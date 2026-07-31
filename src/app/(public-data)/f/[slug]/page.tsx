import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { PublicForm } from "@/components/forms/public-form"
import { ConnectedPublicForm } from "@/components/forms/connected-public-form"
import { DEMO_FIELDS, DEMO_FORM } from "@/lib/demo-data"

export const metadata: Metadata = {
  title: "Public form | Basecraft",
  description: "A secure public form powered by Basecraft.",
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
  const publicParameters = await searchParams
  const prefillQuery = new URLSearchParams()
  for (const [name, value] of Object.entries(publicParameters)) {
    if (Array.isArray(value)) {
      for (const item of value) prefillQuery.append(name, item)
    } else if (value !== undefined) {
      prefillQuery.set(name, value)
    }
  }
  const connected = Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
      process.env.NEXT_PUBLIC_CONVEX_URL,
  )
  if (slug !== DEMO_FORM.publicSlug) {
    if (connected) {
      return (
        <ConnectedPublicForm
          prefillQuery={prefillQuery.toString()}
          slug={slug}
        />
      )
    }
    notFound()
  }

  return (
    <main
      className="min-h-dvh px-4 py-10 sm:px-6 sm:py-16"
      style={{ background: DEMO_FORM.theme.background }}
    >
      <PublicForm form={DEMO_FORM} fields={DEMO_FIELDS} />
    </main>
  )
}
