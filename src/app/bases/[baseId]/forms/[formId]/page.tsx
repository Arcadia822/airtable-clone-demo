import type { Metadata } from "next"

import { FormStudio } from "@/components/forms/form-studio"

export const metadata: Metadata = {
  title: "Form Studio",
  robots: { index: false, follow: false },
}

export default async function FormStudioPage({
  params,
}: {
  params: Promise<{ baseId: string; formId: string }>
}) {
  const { baseId, formId } = await params
  return <FormStudio baseId={baseId} formId={formId} />
}
