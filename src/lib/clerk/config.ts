export const CLERK_PATHS = {
  signIn: "/sign-in",
  signUp: "/sign-up",
  onboarding: "/onboarding",
  pricing: "/pricing",
  afterAuth: "/onboarding",
  afterOrganizationSelection: "/dashboard",
} as const

export function isClerkConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim())
}
