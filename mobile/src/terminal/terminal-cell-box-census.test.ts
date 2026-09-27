import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { censusSourceFiles } from '../test-support/census-source-files'

const SOURCE_ROOT = fileURLToPath(new URL('..', import.meta.url))

// xterm is the only measurer of the cell box. These are the page-side prediction (a copy of
// xterm's char measure and renderer rounding), the per-text-size guess table, and the
// once-per-document correction that reconciled the two.
const DELETED = [
  'measureCellMetrics',
  'createCharMeasure',
  'DOM_MEASURE_REPEAT',
  'webglRendererExpected',
  'fontBoundingBoxAscent',
  'measureText(',
  'createTerminalCellMetricsStore',
  'guessedScales',
  'acceptWebReady',
  'acceptLaidOut',
  'FIT_BOUNDARY_EPSILON',
  'useTerminalCellBoxRefit',
  'handleTerminalCellBoxChange'
]

function productSources(): { path: string; text: string }[] {
  return censusSourceFiles(SOURCE_ROOT)
    .map((path) => ({ path, name: relative(SOURCE_ROOT, path).replaceAll('\\', '/') }))
    .filter(({ name }) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map(({ path, name }) => ({ path: name, text: readFileSync(path, 'utf8') }))
}

describe('the cell box has one measurer', () => {
  it('walks the product sources, including the document that reports the box', () => {
    const paths = productSources().map((source) => source.path)
    expect(paths).toContain('terminal/document/laid-out-cell-box.ts')
    expect(paths).toContain('terminal/terminal-cell-metrics.ts')
  })

  it('has no file under mobile/src predict or reconcile what xterm lays out', () => {
    const found = productSources().flatMap(({ path, text }) =>
      DELETED.filter((symbol) => text.includes(symbol)).map((symbol) => `${path}: ${symbol}`)
    )
    expect(found).toEqual([])
  })
})
