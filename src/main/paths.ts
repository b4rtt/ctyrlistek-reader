import { app } from 'electron'
import { join, resolve, sep } from 'node:path'

/**
 * Root folder for all user data. `CTYRLISTEK_DATA_DIR` overrides it (used by
 * end-to-end tests so they never touch the real library).
 */
export function dataDir(): string {
  return process.env.CTYRLISTEK_DATA_DIR ? resolve(process.env.CTYRLISTEK_DATA_DIR) : app.getPath('userData')
}

export const libraryDir = (): string => join(dataDir(), 'library')
export const previewDir = (): string => join(dataDir(), 'preview-audio')
export const settingsFile = (): string => join(dataDir(), 'settings.json')
export const secretsFile = (): string => join(dataDir(), 'secrets.json')

const ID_RE = /^[a-z0-9-]{4,64}$/

export function assertComicId(id: string): string {
  if (!ID_RE.test(id)) throw new Error(`Neplatné ID komiksu: ${id}`)
  return id
}

export const comicDir = (id: string): string => join(libraryDir(), assertComicId(id))

/** Resolve a relative asset path inside a comic folder, refusing path traversal. */
export function comicAsset(id: string, rel: string): string {
  const base = comicDir(id)
  const full = resolve(base, rel)
  if (full !== base && !full.startsWith(base + sep)) throw new Error('Neplatná cesta k souboru')
  return full
}
