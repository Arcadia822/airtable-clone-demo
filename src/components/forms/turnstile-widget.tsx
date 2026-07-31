"use client"

import Script from "next/script"
import { useEffect, useRef, useState } from "react"

interface TurnstileApi {
  remove(widgetId: string): void
  render(
    container: HTMLElement,
    options: {
      sitekey: string
      theme: "light"
      action: string
      callback: (token: string) => void
      "error-callback": () => void
      "expired-callback": () => void
    },
  ): string
  reset(widgetId: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

export function TurnstileWidget({
  siteKey,
  resetNonce,
  onTokenChange,
  action = "form-submit",
}: {
  siteKey: string
  resetNonce: number
  onTokenChange: (token: string | undefined) => void
  action?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)
  const lastResetNonceRef = useRef(resetNonce)
  const [scriptReady, setScriptReady] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!scriptReady || !container || !window.turnstile || widgetIdRef.current) {
      return
    }

    const turnstile = window.turnstile
    widgetIdRef.current = turnstile.render(container, {
      sitekey: siteKey,
      theme: "light",
      action,
      callback: (token) => onTokenChange(token),
      "error-callback": () => onTokenChange(undefined),
      "expired-callback": () => onTokenChange(undefined),
    })

    return () => {
      if (widgetIdRef.current) {
        turnstile.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
    }
  }, [action, onTokenChange, scriptReady, siteKey])

  useEffect(() => {
    if (lastResetNonceRef.current === resetNonce) return
    lastResetNonceRef.current = resetNonce
    onTokenChange(undefined)
    if (!widgetIdRef.current || !window.turnstile) return
    window.turnstile.reset(widgetIdRef.current)
  }, [onTokenChange, resetNonce])

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
        onReady={() => setScriptReady(true)}
      />
      <div
        ref={containerRef}
        className="min-h-[65px]"
        role="group"
        aria-label="Security verification"
        aria-busy={!scriptReady}
      />
    </>
  )
}
