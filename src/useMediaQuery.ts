import { useSyncExternalStore } from 'react'

/** Live result of a CSS media query. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/**
 * True when the primary pointer is a finger. On such devices Enter inserts a newline
 * and saving happens through the button, as in any messaging app on a phone.
 */
export const useIsTouch = () => useMediaQuery('(pointer: coarse)')
