/**
 * Custom protocols:
 *
 *  - `comic://<comicId>/<relative path>` serves page images and audio from the
 *    library (`comic://preview-cache/audio/<file>` serves voice previews).
 *  - `app://bundle/…` serves the built renderer in production, giving it a
 *    proper origin (ES modules, workers and fetch behave like on the web).
 */
import { net, protocol } from 'electron'
import { basename, join, normalize, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { comicAsset, previewDir } from './paths'
import { PREVIEW_HOST } from './tts/audio'

export function registerSchemesAsPrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'comic',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
    },
    {
      scheme: 'app',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
    },
  ])
}

const notFound = (): Response => new Response('Not found', { status: 404 })

/** Strict CSP for the packaged renderer (the dev server needs inline scripts). */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' comic: data: blob:",
  "media-src 'self' comic: blob: data:",
  "connect-src 'self' comic:",
  "worker-src 'self' blob:",
  "font-src 'self' data:",
].join('; ')

export function registerProtocols(rendererDir: string): void {
  protocol.handle('comic', async (request) => {
    try {
      const url = new URL(request.url)
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      const file =
        url.hostname === PREVIEW_HOST ? join(previewDir(), basename(rel)) : comicAsset(url.hostname, rel)
      const res = await net.fetch(pathToFileURL(file).toString(), { headers: request.headers })
      if (!res.ok) return notFound()
      // Page images and audio are content-addressed or immutable once written.
      const headers = new Headers(res.headers)
      headers.set('Cache-Control', rel.startsWith('pages/') ? 'no-cache' : 'max-age=31536000, immutable')
      return new Response(res.body, { status: res.status, headers })
    } catch {
      return notFound()
    }
  })

  const root = resolve(rendererDir)
  protocol.handle('app', async (request) => {
    const url = new URL(request.url)
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '') || 'index.html'
    const file = resolve(root, rel)
    if (file !== root && !file.startsWith(root + sep)) return notFound()
    const res = await net.fetch(pathToFileURL(file).toString())
    if (!rel.endsWith('.html')) return res
    const headers = new Headers(res.headers)
    headers.set('Content-Security-Policy', CSP)
    return new Response(res.body, { status: res.status, headers })
  })
}
