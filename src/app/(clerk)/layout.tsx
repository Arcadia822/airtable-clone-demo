import { ClerkProvider } from "@clerk/nextjs"
import { ui } from "@clerk/ui"
import { shadcn } from "@clerk/ui/themes"
import type { ReactNode } from "react"

import { ConvexBridge } from "@/components/providers"

const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

export default function ClerkLayout({ children }: { children: ReactNode }) {
  if (!clerkPublishableKey) {
    return children
  }

  return (
    <ClerkProvider
      publishableKey={clerkPublishableKey}
      ui={ui}
      appearance={{
        theme: shadcn,
        variables: {
          colorPrimary: "#2563eb",
          borderRadius: "0.5rem",
        },
        elements: {
          cardBox: "shadow-xl shadow-slate-950/5",
          formButtonPrimary:
            "bg-[#2563eb] hover:bg-[#1d4ed8] shadow-none text-sm",
        },
      }}
    >
      <ConvexBridge>{children}</ConvexBridge>
    </ClerkProvider>
  )
}
