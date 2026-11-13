import * as React from "react"

const MOBILE_BREAKPOINT = 768

function getSnapshot() {
  return typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT : false
}

function getServerSnapshot() {
  return false
}

function subscribe(callback: () => void) {
  if (typeof window === 'undefined') return () => {}
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", callback)
  return () => mql.removeEventListener("change", callback)
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
