import type { TerminalCellMetrics } from '../terminal-cell-metrics'
import type { TerminalDocumentScope } from './document-scope'
import { notify } from './host-notify'
import { fontPxForScale } from './text-scaling'

/** The box xterm actually laid out, for the scale it was opened at. */
export function laidOutCellMetrics(scope: TerminalDocumentScope): TerminalCellMetrics[] {
  const core = scope.term && scope.term._core
  const dimensions = core && core._renderService && core._renderService.dimensions
  if (!dimensions || !scope.term) {
    return []
  }
  const { width, height } = dimensions.css.cell
  if (!(width > 0 && height > 0)) {
    return []
  }
  // A text-size change between init and ready leaves a box that belongs to neither scale.
  if (scope.term.options.fontSize !== fontPxForScale(scope.currentTextScale)) {
    return []
  }
  return [{ fontScale: scope.currentTextScale, cellWidth: width, cellHeight: height }]
}

/**
 * Tells the host the box xterm laid out whenever it changes: after init, a renderer swap on
 * context loss, a text-size or DPR change, or a resize (the DOM renderer's width depends on cols).
 */
export function reportLaidOutCellBox(scope: TerminalDocumentScope) {
  const [laidOut] = laidOutCellMetrics(scope)
  if (!laidOut || !scope.term) {
    return
  }
  const key = laidOut.fontScale + ':' + laidOut.cellWidth + 'x' + laidOut.cellHeight
  if (key === scope.reportedCellBox) {
    return
  }
  scope.reportedCellBox = key
  notify(scope, {
    type: 'cell-metrics',
    cellMetrics: [laidOut],
    cols: scope.term.cols,
    rows: scope.term.rows
  })
}
