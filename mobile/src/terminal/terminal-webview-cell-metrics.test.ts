import { createElement, createRef } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalWebView } from './TerminalWebView'
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

const FRAME = { width: 427, height: 710 }

// Why: the store lives for the app, so each case takes a text size no other case has laid out.
let lastScale = 2
const freshScale = () => (lastScale += 0.01)
let scale = freshScale()
const cellAt = (fontScale: number, cellWidth = 23 / 3) => ({ fontScale, cellWidth, cellHeight: 15 })

const renderers: ReactTestRenderer[] = []
beforeEach(() => {
  scale = freshScale()
})
afterEach(() => {
  act(() => renderers.splice(0).forEach((renderer) => renderer.unmount()))
  nativeWebViewMethods.postMessage.mockClear()
})

function mount(textScale = scale) {
  const ref = createRef<TerminalWebViewHandle>()
  const onCellBoxChange = vi.fn()
  const onWebReady = vi.fn<(document: { hasInit: boolean }) => void>()
  let renderer: ReactTestRenderer | undefined
  act(() => {
    renderer = create(
      createElement(TerminalWebView, { ref, textScale, onCellBoxChange, onWebReady })
    )
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
  return { handle, notify, onCellBoxChange, onWebReady, webView }
}

function postedTypes(): unknown[] {
  return nativeWebViewMethods.postMessage.mock.calls.map(([message]) => JSON.parse(message).type)
}

const cellMetrics = (cellWidth: number, cols: number, rows = 47) => ({
  type: 'cell-metrics',
  cellMetrics: [cellAt(scale, cellWidth)],
  cols,
  rows
})

describe('the cell box xterm laid out', () => {
  it('sizes a fit from web-ready, which the document sends once its terminal is built', () => {
    const { handle, notify } = mount()
    expect(handle().fitDimensions(FRAME)).toBeNull()
    notify({ type: 'web-ready', cellMetrics: [cellAt(scale)] })
    expect(handle().fitDimensions(FRAME)).toEqual({ cols: 55, rows: 47 })
    expect(postedTypes()).not.toContain('measure')
  })

  it('lets a later open at the same text size fit before its document is ready', () => {
    const first = mount()
    first.notify({ type: 'web-ready', cellMetrics: [cellAt(scale)] })
    const second = mount()
    expect(second.handle().fitDimensions(FRAME)).toEqual({ cols: 55, rows: 47 })
  })

  it('does not fit a text size nothing has laid out yet', () => {
    const first = mount()
    first.notify({ type: 'web-ready', cellMetrics: [cellAt(scale)] })
    expect(mount(freshScale()).handle().fitDimensions(FRAME)).toBeNull()
  })

  it('refits when the box changes at the same grid, as after a renderer swap', () => {
    const { handle, notify, onCellBoxChange } = mount()
    notify({ type: 'web-ready', cellMetrics: [cellAt(scale)] })
    notify(cellMetrics(23 / 3, 55))
    expect(onCellBoxChange).not.toHaveBeenCalled()
    notify(cellMetrics(7.8, 55))
    expect(onCellBoxChange).toHaveBeenCalledTimes(1)
    expect(handle().fitDimensions(FRAME)).toEqual({ cols: 54, rows: 47 })
  })

  it('does not refit a box that came with a new grid, which the DOM renderer derives from cols', () => {
    const { notify, onCellBoxChange } = mount()
    notify({ type: 'web-ready', cellMetrics: [cellAt(scale)] })
    notify(cellMetrics(7.8, 55))
    notify(cellMetrics(7.9, 54))
    notify(cellMetrics(7.8, 55))
    expect(onCellBoxChange).not.toHaveBeenCalled()
  })

  it('refits an open that subscribed from a stored box when its document lays out another', () => {
    mount().notify({ type: 'web-ready', cellMetrics: [cellAt(scale)] })
    const second = mount()
    second.notify({ type: 'web-ready', cellMetrics: [cellAt(scale, 7.8)] })
    expect(second.onCellBoxChange).toHaveBeenCalledTimes(1)
  })

  it('refits when the first box after a boxless ready differs from the one the subscribe used', () => {
    mount().notify({ type: 'web-ready', cellMetrics: [cellAt(scale)] })
    const second = mount()
    expect(second.handle().fitDimensions(FRAME)).toEqual({ cols: 55, rows: 47 })
    second.notify({ type: 'web-ready', cellMetrics: [] })
    second.notify(cellMetrics(7.8, 55))
    expect(second.onCellBoxChange).toHaveBeenCalledTimes(1)
  })

  it('measures the live document for a refit, against the frame the app laid out', async () => {
    const { handle, notify } = mount()
    notify({ type: 'web-ready', cellMetrics: [cellAt(scale)] })
    const pending = handle().measureFitDimensions(710, 427.5)
    expect(
      nativeWebViewMethods.postMessage.mock.calls
        .map(([message]) => JSON.parse(message))
        .find((message) => message.type === 'measure')
    ).toMatchObject({ containerHeight: 710, containerWidth: 427.5 })
    notify({ type: 'measure-result', cols: 55, rows: 47 })
    await expect(pending).resolves.toEqual({ cols: 55, rows: 47 })
  })

  it('keeps an init queued before the first document loads, as a subscribe from the store does', () => {
    const { handle, notify, webView } = mount()
    handle().init(55, 47, 'snapshot')
    act(() => webView().props.onLoadStart())
    notify({ type: 'web-ready', cellMetrics: [cellAt(scale)] })
    expect(postedTypes()).toContain('init')
  })

  it('drops what was queued for a document that a reload replaces', () => {
    const { handle, notify, webView } = mount()
    act(() => webView().props.onLoadStart())
    handle().init(55, 47, 'snapshot')
    act(() => webView().props.onLoadStart())
    notify({ type: 'web-ready', cellMetrics: [cellAt(scale)] })
    expect(postedTypes()).not.toContain('init')
  })

  it('tells the session a document that lost its queued init to a reload before its first ready', () => {
    const { handle, notify, onWebReady, webView } = mount()
    act(() => webView().props.onLoadStart())
    handle().init(55, 47, 'snapshot')
    act(() => webView().props.onLoadStart())
    notify({ type: 'web-ready', cellMetrics: [cellAt(scale)] })
    expect(onWebReady).toHaveBeenLastCalledWith({ hasInit: false })
  })

  it('tells the session the first document holds an init queued for it', () => {
    const { handle, notify, onWebReady, webView } = mount()
    handle().init(55, 47, 'snapshot')
    act(() => webView().props.onLoadStart())
    notify({ type: 'web-ready', cellMetrics: [cellAt(scale)] })
    expect(onWebReady).toHaveBeenLastCalledWith({ hasInit: true })
  })

  it('tells the session a reloaded document never saw the init the last one was given', () => {
    const { handle, notify, onWebReady, webView } = mount()
    act(() => webView().props.onLoadStart())
    notify({ type: 'web-ready', cellMetrics: [cellAt(scale)] })
    handle().init(55, 47, 'snapshot')
    act(() => webView().props.onLoadStart())
    notify({ type: 'web-ready', cellMetrics: [cellAt(scale)] })
    expect(onWebReady).toHaveBeenLastCalledWith({ hasInit: false })
  })

  it('tells the document the app text scale before it builds its terminal', () => {
    const { webView } = mount(1.25)
    expect(webView().props.injectedJavaScriptBeforeContentLoaded).toContain(
      'window.__orcaTerminalTextScale = 1.25'
    )
  })

  it('tells a document whose view was hidden at mount not to build before ready', () => {
    let renderer: ReactTestRenderer | undefined
    act(() => {
      renderer = create(createElement(TerminalWebView, { shownAtMount: false }))
    })
    renderers.push(renderer!)
    const webView = renderer!.root.find((node) => typeof node.props.onMessage === 'function')
    expect(webView.props.injectedJavaScriptBeforeContentLoaded).toContain(
      'window.__orcaTerminalShown = false'
    )
  })
})
