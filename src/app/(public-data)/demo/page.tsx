import type { Metadata } from "next"

import { DemoWorkspace } from "@/components/workspace/demo-workspace"

export const metadata: Metadata = {
  title: "Interactive workspace",
  description: "Explore Basecraft with local demonstration data.",
  robots: { index: false, follow: false },
}

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ assistant?: string | string[] }>
}) {
  const { assistant } = await searchParams
  return <DemoWorkspace initialAssistantOpen={assistant === "open"} />
}
