/**
 * Comic library on disk:
 *
 *   <userData>/library/<id>/
 *     comic.json       – ComicDoc (atomic writes)
 *     source.pdf       – the imported PDF
 *     pages/p001.jpg   – rendered pages
 *     audio/<hash>.*   – generated speech & sound effects (cache)
 */
import { shell } from 'electron'
import { randomBytes } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { ComicDoc, ComicSummary } from '@shared/types'
import { initialRoster } from '@shared/defaults'
import { needsReview } from '@shared/roster'
import { comicAsset, comicDir, libraryDir } from './paths'

const DOC_FILE = 'comic.json'

async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data))
  await fs.rename(tmp, file)
}

export function summarize(doc: ComicDoc): ComicSummary {
  let lineCount = 0
  let voicedLines = 0
  for (const p of doc.pages)
    for (const panel of p.panels)
      for (const l of panel.lines) {
        lineCount++
        if (l.audio) voicedLines++
      }
  return {
    meta: doc.meta,
    pagesDone: doc.pages.filter((p) => p.status === 'done').length,
    pagesFailed: doc.pages.filter((p) => p.status === 'error').length,
    needsReview: doc.characters.filter(needsReview).length,
    lineCount,
    voicedLines,
  }
}

export async function listComics(): Promise<ComicSummary[]> {
  const root = libraryDir()
  if (!existsSync(root)) return []
  const entries = await fs.readdir(root, { withFileTypes: true })
  const out: ComicSummary[] = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    try {
      out.push(summarize(await loadComic(e.name)))
    } catch {
      // Ignore half-created or corrupted folders.
    }
  }
  return out.sort((a, b) => b.meta.updatedAt.localeCompare(a.meta.updatedAt))
}

export async function loadComic(id: string): Promise<ComicDoc> {
  const raw = await fs.readFile(join(comicDir(id), DOC_FILE), 'utf8')
  const doc = JSON.parse(raw) as ComicDoc
  if (doc.schemaVersion !== 1) throw new Error('Nepodporovaná verze dat komiksu')
  return doc
}

export async function saveComic(doc: ComicDoc): Promise<ComicDoc> {
  const next: ComicDoc = { ...doc, meta: { ...doc.meta, updatedAt: new Date().toISOString() } }
  await writeJsonAtomic(join(comicDir(doc.meta.id), DOC_FILE), next)
  return next
}

export async function createComic(title: string, pdf: Uint8Array): Promise<ComicDoc> {
  const id = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
  const dir = comicDir(id)
  await fs.mkdir(join(dir, 'pages'), { recursive: true })
  await fs.mkdir(join(dir, 'audio'), { recursive: true })
  await fs.writeFile(join(dir, 'source.pdf'), pdf)
  const now = new Date().toISOString()
  const doc: ComicDoc = {
    schemaVersion: 1,
    meta: {
      id,
      title: title.trim() || 'Čtyřlístek',
      createdAt: now,
      updatedAt: now,
      pageCount: 0,
      stage: 'rendering',
      cover: null,
      analysis: { model: null, inputTokens: 0, outputTokens: 0, finishedAt: null },
      lastBeat: null,
    },
    pages: [],
    characters: initialRoster(),
  }
  await writeJsonAtomic(join(dir, DOC_FILE), doc)
  return doc
}

export async function writePage(
  id: string,
  index: number,
  jpeg: Uint8Array,
  variant: 'page' | 'thumb' = 'page',
): Promise<string> {
  const rel = `pages/${variant === 'thumb' ? 't' : 'p'}${String(index + 1).padStart(3, '0')}.jpg`
  await fs.writeFile(comicAsset(id, rel), jpeg)
  return rel
}

export async function readSource(id: string): Promise<Uint8Array> {
  return new Uint8Array(await fs.readFile(comicAsset(id, 'source.pdf')))
}

/** Moves the comic folder to the OS trash (recoverable). */
export async function removeComic(id: string): Promise<void> {
  const dir = comicDir(id)
  try {
    await shell.trashItem(dir)
  } catch {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

export function revealComic(id: string | null): void {
  const target = id ? join(comicDir(id), DOC_FILE) : libraryDir()
  if (id) shell.showItemInFolder(target)
  else void fs.mkdir(target, { recursive: true }).then(() => shell.openPath(target))
}
