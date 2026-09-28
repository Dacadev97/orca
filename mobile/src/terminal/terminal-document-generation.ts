import { useCallback, useRef, useState } from 'react'

/**
 * Which document the view holds now. A replaced document can still post its ready, so the view
 * tags every notify with the generation it was built for and only the current one may flush.
 */
export function useTerminalDocumentGeneration(
  resetReadiness: () => void,
  armWebReadyWatchdog: () => void
) {
  const [documentGeneration, setDocumentGeneration] = useState(0)
  const currentRef = useRef(0)
  const documentLoadedRef = useRef(false)

  const isCurrentDocument = useCallback(
    (generation: number) => generation === currentRef.current,
    []
  )

  /** The WebView starts loading a document; only a reload replaces one that commands were queued for. */
  const handleLoadStart = useCallback(() => {
    // Why: a subscribe sized from the stored cell box queues init before the first load starts.
    if (!documentLoadedRef.current) {
      documentLoadedRef.current = true
      armWebReadyWatchdog()
      return
    }
    resetReadiness()
  }, [armWebReadyWatchdog, resetReadiness])

  /** Drops the document for a new one, which the view builds as `documentGeneration`. */
  const replaceDocument = useCallback(() => {
    resetReadiness()
    documentLoadedRef.current = false
    currentRef.current += 1
    setDocumentGeneration(currentRef.current)
  }, [resetReadiness])

  return { documentGeneration, handleLoadStart, isCurrentDocument, replaceDocument }
}
