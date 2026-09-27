import { describe, expect, it } from 'vitest'
import {
  createTerminalCellBoxStore,
  fitDimensionsFromCell,
  readTerminalCellMetrics
} from './terminal-cell-metrics'

// 23 device px at DPR 3: the WebGL renderer's 13px cell on the emulator.
const CELL_1X = { fontScale: 1, cellWidth: 23 / 3, cellHeight: 15 }
const CELL_125X = { fontScale: 1.25, cellWidth: 29 / 3, cellHeight: 19 }

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

describe('fitDimensionsFromCell', () => {
  it('fits the frame as the document measure does', () => {
    // floor(427 / 7.667) = 55, floor(710 / 15) = 47
    expect(fitDimensionsFromCell(CELL_1X, 427, 710)).toEqual({ cols: 55, rows: 47 })
  })

  it('answers null for a frame too narrow to fit', () => {
    expect(fitDimensionsFromCell(CELL_1X, 100, 710)).toBeNull()
  })
})

describe('createTerminalCellBoxStore', () => {
  it('keeps one box per text size', () => {
    const store = createTerminalCellBoxStore()
    store.record(CELL_1X)
    store.record(CELL_125X)
    expect(store.get(1)).toEqual(CELL_1X)
    expect(store.get(1.25)).toEqual(CELL_125X)
    expect(store.get(1.5)).toBeUndefined()
  })

  it('says when a box replaced a different one, and only then', () => {
    const store = createTerminalCellBoxStore()
    expect(store.record(CELL_1X)).toBe(false)
    expect(store.record(CELL_1X)).toBe(false)
    const domRenderer = { fontScale: 1, cellWidth: 7.8, cellHeight: 15 }
    expect(store.record(domRenderer)).toBe(true)
    expect(store.get(1)).toEqual(domRenderer)
  })
})
