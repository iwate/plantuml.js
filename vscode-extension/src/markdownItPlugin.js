'use strict'

/**
 * markdown-it plugin that renders ` ```plantuml ` / ` ```puml ` fenced code
 * blocks using the given PlantumlRenderer. Since markdown-it renders
 * synchronously, the first render of a given diagram returns a placeholder
 * while the renderer asynchronously produces the image in the background;
 * once ready, the renderer triggers `markdown.preview.refresh` so the
 * preview re-renders with the cached image.
 *
 * @param {import('markdown-it')} md
 * @param {import('./plantumlRenderer').PlantumlRenderer} renderer
 */
function plantumlMarkdownItPlugin (md, renderer) {
  const defaultFence = md.renderer.rules.fence || function (tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options)
  }

  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const info = (token.info || '').trim().toLowerCase()

    if (info !== 'plantuml' && info !== 'puml') {
      return defaultFence(tokens, idx, options, env, self)
    }

    const source = token.content
    const hash = renderer.requestRender(source)
    const cached = renderer.getCached(hash)

    if (cached && cached.status === 'done') {
      return `<div class="plantuml-diagram"><img src="${cached.dataUri}" alt="PlantUML diagram"></div>\n`
    }

    if (cached && cached.status === 'error') {
      return `<div class="plantuml-diagram plantuml-diagram-error"><p>PlantUML rendering failed:</p><pre>${md.utils.escapeHtml(cached.error)}</pre></div>\n`
    }

    return '<div class="plantuml-diagram plantuml-diagram-pending">Rendering PlantUML diagram…</div>\n'
  }

  return md
}

module.exports = { plantumlMarkdownItPlugin }
