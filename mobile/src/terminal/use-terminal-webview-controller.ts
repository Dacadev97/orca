import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { TerminalOscLinkRange } from '../../../src/shared/terminal-osc-link-ranges'
import { readTerminalCellMetrics, terminalCellBoxes } from './terminal-cell-metrics'
import { useTerminalViewGeneration } from './terminal-view-generation'
import { holdGrid } from './terminal-held-grid'
import { createDocumentInitTracker } from './terminal-document-init-tracker'
import type { TerminalWebViewHandle, TerminalWebViewProps } from './terminal-webview-contract'
import { useTerminalWebViewEngineErrorState } from './terminal-webview-engine-error-state'
import { useTerminalWebReadyWatchdog } from './terminal-webview-ready-watchdog'
import type { TerminalWebViewCommand } from './terminal-webview-messages'
import { createTerminalWebViewPendingMessages } from './terminal-webview-pending-messages'
import { dispatchTerminalWebViewNotification } from './terminal-webview-notification-dispatch'
import { routeTerminalQueryReply } from './terminal-webview-query-reply-routing'
import { useTerminalWebViewReadyPromises } from './terminal-webview-ready-promises'
import { createTerminalWriteCoalescer } from './terminal-write-coalescer'

/**
 * Everything `TerminalWebView` does that is not about `react-native-webview`.
 *
 * The document is the same program on both platforms — inside the WebView it is the generated
 * script, on the page it is the modules that script is generated from — so the readiness
 * handshake, the pending queue, the write coalescer, the ready and measure promises and the whole
 * imperative handle are the same too. What differs is only how a command reaches the document and
 * how a notify comes back: a `postMessage` across the WebView bridge, or a direct call.
 *
 * So that difference is the two arguments, and both components are the small part that is left.
 * Writing the page's half as a second copy of this would be the fork the series exists to avoid:
 * the handle is the contract every consumer above it holds, and two implementations of it drift.
 */

export type TerminalWebViewTransport = {
  /** Hands one command, with its id already assigned, to the document. */
  post: (command: TerminalWebViewCommand & { id: number }) => void
  /**
   * Whether returning to the foreground has to re-prove the document is alive.
   *
   * iOS can keep the native view while discarding the WebView's JS state, so the native side
   * pings and replays nothing until that exact document answers. The page has no second content
   * process to lose: its document is the page's own modules, and if they were gone so was the
   * component holding this handle.
   *
   * Asked at the moment of recovery rather than at render, because the platform the native
   * component reads is the running one and a handle built once must not cache it.
   */
  pingsOnForegroundRecovery: () => boolean
}

