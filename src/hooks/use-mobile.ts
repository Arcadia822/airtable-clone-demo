import * as React from "react"

const MOBILE_BREAKPOINT = 768

function getSnapshot() {
  return window.innerWidth < MOBILE_BREAKPOINT
}

function getServerSnapshot() {
  return false
}

function subscribe(callback: () => void) {
  const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mediaQuery.addEventListener("change", callback)
  return () => mediaQuery.removeEventListener("change", callback)
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * Queries narrower than this are too tight for the calendar grid and the
 * timeline track, so both views fall back to a stacked list.
 */
const COMPACT_VIEWPORT_MAX_WIDTH = 640
const COMPACT_MEDIA_QUERY = `(max-width: ${COMPACT_VIEWPORT_MAX_WIDTH}px)`

function getCompactSnapshot() {
  return window.innerWidth <= COMPACT_VIEWPORT_MAX_WIDTH
}

function getCompactServerSnapshot() {
  return false
}

function subscribeCompact(callback: () => void) {
  // jsdom (and very old browsers) have no matchMedia; the snapshot still reads
  // `window.innerWidth`, so a 375 px test viewport works without it.
  if (typeof window.matchMedia !== "function") return () => {}
  const mediaQuery = window.matchMedia(COMPACT_MEDIA_QUERY)
  mediaQuery.addEventListener("change", callback)
  return () => mediaQuery.removeEventListener("change", callback)
}

export function useCompactViewport() {
  return React.useSyncExternalStore(
    subscribeCompact,
    getCompactSnapshot,
    getCompactServerSnapshot,
  )
}
