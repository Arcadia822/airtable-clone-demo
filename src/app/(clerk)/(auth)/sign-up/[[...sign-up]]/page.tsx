import type { Metadata } from "next"
import { SignUp } from "@clerk/nextjs"

import {
  AuthShell,
  ClerkSetupState,
} from "@/components/auth/auth-shell"
import { CLERK_PATHS, isClerkConfigured } from "@/lib/clerk/config"

export const metadata: Metadata = {
  title: "Create an account",
  description: "Create your account and start a Basecraft organization.",
}

export default function SignUpPage() {
  return (
    <AuthShell
      eyebrow="Start building"
      title="Create your account"
      description="You will create or join an organization before opening a shared workspace."
    >
      {isClerkConfigured() ? (
        <div className="[&_.cl-rootBox]:w-full [&_.cl-cardBox]:w-full [&_.cl-cardBox]:shadow-xl [&_.cl-card]:border">
          <SignUp
            routing="path"
            path={CLERK_PATHS.signUp}
            signInUrl={CLERK_PATHS.signIn}
            fallbackRedirectUrl={CLERK_PATHS.afterAuth}
          />
        </div>
      ) : (
        <ClerkSetupState />
      )}
    </AuthShell>
  )
}
