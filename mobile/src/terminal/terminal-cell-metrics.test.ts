import { describe, expect, it } from 'vitest'
import { createTerminalCellBoxStore, readTerminalCellMetrics } from './terminal-cell-metrics'

// 23 device px at DPR 3: the WebGL renderer's 13px cell on the emulator.
const CELL_1X = { fontScale: 1, cellWidth: 23 / 3, cellHeight: 15 }
const CELL_125X = { fontScale: 1.25, cellWidth: 29 / 3, cellHeight: 19 }
const FRAME = { width: 427, height: 710 }

describe('readTerminalCellMetrics', () => {
  it('reads nothing from a notify without a cell box', () => {
    expect(readTerminalCellMetrics({ type: 'web-ready' })).toEqual([])
  })

  it('drops malformed entries and keeps the well-formed ones', () => {
    expect(
      readTerminalCellMetrics({
        cellMetrics: [null, { fontScale: 1, cellWidth: 0, cellHeight: 15 }, 'x', CELL_1X]
      })
    ).toEqual([CELL_1X])
  })
})

describe('createTerminalCellBoxStore', () => {
  it('keeps one box per text size', () => {
    const store = createTerminalCellBoxStore()
    store.record(CELL_1X)
    store.record(CELL_125X)
    expect(store.fit(1, FRAME)).toEqual({ cols: 55, rows: 47 })
    expect(store.fit(1.25, FRAME)).toEqual({ cols: 44, rows: 37 })
    expect(store.fit(1.5, FRAME)).toBeNull()
  })

  it('says when a box replaced a different one, and only then', () => {
    const store = createTerminalCellBoxStore()
    expect(store.record(CELL_1X)).toBe(false)
    expect(store.record(CELL_1X)).toBe(false)
    const domRenderer = { fontScale: 1, cellWidth: 7.8, cellHeight: 15 }
    expect(store.record(domRenderer)).toBe(true)
    expect(store.fit(1, FRAME)).toEqual({ cols: 54, rows: 47 })
  })
})
