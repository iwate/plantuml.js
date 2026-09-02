'use strict'

const vscode = require('vscode')
const crypto = require('crypto')

// If a render doesn't complete within this time (e.g. the CheerpJ runtime
// fails to boot because the configured assetsBaseUrl is unreachable or
// serves incompatible assets), surface an error instead of leaving the
// preview stuck on "Rendering PlantUML diagram…" forever.
//
// The very first render also has to download the CheerpJ JVM runtime plus
// the PlantUML jar/font assets (tens of megabytes), which can legitimately
// take well over a minute on a normal (but not particularly fast) internet
// connection. A short timeout here mislabels a slow-but-working load as a
// network error, so default to a more generous value and let users tune it
// via the `plantumlMarkdownPreview.renderTimeoutMs` setting.
const DEFAULT_RENDER_TIMEOUT_MS = 180000

/**
 * Manages a hidden helper webview panel that runs plantuml.js (CheerpJ based)
 * to render PlantUML sources to PNG, and caches the results so the
 * synchronous markdown-it `fence` renderer can embed them as data URIs.
 */
class PlantumlRenderer {
  /**
   * @param {import('vscode').ExtensionContext} context
   */
  constructor (context) {
    this.context = context
    this.panel = undefined
    this.ready = false
    this.pendingQueue = []
    /** @type {Map<string, {status: 'pending'|'done'|'error', dataUri?: string, error?: string}>} */
    this.cache = new Map()
    /** @type {Map<string, NodeJS.Timeout>} */
    this.timeouts = new Map()
    this.messageListener = undefined
  }

  hashOf (source) {
    return crypto.createHash('sha256').update(source).digest('hex')
  }

  getCached (hash) {
    return this.cache.get(hash)
  }

  getConfig () {
    const config = vscode.workspace.getConfiguration('plantumlMarkdownPreview')
    return {
      assetsBaseUrl: config.get('assetsBaseUrl', 'https://iwate.github.io/plantuml.js/plantuml-wasm'),
      cheerpjLoaderUrl: config.get('cheerpjLoaderUrl', 'https://cjrtnc.leaningtech.com/2.3/loader.js'),
      renderTimeoutMs: config.get('renderTimeoutMs', DEFAULT_RENDER_TIMEOUT_MS)
    }
  }

  /**
   * Requests a render for the given PlantUML source. Returns the hash used to
   * key the cache. Safe to call repeatedly; only queues a render once per
   * distinct source.
   */
  requestRender (source) {
    const hash = this.hashOf(source)
    if (this.cache.has(hash)) {
      return hash
    }

    this.cache.set(hash, { status: 'pending' })
    this._send({ type: 'render', hash, source })

    const { renderTimeoutMs } = this.getConfig()
    const timeout = setTimeout(() => {
      this.timeouts.delete(hash)
      if (this.cache.get(hash)?.status === 'pending') {
        this.cache.set(hash, {
          status: 'error',
          error: 'Timed out waiting for the PlantUML renderer. The first ' +
            'render downloads the CheerpJ runtime and PlantUML assets ' +
            '(tens of megabytes), which can take a while on a slow ' +
            'connection — try increasing ' +
            '"plantumlMarkdownPreview.renderTimeoutMs" and re-opening the ' +
            'preview to retry. If it still fails, check the ' +
            '"plantumlMarkdownPreview.assetsBaseUrl" and ' +
            '"plantumlMarkdownPreview.cheerpjLoaderUrl" settings and your ' +
            'internet connection.'
        })
        vscode.commands.executeCommand('markdown.preview.refresh')
      }
    }, renderTimeoutMs)
    this.timeouts.set(hash, timeout)

    return hash
  }

  _send (message) {
    const panel = this._ensurePanel()
    if (this.ready) {
      panel.webview.postMessage(message)
    } else {
      this.pendingQueue.push(message)
    }
  }

  _ensurePanel () {
    if (this.panel) {
      return this.panel
    }

    const panel = vscode.window.createWebviewPanel(
      'plantumlMarkdownPreviewRenderer',
      'PlantUML Renderer (background)',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
      }
    )

    panel.webview.html = this._getHtml(panel.webview)

    this.messageListener = panel.webview.onDidReceiveMessage((message) => this._handleMessage(message))
    panel.onDidDispose(() => {
      this.panel = undefined
      this.ready = false
      this.pendingQueue = []
      if (this.messageListener) {
        this.messageListener.dispose()
        this.messageListener = undefined
      }
    })

    this.panel = panel
    return panel
  }

  _getHtml (webview) {
    const vendorScriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'plantuml.js')
    )
    const bridgeScriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'render-webview.js')
    )
    const { assetsBaseUrl, cheerpjLoaderUrl } = this.getConfig()

    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} https: data: blob:`,
      `script-src ${webview.cspSource} https: 'unsafe-inline'`,
      "connect-src https: data: blob:",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource} https: data:`,
      "worker-src blob: https:"
    ].join('; ')

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="plantuml-assets-base-url" content="${assetsBaseUrl}">
<meta name="plantuml-cheerpj-loader-url" content="${cheerpjLoaderUrl}">
<title>PlantUML Renderer</title>
</head>
<body>
<p>PlantUML background renderer for the Markdown preview. You can keep this tab open; it renders diagrams in the background and does not need to be interacted with.</p>
<script src="${vendorScriptUri}"></script>
<script src="${bridgeScriptUri}"></script>
</body>
</html>`
  }

  _handleMessage (message) {
    if (!message || typeof message.type !== 'string') {
      return
    }

    if (message.type === 'ready') {
      this.ready = true
      for (const queued of this.pendingQueue) {
        this.panel.webview.postMessage(queued)
      }
      this.pendingQueue = []
      return
    }

    if (message.type === 'result') {
      this._clearTimeout(message.hash)
      this.cache.set(message.hash, { status: 'done', dataUri: message.dataUri })
      vscode.commands.executeCommand('markdown.preview.refresh')
      return
    }

    if (message.type === 'error') {
      this._clearTimeout(message.hash)
      this.cache.set(message.hash, { status: 'error', error: message.error })
      vscode.commands.executeCommand('markdown.preview.refresh')
    }
  }

  _clearTimeout (hash) {
    const timeout = this.timeouts.get(hash)
    if (timeout) {
      clearTimeout(timeout)
      this.timeouts.delete(hash)
    }
  }

  dispose () {
    if (this.messageListener) {
      this.messageListener.dispose()
    }
    if (this.panel) {
      this.panel.dispose()
    }
    for (const timeout of this.timeouts.values()) {
      clearTimeout(timeout)
    }
    this.timeouts.clear()
  }
}

module.exports = { PlantumlRenderer }
