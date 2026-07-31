import type { Metadata } from "next"

import { FormAnalytics } from "@/components/analytics/form-analytics"

export const metadata: Metadata = {
  title: "Form analytics",
  robots: { index: false, follow: false },
}

export default function DemoAnalyticsPage() {
  return <FormAnalytics />
}
