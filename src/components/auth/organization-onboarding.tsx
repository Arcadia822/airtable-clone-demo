"use client"

import Link from "next/link"
import {
  OrganizationList,
  SignInButton,
  useOrganization,
} from "@clerk/nextjs"
import { ArrowRight, Building2, CheckCircle2 } from "lucide-react"

import { OrganizationAuthGate } from "@/components/connected/organization-auth-gate"
import { Button, buttonVariants } from "@/components/ui/button"
import { CLERK_PATHS } from "@/lib/clerk/config"
import { cn } from "@/lib/utils"

export function OrganizationOnboarding() {
  const { organization } = useOrganization()

  return (
    <OrganizationAuthGate
      requireOrganization={false}
      signedOutFallback={
      <div className="rounded-2xl border bg-card p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <Building2 className="size-5" />
          </span>
          <div>
            <p className="font-medium">Sign in to continue</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Your organization will own its bases, members, and subscription.
            </p>
          </div>
        </div>
        <SignInButton
          mode="modal"
          fallbackRedirectUrl={CLERK_PATHS.onboarding}
        >
          <Button className="mt-5 w-full" size="lg">
            Sign in
            <ArrowRight data-icon="inline-end" />
          </Button>
        </SignInButton>
      </div>
      }
    >
      {({ orgId }) =>
        orgId ? (
          <div className="rounded-2xl border bg-card p-6 shadow-sm">
            <div className="flex items-start gap-4">
              <span className="grid size-10 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600">
                <CheckCircle2 className="size-5" />
              </span>
              <div>
                <p className="font-medium">Your workspace is ready</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {organization?.name ?? "Your organization"} is active.
                  Everything you open or create will stay with this workspace.
                </p>
              </div>
            </div>
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              <Link
                href={CLERK_PATHS.afterOrganizationSelection}
                className={cn(buttonVariants({ size: "lg" }), "w-full")}
              >
                Open workspace
                <ArrowRight data-icon="inline-end" />
              </Link>
              <Link
                href={CLERK_PATHS.pricing}
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "w-full",
                )}
              >
                Compare plans
              </Link>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm [&_.cl-rootBox]:w-full [&_.cl-cardBox]:w-full [&_.cl-cardBox]:shadow-none">
            <OrganizationList
              hidePersonal
              skipInvitationScreen={false}
              afterCreateOrganizationUrl={
                CLERK_PATHS.afterOrganizationSelection
              }
              afterSelectOrganizationUrl={
                CLERK_PATHS.afterOrganizationSelection
              }
              appearance={{
                elements: {
                  rootBox: "w-full",
                  cardBox: "w-full shadow-none",
                  card: "w-full border-0 shadow-none",
                },
              }}
            />
          </div>
        )
      }
    </OrganizationAuthGate>
  )
}
