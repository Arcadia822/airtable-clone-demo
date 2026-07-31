"use client"

import Link from "next/link"
import { MessageSquareText } from "lucide-react"

import { AssistantDock } from "@/components/assistant/assistant-dock"
import {
  AssistantPanel,
  type AssistantPageContext,
} from "@/components/assistant/assistant-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export function ConnectedAssistantSheet({
  canUseAi,
  context,
  onOpenChange,
  open,
  title = "Basecraft AI",
}: {
  canUseAi: boolean
  context: AssistantPageContext
  onOpenChange: (open: boolean) => void
  open: boolean
  title?: string
}) {
  return (
    <AssistantDock
      label={title}
      onOpenChange={onOpenChange}
      open={open}
    >
      {canUseAi ? (
        <AssistantPanel
          className="min-h-full rounded-none shadow-none ring-0"
          context={context}
          title={title}
        />
      ) : (
        <div className="flex h-full min-h-dvh flex-col bg-background">
          <div className="border-b px-5 py-4 pr-14">
            <p className="font-heading text-base font-medium">{title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Live workspace analysis
            </p>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
            <div className="grid size-11 place-items-center rounded-lg border bg-muted/35 text-foreground">
              <MessageSquareText className="size-5" />
            </div>
            <Badge className="mt-5 rounded-md" variant="secondary">
              Pro feature
            </Badge>
            <h2 className="mt-4 text-lg font-semibold">
              Ask questions about live workspace data
            </h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
              Pro workspaces unlock table insights, form performance, and
              proposed changes that only run after you approve them.
            </p>
            <Button
              className="mt-6"
              render={<Link href="/pricing" />}
              variant="outline"
            >
              Compare plans
            </Button>
          </div>
        </div>
      )}
    </AssistantDock>
  )
}
