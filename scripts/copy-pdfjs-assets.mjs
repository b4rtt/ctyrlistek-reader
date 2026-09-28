// Copies pdf.js runtime assets (character maps + standard fonts) into the
// renderer's public folder so they are served locally (the app works offline).
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
let pdfjsRoot
try {
  pdfjsRoot = dirname(require.resolve('pdfjs-dist/package.json'))
} catch {
  console.warn('[copy-pdfjs-assets] pdfjs-dist not installed yet, skipping')
  process.exit(0)
}

const target = join(process.cwd(), 'src/renderer/public/pdfjs')
mkdirSync(target, { recursive: true })
for (const dir of ['cmaps', 'standard_fonts']) {
  const from = join(pdfjsRoot, dir)
  if (existsSync(from)) cpSync(from, join(target, dir), { recursive: true })
}
console.log('[copy-pdfjs-assets] copied pdf.js assets to', target)
