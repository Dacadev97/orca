import { useCallback, useRef, useState } from 'react'

/**
 * Which view holds the current document. A replaced document can still post, so each view tags its
 * notifies with the generation it was built for and any not from the current one are dropped.
 */
export function useTerminalViewGeneration(
  resetReadiness: () => void,
  armWebReadyWatchdog: () => void
) {
  const [viewGeneration, setViewGeneration] = useState(0)
  const currentRef = useRef(0)
  const documentLoadedRef = useRef(false)

  const isCurrentView = useCallback((generation: number) => generation === currentRef.current, [])

  /**
   * Only the first load start this controller ever sees keeps the queue: a subscribe sized from the
   * stored cell box queues init before it. Every later one, a replacement view's first included,
   * drops the queue and waits for a new ready; the hasInit resubscribe restores the init.
   */
  const handleLoadStart = useCallback(() => {
    if (!documentLoadedRef.current) {
      documentLoadedRef.current = true
      armWebReadyWatchdog()
      return
    }
    resetReadiness()
  }, [armWebReadyWatchdog, resetReadiness])

  /** Drops the document for a new one, which the view builds as `viewGeneration`. */
  const replaceDocument = useCallback(() => {
    resetReadiness()
    currentRef.current += 1
    setViewGeneration(currentRef.current)
  }, [resetReadiness])

  return { viewGeneration, handleLoadStart, isCurrentView, replaceDocument }
}