export function useTerminalWebViewController(
  props: TerminalWebViewProps,
  transport: TerminalWebViewTransport
) {
  const {
    terminalTheme,
    textScale = 1,
    onWebReady,
    onEngineError,
    onSelectionMode,
    onSelectionCopy,
    onSelectionEvicted,
    onModesChanged,
    onKeyboardAvoidanceMetrics,
    onHaptic,
    onTerminalInput,
    onTerminalQueryReply,
    onTerminalTap,
    onFileTap,
    onOpenUrl,
    onTextScaleChange,
    onCellBoxChange
  } = props
  const { pingsOnForegroundRecovery, post } = transport
  const isWebReadyRef = useRef(false)
  const pendingMessages = useMemo(() => createTerminalWebViewPendingMessages(), [])
  const messageIdRef = useRef(0)
  const pendingPingIdRef = useRef<number | null>(null)
  const terminalThemeKey = useMemo(() => JSON.stringify(terminalTheme ?? null), [terminalTheme])
  // Why: each init() call posts 'init' to the document and arms a fresh ready promise. The
  // document's init() rAF chain ends with a 'ready' notify that resolves it. measureFitDimensions
  // awaits this so it doesn't race ahead of term.open() / renderService population.
  const promises = useTerminalWebViewReadyPromises()
  // Why: a box that changes while the grid does not is a renderer or pixel-ratio change and needs a
  // refit; one that arrives with a new grid is that grid's own (the DOM renderer's width follows cols).
  // The last grid is the one last reported, or fitted from the stored box, across documents. The
  // document reports every grid change, so an in-place reflow is held before a later renderer swap.
  const lastGridRef = useRef<string | null>(null)
  const { clearEngineError, engineError, reportEngineError, reportNativeEngineError } =
    useTerminalWebViewEngineErrorState(onEngineError)
  const { armWebReadyWatchdog, clearWebReadyWatchdog } = useTerminalWebReadyWatchdog(
    isWebReadyRef,
    reportEngineError
  )

  const initTracker = useMemo(() => createDocumentInitTracker(), [])

  const sendToDocument = useCallback(
    (msg: TerminalWebViewCommand) => {
      initTracker.delivered(msg)
      messageIdRef.current += 1
      const id = messageIdRef.current
      post({ ...msg, id })
      return id
    },
    [initTracker, post]
  )

  const flushPendingMessages = useCallback(() => {
    pendingMessages.flush(sendToDocument)
  }, [pendingMessages, sendToDocument])

  const postMessage = useCallback(
    (msg: TerminalWebViewCommand) => {
      if (!isWebReadyRef.current) {
        pendingMessages.queue(msg)
        return
      }
      sendToDocument(msg)
    },
    [pendingMessages, sendToDocument]
  )

  // Why: a busy PTY delivers ~200 stream frames/s; coalescing here collapses the
  // per-frame bridge + WebKit IPC + paint cost that runs the phone hot (#9302).
  const writeCoalescer = useMemo(
    () => createTerminalWriteCoalescer((data) => postMessage({ type: 'write', data })),
    [postMessage]
  )

  useEffect(() => {
    return () => {
      writeCoalescer.clear()
    }
  }, [writeCoalescer])

  /**
   * The document is gone or about to be replaced: nothing queued belongs to the next one.
   *
   * Why: messages queued for a previous generation are stale after a reload; dropping them avoids
   * replaying terminal chunks before the next init snapshot.
   */
  const resetReadiness = useCallback(() => {
    isWebReadyRef.current = false
    pendingPingIdRef.current = null
    pendingMessages.clear()
    writeCoalescer.clear()
    armWebReadyWatchdog()
  }, [armWebReadyWatchdog, pendingMessages, writeCoalescer])
  const { viewGeneration, handleLoadStart, isCurrentView, replaceDocument } =
    useTerminalViewGeneration(resetReadiness, armWebReadyWatchdog)

  const confirmWebReady = useCallback(
    (notifyParent: boolean) => {
      pendingPingIdRef.current = null
      isWebReadyRef.current = true
      clearWebReadyWatchdog()
      clearEngineError()
      if (notifyParent) {
        onWebReady?.({ hasInit: initTracker.readyDocumentHasInit(pendingMessages.holds('init')) })
      }
      // Why: reload clears queued commands, so readiness must always restore the
      // native-selected theme even when its value did not change in React.
      sendToDocument({ type: 'set-theme', terminalTheme })
      flushPendingMessages()
    },
    [
      clearEngineError,
      clearWebReadyWatchdog,
      flushPendingMessages,
      initTracker,
      onWebReady,
      pendingMessages,
      sendToDocument,
      terminalTheme
    ]
  )

  /** One notify, already parsed, from the document the view built for `generation`. */
  const receive = useCallback(
    (msg: Record<string, unknown>, generation: number) => {
      if (!isCurrentView(generation)) {
        return
      }
      routeTerminalQueryReply(msg, onTerminalQueryReply)

      if (msg.type === 'web-ready') {
        initTracker.documentReady()
        // Why: an open that subscribed before ready used the stored box; a different one here refits it.
        const changed = readTerminalCellMetrics(msg).some(
          (entry) => terminalCellBoxes.record(entry) && entry.fontScale === textScale
        )
        confirmWebReady(true)
        if (changed) {
          onCellBoxChange?.()
        }
      } else if (
        msg.type === 'pong' &&
        typeof msg.pingId === 'number' &&
        msg.pingId === pendingPingIdRef.current
      ) {
        confirmWebReady(false)
      } else if (msg.type === 'ready') {
        // Why: the document's init() rAF chain has run — term is open, renderService is
        // populated, first paint has happened. Resolve any pending awaitReady() so a queued
        // measure can now safely read cell dims.
        promises.resolveReady()
      } else if (msg.type === 'cell-metrics') {
        const [laidOut] = readTerminalCellMetrics(msg)
        const sameGrid = holdGrid(lastGridRef, msg.cols, msg.rows)
        if (laidOut && terminalCellBoxes.record(laidOut) && sameGrid) {
          onCellBoxChange?.()
        }
      } else if (msg.type === 'measure-result') {
        promises.resolveMeasure(msg)
      } else {
        dispatchTerminalWebViewNotification(msg, {
          reportEngineError,
          onSelectionMode,
          onSelectionCopy,
          onSelectionEvicted,
          onModesChanged,
          onKeyboardAvoidanceMetrics,
          onHaptic,
          onTerminalInput,
          onTerminalTap,
          onFileTap,
          onOpenUrl,
          onTextScaleChange
        })
      }
    },
    [
      confirmWebReady,
      isCurrentView,
      promises,
      reportEngineError,
      onSelectionMode,
      onSelectionCopy,
      onSelectionEvicted,
      onModesChanged,
      onKeyboardAvoidanceMetrics,
      onHaptic,
      onTerminalInput,
      onTerminalQueryReply,
      onTerminalTap,
      onFileTap,
      onOpenUrl,
      onTextScaleChange,
      onCellBoxChange,
      textScale
    ]
  )

  useEffect(() => {
    postMessage({ type: 'set-theme', terminalTheme })
  }, [postMessage, terminalThemeKey, terminalTheme])

  // Why: live-apply text-size changes to an already-mounted terminal (the pane
  // stays alive while the user visits Settings), so no terminal reload is needed.
  useEffect(() => {
    postMessage({ type: 'set-font-scale', fontScale: textScale })
  }, [postMessage, textScale])

  const fitDimensions = useCallback(
    (frame: { width: number; height: number }) => terminalCellBoxes.fit(textScale, frame),
    [textScale]
  )

  const handle = useMemo<TerminalWebViewHandle>(
    () => ({
      prepareForForegroundRecovery() {
        if (!pingsOnForegroundRecovery()) {
          return
        }
        // Why: direct ping is the only command allowed through while readiness is
        // invalid; init/write commands queue until this exact document answers.
        isWebReadyRef.current = false
        armWebReadyWatchdog()
        pendingPingIdRef.current = sendToDocument({ type: 'ping' })
      },
      write(data: string) {
        writeCoalescer.write(data)
      },
      init(
        cols: number,
        rows: number,
        initialData?: string,
        preserveScroll?: boolean,
        oscLinks?: TerminalOscLinkRange[]
      ) {
        // Why: arm a fresh ready promise BEFORE posting init. The document resolves it via the
        // 'ready' notify at the end of its rAF chain.
        promises.armReady()
        // Why: pending chunks are pre-snapshot data; the init snapshot supersedes
        // them, and writing them after init would corrupt the fresh buffer.
        writeCoalescer.clear()
        postMessage({
          type: 'init',
          cols,
          rows,
          initialData,
          oscLinks,
          terminalTheme,
          fontScale: textScale,
          preserveScroll
        })
      },
      resize(cols: number, rows: number) {
        // Why: resize/reflow must observe all prior writes or bytes reorder.
        writeCoalescer.flushNow()
        postMessage({ type: 'resize', cols, rows })
      },
      reflow(cols: number, rows: number) {
        writeCoalescer.flushNow()
        postMessage({ type: 'reflow', cols, rows })
      },
      clear() {
        writeCoalescer.clear()
        postMessage({ type: 'clear' })
      },
      fitDimensions,
      seedFitDimensions(frame: { width: number; height: number }) {
        const fit = fitDimensions(frame)
        if (fit) {
          holdGrid(lastGridRef, fit.cols, fit.rows)
        }
        return fit
      },
      measureFitDimensions(frameHeight: number, frameWidth: number) {
        // Why: no fit until the frame is laid out; the layout's own refit measures then.
        if (!isWebReadyRef.current || !(frameHeight > 0 && frameWidth > 0)) {
          return Promise.resolve(null)
        }
        return promises.measure(sendToDocument, frameHeight, frameWidth)
      },
      resetZoom() {
        postMessage({ type: 'reset-zoom' })
      },
      cancelSelect() {
        postMessage({ type: 'cancel-select' })
      },
      doSelectAll() {
        postMessage({ type: 'do-select-all' })
      },
      // Why: waits on the in-flight ready promise (set by init); resolves immediately if no init
      // is pending, and is capped so a stuck document doesn't hang the caller.
      awaitReady: promises.awaitReady
    }),
    [
      armWebReadyWatchdog,
      fitDimensions,
      pingsOnForegroundRecovery,
      postMessage,
      promises,
      sendToDocument,
      terminalTheme,
      textScale,
      writeCoalescer
    ]
  )

  return {
    armWebReadyWatchdog,
    clearEngineError,
    confirmWebReady,
    viewGeneration,
    engineError,
    handle,
    receive,
    reportNativeEngineError,
    replaceDocument,
    handleLoadStart
  }
}
