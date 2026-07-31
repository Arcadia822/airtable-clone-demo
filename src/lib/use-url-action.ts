"use client"

import { useCallback } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

export function useUrlAction(
  action: string,
): readonly [boolean, (open: boolean) => void] {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const open = searchParams.get("action") === action

  const setOpen = useCallback(
    (nextOpen: boolean) => {
      const params = new URLSearchParams(searchParams.toString())
      if (nextOpen) {
        params.set("action", action)
      } else if (params.get("action") === action) {
        params.delete("action")
      }
      const query = params.toString()
      const href = query ? `${pathname}?${query}` : pathname
      if (nextOpen) {
        router.push(href, { scroll: false })
      } else {
        router.replace(href, { scroll: false })
      }
    },
    [action, pathname, router, searchParams],
  )

  return [open, setOpen] as const
}
