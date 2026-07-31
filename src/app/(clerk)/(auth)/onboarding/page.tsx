import type { Metadata } from "next"

import {
  AuthShell,
  ClerkSetupState,
} from "@/components/auth/auth-shell"
import { OrganizationOnboarding } from "@/components/auth/organization-onboarding"
import { isClerkConfigured } from "@/lib/clerk/config"

export const metadata: Metadata = {
  title: "Choose an organization",
  description: "Create or select the organization that owns your workspace.",
}

export default function OnboardingPage() {
  return (
    <AuthShell
      eyebrow="Organization setup"
      title="Choose your workspace"
      description="Billing, members, bases, and plan access belong to the active workspace."
    >
      {isClerkConfigured() ? (
        <OrganizationOnboarding />
      ) : (
        <ClerkSetupState />
      )}
    </AuthShell>
  )
}
