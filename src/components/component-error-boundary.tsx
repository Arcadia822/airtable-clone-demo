"use client"

import { Component, type ErrorInfo, type ReactNode } from "react"
import { AlertTriangle, RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"

type ComponentErrorBoundaryProps = {
  children: ReactNode
  description: string
  resetKey?: string
  title: string
}

type ComponentErrorBoundaryState = {
  failed: boolean
}

export class ComponentErrorBoundary extends Component<
  ComponentErrorBoundaryProps,
  ComponentErrorBoundaryState
> {
  state: ComponentErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): ComponentErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("A workspace section could not render.", error, info)
  }

  componentDidUpdate(previous: ComponentErrorBoundaryProps) {
    if (
      this.state.failed &&
      previous.resetKey !== this.props.resetKey
    ) {
      this.setState({ failed: false })
    }
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <section
        className="grid min-h-72 flex-1 place-items-center bg-muted/15 px-5 py-10 text-center"
        role="alert"
      >
        <div className="max-w-sm">
          <span className="mx-auto grid size-10 place-items-center rounded-xl border bg-background text-amber-600 shadow-sm">
            <AlertTriangle className="size-4" />
          </span>
          <h2 className="mt-4 text-base font-semibold">
            {this.props.title}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {this.props.description}
          </p>
          <Button
            className="mt-5"
            onClick={() => this.setState({ failed: false })}
            size="sm"
            variant="outline"
          >
            <RotateCcw />
            Try again
          </Button>
        </div>
      </section>
    )
  }
}
