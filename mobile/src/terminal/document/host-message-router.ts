import type { TerminalDocumentScope } from './document-scope'
import { scheduleDocumentFrame } from './document-frame-registry'
import { applyFitScale } from './fit-scale'
import { fitDimensionsFromCell } from '../terminal-grid-fit'
import { notify } from './host-notify'
import { emitKeyboardAvoidanceMetrics } from './keyboard-avoidance-metrics'
import { emitModesIfChanged } from './mode-mirroring'
import { reflow } from './reflow'
import { resumeTerminalDataReplyAuthority } from './query-reply'
import { repositionOverlay } from './selection-overlay'
import { cancelSelect } from './selection-range'
import { resetEvictionCounter } from './selection-state-and-eviction'
import { applyTerminalTheme } from './terminal-theme'
import { init, resize, write } from './terminal-init'
import { applyTextScale } from './text-scaling'
import { flog } from './viewport-transform'
import { resetWriteQueue } from './write-queue'

/** One message from the host. Every field is optional because the router reads them by type. */
export type TerminalHostMessage = {
  id?: number
  type?: string
  cols?: number
  rows?: number
  initialData?: unknown
  terminalTheme?: Parameters<typeof applyTerminalTheme>[1]
  fontScale?: number
  preserveScroll?: boolean
  oscLinks?: unknown
  data?: string
  containerHeight?: number
  containerWidth?: number
}

export function measureFitDimensions(
  scope: TerminalDocumentScope,
  frame: { width: number; height: number },
  retriesLeft?: number
) {
  if (typeof retriesLeft !== 'number') {
    retriesLeft = 30
  }
  // Why: init and measure are posted back-to-back from React, but
  // init has an async rAF chain. A measure that runs synchronously
  // after init can find term null, disposed, lacking element, or
  // with cells size 0. Retry the whole gate for ~500ms.
  const notReady = !scope.term || !scope.term.element
  let cellWidth = 0
  let cellHeight = 0
  if (!notReady) {
    const core = scope.term!._core
    if (core && core._renderService && core._renderService.dimensions) {
      cellWidth = core._renderService.dimensions.css.cell.width
      cellHeight = core._renderService.dimensions.css.cell.height
    }
  }
  if (notReady || cellWidth <= 0 || cellHeight <= 0) {
    if (retriesLeft > 0) {
      // Ruling 21: a retry that outlives its mount would answer the next mount's measure.
      const gen = scope.terminalGeneration
      scheduleDocumentFrame(scope, function () {
        if (gen !== scope.terminalGeneration) {
          return
        }
        measureFitDimensions(scope, frame, retriesLeft - 1)
      })
      return
    }
    flog(scope, 'measure-fail', {
      notReady: notReady,
      cellWidth: cellWidth,
      cellHeight: cellHeight,
      retriesLeft: retriesLeft
    })
    notify(scope, { type: 'measure-result', cols: null, rows: null })
    return
  }
  // Why: the frame box React Native laid out, fitted by the app's own formula, so this measure and
  // the first subscribe's fit agree to the column.
  const fit = fitDimensionsFromCell({ cellWidth, cellHeight }, frame.width, frame.height)
  if (!fit) {
    flog(scope, 'measure-skip-small-width', {
      frameWidth: frame.width,
      cellWidth: cellWidth
    })
    notify(scope, { type: 'measure-result', cols: null, rows: null })
    return
  }
  // Why: the rows we report become the PTY's actual row count after the
  // server fits to viewport, and xterm renders exactly that many lines
  // anchored top-left of the WebView. Any safety margin between the prompt
  // and the accessory bar must come from RN layout, not from undersizing the PTY.
  notify(scope, { type: 'measure-result', cols: fit.cols, rows: fit.rows })
}

export function handleMsg(scope: TerminalDocumentScope, msg: TerminalHostMessage) {
  if (typeof msg.id === 'number') {
    // oxlint-disable-next-line unicorn/prefer-includes -- the document's text is pinned token for token; rewriting this changes the native program
    if (scope.handledMessageIds.indexOf(msg.id) !== -1) {
      return
    }
    scope.handledMessageIds.push(msg.id)
    if (scope.handledMessageIds.length > 256) {
      scope.handledMessageIds.shift()
    }
  }
  if (msg.type === 'ping') {
    notify(scope, { type: 'pong', pingId: msg.id })
  } else if (msg.type === 'init') {
    init(
      scope,
      msg.cols!,
      msg.rows!,
      msg.initialData,
      msg.terminalTheme,
      msg.fontScale,
      msg.preserveScroll!,
      msg.oscLinks
    )
  } else if (msg.type === 'set-font-scale') {
    // Why: ignore RN echoing back the value a pinch just set (msg.fontScale ===
    // currentTextScale) so the post-pinch state isn't reset; only apply changes.
    if (
      typeof msg.fontScale === 'number' &&
      msg.fontScale > 0 &&
      msg.fontScale !== scope.currentTextScale
    ) {
      scope.userScale = 1
      scope.panX = 0
      scope.panY = 0
      applyTextScale(scope, msg.fontScale)
    }
  } else if (msg.type === 'resize') {
    resize(scope, msg.cols!, msg.rows!)
  } else if (msg.type === 'reflow') {
    reflow(scope, msg.cols!, msg.rows!)
  } else if (msg.type === 'write') {
    write(scope, msg.data!)
  } else if (msg.type === 'clear') {
    scope.terminalGeneration++
    resetWriteQueue(scope)
    resumeTerminalDataReplyAuthority(scope) // Why: clear drops the replay boundary.
    scope.statusDotPendingSelector = false
    scope.afterDrainCallbacks = []
    scope.writesDraining = false
    scope.mouseModeScanTail = ''
    scope.trackedMouseTrackingMode = 'none'
    scope.sgrMouseMode = false
    scope.sgrMousePixelsMode = false
    scope.initialOscLinks = []
    scope.initialOscLinkRowOffset = 0
    scope.initialOscLinkEvictionReady = false
    if (scope.term) {
      scope.term.clear()
      scope.term.reset()
    }
    emitModesIfChanged(scope)
    emitKeyboardAvoidanceMetrics(scope)
    resetEvictionCounter(scope)
    if (scope.selMode === 'select') {
      notify(scope, { type: 'selection-evicted' })
      cancelSelect(scope)
    }
  } else if (msg.type === 'measure') {
    const height =
      typeof msg.containerHeight === 'number' && msg.containerHeight > 0
        ? msg.containerHeight
        : scope.viewportRect().height
    const width = typeof msg.containerWidth === 'number' ? msg.containerWidth : 0
    scope.hostFrame = width > 0 ? { width, height } : null
    measureFitDimensions(scope, { width, height })
  } else if (msg.type === 'reset-zoom') {
    applyFitScale(scope, 'reset-zoom-msg')
  } else if (msg.type === 'set-theme') {
    applyTerminalTheme(scope, msg.terminalTheme)
  } else if (msg.type === 'cancel-select') {
    if (scope.selMode === 'select') {
      cancelSelect(scope)
    }
  } else if (msg.type === 'do-select-all') {
    if (scope.term) {
      try {
        scope.term.selectAll()
        const b = scope.term.buffer.active
        if (scope.selMode !== 'select') {
          scope.selMode = 'select'
          scope.selectionOverlay!.classList.add('active')
          notify(scope, { type: 'set-select-mode', enabled: true })
        }
        scope.sel = {
          anchor: { col: 0, row: 0 },
          focus: { col: scope.term.cols - 1, row: b.length - 1 },
          activeHandle: null
        }
        repositionOverlay(scope)
      } catch {}
    }
  }
}
