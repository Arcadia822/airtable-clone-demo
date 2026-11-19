import type { ReactNode } from "react"

export default function PublicDataLayout({
  children,
}: {
  children: ReactNode
}) {
  return <>{children}</>
}
