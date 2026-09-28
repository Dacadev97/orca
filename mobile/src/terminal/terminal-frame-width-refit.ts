import { useEffect, type RefObject } from 'react'
import type { TerminalWebViewHandle } from './terminal-webview-contract'

type TerminalGrid = { cols: number; rows: number }

/**
 * Whether a new frame width still holds the grid the PTY has, fitted from the stored cell box —
 * sub-pixel layout jitter does, and needs no refit. With no stored box it cannot say, so it refits.
 */
export function frameWidthKeepsGrid(
  terminal: Pick<TerminalWebViewHandle, 'fitDimensions'>,
  frame: { width: number; height: number },
  current: TerminalGrid | null
): boolean {
  const fit = terminal.fitDimensions(frame)
  return fit !== null && current !== null && fit.cols === current.cols && fit.rows === current.rows
}

type FrameWidthRefitOptions = {
  terminalFrameWidth: number
  /** The width the last refit measured with; written here, read by the measure. */
  frameWidthRef: RefObject<number>
  activeHandleRef: RefObject<string | null>
  terminalRefs: RefObject<Map<string, TerminalWebViewHandle>>
  terminalFrameHeightRef: RefObject<number>
  viewportRef: RefObject<TerminalGrid | null>
  viewportMeasuredRef: RefObject<boolean>
  scheduleViewportRefit: () => void
}

/**
 * Panel dock/undock or a sidebar resize changes the frame width with no window or tab change, so
 * the cached viewport goes stale — unless the new width holds the same grid.
 */
export function useFrameWidthRefit(options: FrameWidthRefitOptions): void {
  const {
    terminalFrameWidth,
    frameWidthRef,
    activeHandleRef,
    terminalRefs,
    terminalFrameHeightRef,
    viewportRef,
    viewportMeasuredRef,
    scheduleViewportRefit
  } = options
  useEffect(() => {
    if (frameWidthRef.current === terminalFrameWidth) {
      return
    }
    frameWidthRef.current = terminalFrameWidth
    const handle = activeHandleRef.current
    const terminal = handle ? terminalRefs.current.get(handle) : undefined
    const frame = { width: terminalFrameWidth, height: terminalFrameHeightRef.current }
    if (terminal && frameWidthKeepsGrid(terminal, frame, viewportRef.current)) {
      return
    }
    viewportMeasuredRef.current = false
    scheduleViewportRefit()
  }, [
    terminalFrameWidth,
    frameWidthRef,
    activeHandleRef,
    terminalRefs,
    terminalFrameHeightRef,
    viewportRef,
    viewportMeasuredRef,
    scheduleViewportRefit
  ])
}
