import type { RefObject } from 'react'

/** The one writer of the grid the document holds, as seeded or reported; says if it already held it. */
export function holdGrid(held: RefObject<string | null>, cols: unknown, rows: unknown): boolean {
  const grid = `${String(cols)}x${String(rows)}`
  const same = grid === held.current
  held.current = grid
  return same
}
