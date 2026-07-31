import type { Metadata } from "next"
import { SignIn } from "@clerk/nextjs"

import {
  AuthShell,
  ClerkSetupState,
} from "@/components/auth/auth-shell"
import { CLERK_PATHS, isClerkConfigured } from "@/lib/clerk/config"

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Basecraft organization.",
}

export default function SignInPage() {
  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Sign in to Basecraft"
      description="Continue to your organization's realtime bases, forms, and insights."
    >
      {isClerkConfigured() ? (
        <div className="[&_.cl-rootBox]:w-full [&_.cl-cardBox]:w-full [&_.cl-cardBox]:shadow-xl [&_.cl-card]:border">
          <SignIn
            routing="path"
            path={CLERK_PATHS.signIn}
            signUpUrl={CLERK_PATHS.signUp}
            fallbackRedirectUrl={CLERK_PATHS.afterAuth}
          />
        </div>
      ) : (
        <ClerkSetupState />
      )}
    </AuthShell>
  )
}
