import { useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react'
import { Platform, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import type { TerminalWebViewHandle, TerminalWebViewProps } from './terminal-webview-contract'
import { TerminalWebViewEngineErrorOverlay } from './terminal-webview-engine-error-state'
import { TERMINAL_WEBVIEW_FRAME_STYLES } from './terminal-webview-frame-styles'
import { xtermWebViewSource } from './terminal-webview-html'
import type { TerminalWebViewCommand } from './terminal-webview-messages'
import { useTerminalWebViewController } from './use-terminal-webview-controller'

type Props = TerminalWebViewProps

export type { TerminalWebViewHandle } from './terminal-webview-contract'

export const TerminalWebView = forwardRef<TerminalWebViewHandle, Props>(
  function TerminalWebView(props, ref) {
    const webViewRef = useRef<WebView>(null)

    const post = useCallback((command: TerminalWebViewCommand & { id: number }) => {
      webViewRef.current?.postMessage(JSON.stringify(command))
    }, [])

    const {
      clearEngineError,
      viewGeneration,
      engineError,
      handle,
      isCurrentView,
      receive,
      reportNativeEngineError,
      replaceDocument,
      handleLoadStart
    } = useTerminalWebViewController(props, {
      post,
      // iOS can preserve the native view while discarding its JS/backing-store state.
      pingsOnForegroundRecovery: () => Platform.OS === 'ios'
    })

    useImperativeHandle(ref, () => handle, [handle])
    // Why: the document builds its terminal before ready, so it needs the text scale before any
    // message can reach it; later changes arrive as set-font-scale.
    // Why: in the page source rather than injected: Android can run an injected script after the
    // document's own, which then starts without them.
    const [source] = useState(() =>
      xtermWebViewSource({ textScale: props.textScale ?? 1, shown: props.shownAtMount ?? true })
    )

    const handleMessage = useCallback(
      (event: WebViewMessageEvent) => {
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(event.nativeEvent.data) as Record<string, unknown>
        } catch {
          return
        }
        receive(msg, viewGeneration)
      },
      [viewGeneration, receive]
    )

    // Why: a replaced view keeps its last props; none of its events may act on the current document.
    const fromThisView = useCallback(
      <Event,>(handler: (event: Event) => void) =>
        (event: Event) => {
          if (isCurrentView(viewGeneration)) {
            handler(event)
          }
        },
      [isCurrentView, viewGeneration]
    )

    const handleReload = useCallback(() => {
      clearEngineError()
      replaceDocument()
    }, [clearEngineError, replaceDocument])

    const handleContentProcessDidTerminate = useCallback(() => {
      // Why: WKWebView content-process loss is recoverable; stale commands belong
      // to the dead document and the replacement must prove readiness before replay.
      replaceDocument()
      clearEngineError()
    }, [clearEngineError, replaceDocument])

    return (
      <View style={[TERMINAL_WEBVIEW_FRAME_STYLES.container, props.style]}>
        {/* Why: a new view per document, not reload(): a reloading view still delivers its old
            document's messages, and only a view's own onMessage can say which document sent one. */}
        <WebView
          key={viewGeneration}
          ref={webViewRef}
          source={source}
          style={TERMINAL_WEBVIEW_FRAME_STYLES.webview}
          originWhitelist={['*']}
          javaScriptEnabled
          scrollEnabled={false}
          // Why: Android parent gesture containers can intercept vertical drags
          // before the injected xterm scroll router sees them.
          nestedScrollEnabled
          scalesPageToFit={false}
          // Why: Android WebView defaults textZoom to the system font scale, inflating
          // xterm's DOM glyphs past its canvas-measured cell grid (#4579). iOS ignores it.
          textZoom={100}
          onLoadStart={fromThisView(handleLoadStart)}
          onMessage={handleMessage}
          onError={fromThisView((event) =>
            reportNativeEngineError('Terminal WebView load failed', event)
          )}
          onHttpError={fromThisView((event) =>
            reportNativeEngineError('Terminal WebView HTTP error', event)
          )}
          onRenderProcessGone={fromThisView((event) =>
            reportNativeEngineError('Terminal WebView render process ended', event)
          )}
          onContentProcessDidTerminate={fromThisView(handleContentProcessDidTerminate)}
        />
        {engineError ? (
          <TerminalWebViewEngineErrorOverlay message={engineError} onReload={handleReload} />
        ) : null}
      </View>
    )
  }
)
