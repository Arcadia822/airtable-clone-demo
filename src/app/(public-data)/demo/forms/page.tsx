import type { Metadata } from "next"

import { FormBuilder } from "@/components/forms/form-builder"

export const metadata: Metadata = {
  title: "Form builder",
  robots: { index: false, follow: false },
}

export default function DemoFormsPage() {
  return <FormBuilder />
}
