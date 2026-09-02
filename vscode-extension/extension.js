'use strict'

const { PlantumlRenderer } = require('./src/plantumlRenderer')
const { plantumlMarkdownItPlugin } = require('./src/markdownItPlugin')

/**
 * @param {import('vscode').ExtensionContext} context
 */
function activate (context) {
  const renderer = new PlantumlRenderer(context)
  context.subscriptions.push(renderer)

  return {
    extendMarkdownIt (md) {
      return plantumlMarkdownItPlugin(md, renderer)
    }
  }
}

function deactivate () {}

module.exports = { activate, deactivate }
