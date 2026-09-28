import type { TerminalWebViewCommand } from './terminal-webview-messages'

/**
 * Which document holds the terminal's latest init. A reload drops an init still queued, and a
 * replacement document never saw one already delivered; either way the subscription must re-init.
 */
export function createDocumentInitTracker() {
  let documentGeneration = 0
  let initGeneration: number | null = null
  return {
    delivered(command: TerminalWebViewCommand) {
      if (command.type === 'init') {
        initGeneration = documentGeneration
      }
    },
    documentReady() {
      documentGeneration += 1
    },
    /** Asked before the queue flushes, so an init still queued for this document counts. */
    readyDocumentHasInit(initQueued: boolean) {
      return initQueued || initGeneration === documentGeneration
    }
  }
}
