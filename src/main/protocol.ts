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
    { scheme: 'comic', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  ])
}

const notFound = (): Response => new Response('Not found', { status: 404 })

export function registerProtocols(rendererDir: string): void {
  protocol.handle('comic', async (request) => {
    try {
      const url = new URL(request.url)
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      const file = url.hostname === PREVIEW_HOST ? join(previewDir(), basename(rel)) : comicAsset(url.hostname, rel)
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
  protocol.handle('app', (request) => {
    const url = new URL(request.url)
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '') || 'index.html'
    const file = resolve(root, rel)
    if (file !== root && !file.startsWith(root + sep)) return notFound()
    return net.fetch(pathToFileURL(file).toString())
  })
}
