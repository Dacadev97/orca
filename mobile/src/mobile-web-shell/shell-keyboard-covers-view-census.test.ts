/**
 * The shell never resizes the WebView for the keyboard: the keyboard covers the view like a native
 * screen and the page lifts by the height `init` carries. The symbols of the retired path (a view
 * shortened for pages that could not read the height) are named so a reintroduction goes red.
 */
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { censusSourceFiles } from '../test-support/census-source-files'

const SHELL_DIR = import.meta.dirname
const RETIRED =
  /softwareKeyboardWindowInset|viewShortenedBy|pageReadsKeyboardInset|shellPageReadsKeyboardInset|shellKeyboardGeometry|BRIDGE_KEYBOARD_INSET_ACCEPT|'keyboard-inset'/
const KEYBOARD_SIZES_VIEW = /\b(padding|margin)?(Bottom|bottom|height|Height)\s*:[^,}\n]*keyboard/i

/** Lines that bring back the retired path or size a view from the keyboard. */
export function keyboardResizesView(source: string): number[] {
  return source
    .split('\n')
    .flatMap((line, index) =>
      RETIRED.test(line) || KEYBOARD_SIZES_VIEW.test(line) ? [index + 1] : []
    )
}

describe('the shell and the keyboard', () => {
  it('finds the lines it is looking for', () => {
    expect(keyboardResizesView('style={{ paddingBottom: keyboardInset }}')).toEqual([1])
    expect(keyboardResizesView('  height: windowHeight - keyboardHeight,')).toEqual([1])
    expect(keyboardResizesView("accepts.includes('keyboard-inset')")).toEqual([1])
    expect(keyboardResizesView('const { viewShortenedBy } = geometry')).toEqual([1])
    expect(keyboardResizesView('{ paddingTop: insets.top, paddingBottom: insets.bottom }')).toEqual(
      []
    )
    expect(keyboardResizesView('publishKeyboardInset(keyboardInset)')).toEqual([])
  })

  it('never sizes the view from the keyboard', () => {
    const offenders = censusSourceFiles(SHELL_DIR)
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
      .flatMap((file) =>
        keyboardResizesView(readFileSync(file, 'utf8')).map(
          (line) => `${relative(SHELL_DIR, file)}:${line}`
        )
      )
    expect(offenders).toEqual([])
  })
})
