"use client"

import { useCallback } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

export function useUrlSelection(
  parameter: string,
): readonly [string | null, (value: string | null) => void] {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const selected = searchParams.get(parameter)

  const setSelected = useCallback(
    (value: string | null) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) {
        params.set(parameter, value)
      } else {
        params.delete(parameter)
      }
      const query = params.toString()
      const href = query ? `${pathname}?${query}` : pathname
      if (value) {
        router.push(href, { scroll: false })
      } else {
        router.replace(href, { scroll: false })
      }
    },
    [parameter, pathname, router, searchParams],
  )

  return [selected, setSelected] as const
}
