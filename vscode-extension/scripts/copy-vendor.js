'use strict'

const path = require('path')
const fs = require('fs')

// Keeps a single source of truth for the plantuml.js browser wrapper by
// copying it from the sibling `plantuml-wasm` package into this extension's
// `media/vendor` folder before packaging.
const source = path.join(__dirname, '..', '..', 'plantuml-wasm', 'plantuml.js')
const destDir = path.join(__dirname, '..', 'media', 'vendor')
const dest = path.join(destDir, 'plantuml.js')

fs.mkdirSync(destDir, { recursive: true })
fs.copyFileSync(source, dest)

console.log(`Copied ${source} -> ${dest}`)
