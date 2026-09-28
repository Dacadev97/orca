import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalWebViewHandle } from './terminal-webview-contract'
import { useTerminalViewportRefit, type TerminalViewportDims } from './terminal-viewport-refit'

vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  Platform: { OS: 'android' },
  useWindowDimensions: () => ({ width: 427, height: 900 })
}))

const HANDLE = 'term-1'

/** The session's refit over one open terminal whose document now fits `measured`. */
function refitHarness(measured: TerminalViewportDims) {
  const terminal: TerminalWebViewHandle = {
    prepareForForegroundRecovery: vi.fn(),
    write: vi.fn(),
    init: vi.fn(),
    resize: vi.fn(),
    reflow: vi.fn(),
    clear: vi.fn(),
    fitDimensions: vi.fn(() => null),
    measureFitDimensions: vi.fn(async () => measured),
    resetZoom: vi.fn(),
    cancelSelect: vi.fn(),
    doSelectAll: vi.fn(),
    awaitReady: vi.fn(async () => {})
  }
  const viewportRef: { current: TerminalViewportDims | null } = { current: { cols: 55, rows: 47 } }
  const subscribeToTerminal = vi.fn()
  const unsubscribeTerminal = vi.fn()
  let notify: ((handle: string) => void) | undefined
  function Probe() {
    notify = useTerminalViewportRefit({
      activeHandleRef: { current: HANDLE },
      terminalRefs: { current: new Map([[HANDLE, terminal]]) },
      terminalFrameHeightRef: { current: 710 },
      viewportRef,
      viewportMeasuredRef: { current: true },
      nativeChatCoveredRef: { current: false },
      clientRef: { current: null },
      deviceTokenRef: { current: null },
      initializedHandlesRef: { current: new Set([HANDLE]) },
      connState: 'connected',
      tabStripVisible: false,
      textScale: 1,
      terminalFrameWidth: 427,
      unsubscribeTerminal,
      subscribeToTerminal
    }).notifyTerminalCellBoxChange
    return null
  }
  act(() => {
    renderer = create(createElement(Probe))
  })
  return {
    terminal,
    viewportRef,
    subscribeToTerminal,
    report: (handle: string) => act(() => notify!(handle))
  }
}

let renderer: ReactTestRenderer | undefined
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = undefined
  vi.useRealTimers()
})

describe('a new cell box for the open terminal', () => {
  it('refits the PTY to the grid the new box fits, as after a renderer swap', async () => {
    const harness = refitHarness({ cols: 54, rows: 47 })
    harness.report(HANDLE)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })
    expect(harness.terminal.measureFitDimensions).toHaveBeenCalledWith(710, 427)
    expect(harness.viewportRef.current).toEqual({ cols: 54, rows: 47 })
    expect(harness.subscribeToTerminal).toHaveBeenCalledWith(HANDLE)
  })

  it('leaves a terminal that is not on screen alone', async () => {
    const harness = refitHarness({ cols: 54, rows: 47 })
    harness.report('term-2')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })
    expect(harness.terminal.measureFitDimensions).not.toHaveBeenCalled()
  })
})
