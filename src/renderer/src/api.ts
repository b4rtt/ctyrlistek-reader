import type { AppApi } from '@shared/api'

export const api: AppApi = window.ctyrlistek

/** URL of a file inside a comic folder, served by the `comic://` protocol. */
export function assetUrl(comicId: string, rel: string): string {
  return `comic://${comicId}/${rel.split('/').map(encodeURIComponent).join('/')}`
}

export const PREVIEW_ID = 'preview-cache'

/** Strip the "CODE: " prefix main-process errors carry. */
export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const cleaned = raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  return cleaned.replace(/^[A-Z_]+: /, '')
}

export function errorCode(err: unknown): string | null {
  const raw = err instanceof Error ? err.message : String(err)
  const m = /(?:^|: )([A-Z_]{4,}): /.exec(raw)
  return m ? m[1] : null
}
