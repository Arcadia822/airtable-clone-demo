import type { ReactNode } from "react"

import { PublicConvexBridge } from "@/components/providers"

export default function PublicDataLayout({
  children,
}: {
  children: ReactNode
}) {
  return <PublicConvexBridge>{children}</PublicConvexBridge>
}
