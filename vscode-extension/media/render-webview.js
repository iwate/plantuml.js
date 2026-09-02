;(function () {
  const vscode = acquireVsCodeApi()

  const assetsBaseUrl = document.querySelector('meta[name="plantuml-assets-base-url"]').content
  const cheerpjLoaderUrl = document.querySelector('meta[name="plantuml-cheerpj-loader-url"]').content

  let initPromise = null

  function loadScript (src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = src
      script.onload = () => resolve()
      script.onerror = () => reject(new Error(`Failed to load script: ${src}`))
      document.head.appendChild(script)
    })
  }

  function ensureInitialized () {
    if (!initPromise) {
      initPromise = loadScript(cheerpjLoaderUrl).then(() => plantuml.initialize(assetsBaseUrl))
    }
    return initPromise
  }

  function blobToDataUri (blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result)
      reader.onerror = () => reject(reader.error || new Error('Failed to read rendered image'))
      reader.readAsDataURL(blob)
    })
  }

  async function renderOne (hash, source) {
    try {
      await ensureInitialized()
      const blob = await plantuml.renderPng(source)
      const dataUri = await blobToDataUri(blob)
      vscode.postMessage({ type: 'result', hash, dataUri })
    } catch (error) {
      vscode.postMessage({ type: 'error', hash, error: error && error.message ? error.message : String(error) })
    }
  }

  window.addEventListener('message', (event) => {
    const message = event.data
    if (message && message.type === 'render') {
      renderOne(message.hash, message.source)
    }
  })

  vscode.postMessage({ type: 'ready' })
})()
