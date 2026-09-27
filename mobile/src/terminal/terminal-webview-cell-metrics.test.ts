import { createElement, createRef } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalWebView } from './TerminalWebView'
import { terminalCellBoxes } from './terminal-cell-metrics'
import type { TerminalWebViewHandle } from './terminal-webview-contract'

const nativeWebViewMethods = vi.hoisted(() => ({
  postMessage: vi.fn<(message: string) => void>(),
  reload: vi.fn<() => void>()
}))

vi.mock('react-native', () => ({
  AppState: { currentState: 'active' },
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  StyleSheet: {
    absoluteFillObject: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
    create: (styles: unknown) => styles
  },
  Text: 'Text',
  View: 'View'
}))

vi.mock('react-native-webview', async () => {
  const React = await import('react')
  const WebView = React.forwardRef((props: Record<string, unknown>, ref) => {
    React.useImperativeHandle(ref, () => nativeWebViewMethods)
    return React.createElement('WebView', props)
  })
  return { WebView, default: WebView }
})

vi.mock('lucide-react-native', () => ({ RefreshCw: 'RefreshCw' }))

const CELL_1X = { fontScale: 1, cellWidth: 23 / 3, cellHeight: 15 }
const FRAME = { width: 427, height: 710 }

const renderers: ReactTestRenderer[] = []
beforeEach(() => {
  terminalCellBoxes.clear()
})
afterEach(() => {
  act(() => renderers.splice(0).forEach((renderer) => renderer.unmount()))
  nativeWebViewMethods.postMessage.mockClear()
})

function mount(textScale = 1) {
  const ref = createRef<TerminalWebViewHandle>()
  const onCellBoxChange = vi.fn()
  let renderer: ReactTestRenderer | undefined
  act(() => {
    renderer = create(createElement(TerminalWebView, { ref, textScale, onCellBoxChange }))
  })
  renderers.push(renderer!)
  const handle = () => {
    if (!ref.current) {
      throw new Error('no handle')
    }
    return ref.current
  }
  const notify = (payload: Record<string, unknown>) => {
    act(() => {
      renderer!.root
        .find((node) => typeof node.props.onMessage === 'function')
        .props.onMessage({ nativeEvent: { data: JSON.stringify(payload) } })
    })
  }
  const webView = () => renderer!.root.find((node) => typeof node.props.onMessage === 'function')
  return { handle, notify, onCellBoxChange, webView }
}

function postedTypes(): unknown[] {
  return nativeWebViewMethods.postMessage.mock.calls.map(([message]) => JSON.parse(message).type)
}

const cellMetrics = (cellWidth: number, cols: number, rows = 47) => ({
  type: 'cell-metrics',
  cellMetrics: [{ fontScale: 1, cellWidth, cellHeight: 15 }],
  cols,
  rows
})

describe('the cell box xterm laid out', () => {
  it('sizes a fit from web-ready, which the document sends once its terminal is built', () => {
    const { handle, notify } = mount()
    expect(handle().fitDimensions(FRAME)).toBeNull()
    notify({ type: 'web-ready', cellMetrics: [CELL_1X] })
    expect(handle().fitDimensions(FRAME)).toEqual({ cols: 55, rows: 47 })
    expect(postedTypes()).not.toContain('measure')
  })

  it('lets a later open at the same text size fit before its document is ready', () => {
    const first = mount()
    first.notify({ type: 'web-ready', cellMetrics: [CELL_1X] })
    const second = mount()
    expect(second.handle().fitDimensions(FRAME)).toEqual({ cols: 55, rows: 47 })
  })

  it('does not fit a text size nothing has laid out yet', () => {
    const first = mount()
    first.notify({ type: 'web-ready', cellMetrics: [CELL_1X] })
    expect(mount(1.25).handle().fitDimensions(FRAME)).toBeNull()
  })

  it('refits when the box changes at the same grid, as after a renderer swap', () => {
    const { handle, notify, onCellBoxChange } = mount()
    notify({ type: 'web-ready', cellMetrics: [CELL_1X] })
    notify(cellMetrics(23 / 3, 55))
    expect(onCellBoxChange).not.toHaveBeenCalled()
    notify(cellMetrics(7.8, 55))
    expect(onCellBoxChange).toHaveBeenCalledTimes(1)
    expect(handle().fitDimensions(FRAME)).toEqual({ cols: 54, rows: 47 })
  })

  it('does not refit a box that came with a new grid, which the DOM renderer derives from cols', () => {
    const { notify, onCellBoxChange } = mount()
    notify({ type: 'web-ready', cellMetrics: [CELL_1X] })
    notify(cellMetrics(7.8, 55))
    notify(cellMetrics(7.9, 54))
    notify(cellMetrics(7.8, 55))
    expect(onCellBoxChange).not.toHaveBeenCalled()
  })

  it('refits an open that subscribed from a stored box when its document lays out another', () => {
    mount().notify({ type: 'web-ready', cellMetrics: [CELL_1X] })
    const second = mount()
    second.notify({ type: 'web-ready', cellMetrics: [{ ...CELL_1X, cellWidth: 7.8 }] })
    expect(second.onCellBoxChange).toHaveBeenCalledTimes(1)
  })

  it('measures the live document for a refit', async () => {
    const { handle, notify } = mount()
    notify({ type: 'web-ready', cellMetrics: [CELL_1X] })
    const pending = handle().measureFitDimensions(710)
    expect(postedTypes()).toContain('measure')
    notify({ type: 'measure-result', cols: 55, rows: 47 })
    await expect(pending).resolves.toEqual({ cols: 55, rows: 47 })
  })

  it('tells the document the app text scale before it builds its terminal', () => {
    const { webView } = mount(1.25)
    expect(webView().props.injectedJavaScriptBeforeContentLoaded).toContain(
      'window.__orcaTerminalTextScale = 1.25'
    )
  })
})
