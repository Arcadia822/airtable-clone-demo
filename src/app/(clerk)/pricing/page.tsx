import type { Metadata } from "next"

import { OrganizationPricingTable } from "@/components/billing/organization-pricing-table"
import { MarketingHeader } from "@/components/marketing-header"
import { isClerkConfigured } from "@/lib/clerk/config"

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Compare Basecraft organization plans for realtime data, public forms, analytics, and AI.",
}

export default function PricingPage() {
  const clerkEnabled = isClerkConfigured()

  return (
    <>
      <MarketingHeader
        active="pricing"
        authEnabled={
          clerkEnabled && Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)
        }
      />
      <OrganizationPricingTable clerkEnabled={clerkEnabled} />
    </>
  )
}
