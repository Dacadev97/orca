import { useEffect, useCallback } from 'react'
import type { TerminalWebViewHandle } from '../terminal/terminal-webview-contract'
import type { MobileSessionTabSwitchingModel } from './use-mobile-session-tab-switching'

export function useMobileSessionTerminalWebview(scope: MobileSessionTabSwitchingModel) {
  const {
    markdownDocs,
    fileDocs,
    terminalGestureInputBucketsRef,
    terminalGestureInputQueuesRef,
    terminalGestureInputInFlightRef,
    terminalRefs,
    terminalUnsubsRef,
    initializedHandlesRef,
    terminalDiagnosticsRef,
    webReadyHandlesRef,
    activeHandleRef,
    pendingActiveTerminalHandleRef,
    activeSessionTab,
    unsubscribeTerminal,
    subscribeToTerminal,
    nativeChatStream,
    readMarkdownTab,
    readFileTab
  } = scope
  // Why: only store the ref; subscribe on web-ready to avoid the blank-terminal race (init queued before xterm.js loaded).
  const setTerminalWebViewRef = useCallback((handle: string, ref: TerminalWebViewHandle | null) => {
    terminalDiagnosticsRef.current.webViewRef(handle, ref != null)
    if (ref) {
      terminalRefs.current.set(handle, ref)
    } else {
      terminalRefs.current.delete(handle)
      terminalGestureInputBucketsRef.current.delete(handle)
      const queued = terminalGestureInputQueuesRef.current.get(handle)
      if (queued?.timer) {
        clearTimeout(queued.timer)
      }
      terminalGestureInputQueuesRef.current.delete(handle)
      terminalGestureInputInFlightRef.current.delete(handle)
    }
  }, [])

  const handleTerminalWebReady = useCallback(
    (handle: string, documentHasInit: boolean) => {
      const wasAlreadyReady = webReadyHandlesRef.current.has(handle)
      webReadyHandlesRef.current.add(handle)
      nativeChatStream.notifyWebReady(handle, wasAlreadyReady)
      terminalDiagnosticsRef.current.webViewReady(
        handle,
        wasAlreadyReady,
        handle === activeHandleRef.current
      )
      if (initializedHandlesRef.current.has(handle) && !documentHasInit) {
        // Why: the subscription owes this document its init — a reload replaced the one that had it,
        // or dropped it while queued before the first ready — so resubscribe for a fresh scrollback.
        unsubscribeTerminal(handle)
        initializedHandlesRef.current.delete(handle)
        if (handle === activeHandleRef.current) {
          subscribeToTerminal(handle)
        }
        return
      }
      // Why: a just-created tab can lose activeHandleRef to a lagging snapshot; honor the pending marker so its web-ready subscribe still fires.
      const isIntendedActive =
        handle === activeHandleRef.current || handle === pendingActiveTerminalHandleRef.current
      // Why: web-ready carried the cell box xterm laid out, so subscribeToTerminal sizes this subscribe.
      if (isIntendedActive && !terminalUnsubsRef.current.has(handle)) {
        subscribeToTerminal(handle)
      }
    },
    [nativeChatStream, subscribeToTerminal, unsubscribeTerminal]
  )

  /** The frame has a size: an open whose text size has a known cell box subscribes now. */
  const handleTerminalFrameLayout = useCallback(() => {
    const handle = pendingActiveTerminalHandleRef.current ?? activeHandleRef.current
    if (handle && !terminalUnsubsRef.current.has(handle)) {
      subscribeToTerminal(handle)
    }
  }, [subscribeToTerminal])

  useEffect(() => {
    if (activeSessionTab?.type !== 'markdown') {
      return
    }
    const doc = markdownDocs.get(activeSessionTab.id)
    if (!doc) {
      void readMarkdownTab(activeSessionTab)
    }
  }, [activeSessionTab, markdownDocs, readMarkdownTab])

  useEffect(() => {
    if (activeSessionTab?.type !== 'file') {
      return
    }
    const doc = fileDocs.get(activeSessionTab.id)
    if (!doc) {
      void readFileTab(activeSessionTab)
    }
  }, [activeSessionTab, fileDocs, readFileTab])
  return {
    setTerminalWebViewRef,
    handleTerminalWebReady,
    handleTerminalFrameLayout
  }
}

export type MobileSessionTerminalWebviewModel = MobileSessionTabSwitchingModel &
  ReturnType<typeof useMobileSessionTerminalWebview>
