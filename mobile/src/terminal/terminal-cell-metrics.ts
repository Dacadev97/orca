/**
 * The cell box xterm lays out, per text size, so a first subscribe can carry the phone's dims.
 *
 * The document builds its terminal before it reports ready, puts that box in `web-ready`, and
 * reports it again whenever xterm lays out a different one.
 */

export type TerminalCellMetrics = { fontScale: number; cellWidth: number; cellHeight: number }

export type TerminalFitDimensions = { cols: number; rows: number }

/** Below these the fit is not a terminal anyone can read, and the caller disables fit-to-phone. */
export const MIN_FIT_COLS = 20
export const MIN_FIT_ROWS = 8

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/** The notify's `cellMetrics`, keeping only well-formed entries; absent on an older document. */
export function readTerminalCellMetrics(msg: Record<string, unknown>): TerminalCellMetrics[] {
  if (!Array.isArray(msg.cellMetrics)) {
    return []
  }
  const entries: TerminalCellMetrics[] = []
  const reported: unknown[] = msg.cellMetrics
  for (const entry of reported) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !('fontScale' in entry && 'cellWidth' in entry && 'cellHeight' in entry)
    ) {
      continue
    }
    const fontScale = positive(entry.fontScale)
    const cellWidth = positive(entry.cellWidth)
    const cellHeight = positive(entry.cellHeight)
    if (fontScale !== null && cellWidth !== null && cellHeight !== null) {
      entries.push({ fontScale, cellWidth, cellHeight })
    }
  }
  return entries
}

/** The document's own measure, from numbers instead of a live terminal. */
export function fitDimensionsFromCell(
  cell: Pick<TerminalCellMetrics, 'cellWidth' | 'cellHeight'>,
  width: number,
  height: number
): TerminalFitDimensions | null {
  const cols = Math.floor(width / cell.cellWidth)
  if (cols < MIN_FIT_COLS) {
    return null
  }
  return { cols, rows: Math.max(MIN_FIT_ROWS, Math.floor(height / cell.cellHeight)) }
}

/** The boxes xterm laid out, per text size. */
export function createTerminalCellBoxStore() {
  const cells = new Map<number, TerminalCellMetrics>()
  return {
    get(fontScale: number): TerminalCellMetrics | undefined {
      return cells.get(fontScale)
    },
    /** Returns true when this replaced a different box for the same text size. */
    record(entry: TerminalCellMetrics): boolean {
      const previous = cells.get(entry.fontScale)
      cells.set(entry.fontScale, entry)
      return (
        previous !== undefined &&
        (previous.cellWidth !== entry.cellWidth || previous.cellHeight !== entry.cellHeight)
      )
    },
    clear() {
      cells.clear()
    }
  }
}

/**
 * For the app's lifetime, so an open at a text size already laid out sizes its first subscribe
 * before its document is ready; the first open at a size waits for that document's report.
 */
export const terminalCellBoxes = createTerminalCellBoxStore()
