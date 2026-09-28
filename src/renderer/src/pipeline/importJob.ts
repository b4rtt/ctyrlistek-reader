/**
 * Import & analysis pipeline (runs in the renderer, survives screen changes):
 *
 *   render PDF pages → detect panels locally → AI analysis per page (parallel)
 *   → merge cast across pages → AI cast consolidation → ready for review
 *
 * Progress is persisted after every page, so an interrupted import can be
 * resumed later from the library.
 */
import type { ConsolidateCharacter, TokenUsage } from '@shared/api'
import { applyConsolidation, applyPageResult, pruneCharacters, toRosterEntries } from '@shared/roster'
import type { ComicDoc, PageData } from '@shared/types'
import { api, errorCode, errorMessage } from '../api'
import { refineBubble } from '../cv/bubbles'
import { detectPanels } from '../cv/panels'
import { rasterize } from '../cv/raster'
import { openPdf, renderPage } from '../pdf/render'
import { aiImage, cropImage, encodeJpeg, loadPageBitmap, overlayImage } from './images'

export type JobPhase = 'rendering' | 'analyzing' | 'consolidating' | 'done' | 'error' | 'cancelled'

export interface JobState {
  comicId: string
  phase: JobPhase
  total: number
  rendered: number
  analyzed: number
  failed: number
  active: number[]
  error: string | null
  usage: TokenUsage
}

type Listener = (s: JobState) => void

const FATAL = new Set(['AUTH', 'QUOTA', 'NO_OPENAI_KEY'])
/** Long side of stored page images (enough for sharp panel zooms). */
const PAGE_MAX_SIDE = 3000

export class ImportJob {
  state: JobState
  private listeners = new Set<Listener>()
  private cancelled = false
  private saving: Promise<unknown> = Promise.resolve()

  constructor(
    private doc: ComicDoc,
    private pdfBytes: Uint8Array | null = null,
  ) {
    this.state = {
      comicId: doc.meta.id,
      phase: doc.pages.length ? 'analyzing' : 'rendering',
      total: doc.pages.length,
      rendered: doc.pages.length,
      analyzed: doc.pages.filter((p) => p.status === 'done').length,
      failed: 0,
      active: [],
      error: null,
      usage: { inputTokens: doc.meta.analysis.inputTokens, outputTokens: doc.meta.analysis.outputTokens },
    }
  }

  get document(): ComicDoc {
    return this.doc
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    fn(this.state)
    return () => this.listeners.delete(fn)
  }

  private set(patch: Partial<JobState>): void {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l(this.state)
    notifyJobs()
  }

  cancel(): void {
    this.cancelled = true
    this.set({ phase: 'cancelled' })
  }

  get running(): boolean {
    return !['done', 'error', 'cancelled'].includes(this.state.phase)
  }

  /**
   * Serialised saves. The in-memory document stays the single source of truth
   * (never replaced by the saved copy) so results that arrive while a save is
   * in flight are not lost.
   */
  private save(): Promise<unknown> {
    this.saving = this.saving.then(async () => {
      const saved = await api.library.save(this.doc)
      this.doc.meta = { ...this.doc.meta, updatedAt: saved.meta.updatedAt }
    })
    return this.saving
  }

  async run(onlyPages?: number[]): Promise<void> {
    try {
      if (this.doc.pages.length === 0) await this.render()
      if (this.cancelled) return
      await this.analyze(onlyPages)
      if (this.cancelled) return
      if (this.state.error) {
        await this.save()
        this.set({ phase: 'error' })
        return
      }
      await this.consolidate()
      this.doc.meta = {
        ...this.doc.meta,
        stage: this.doc.meta.stage === 'ready' ? 'ready' : 'review',
        analysis: { ...this.doc.meta.analysis, finishedAt: new Date().toISOString() },
      }
      await this.save()
      this.set({ phase: 'done' })
    } catch (err) {
      console.error(err)
      await this.save().catch(() => undefined)
      this.set({ phase: 'error', error: errorMessage(err) })
    }
  }

  // ---------------------------------------------------------------- render --

  private async render(): Promise<void> {
    this.set({ phase: 'rendering' })
    const bytes = this.pdfBytes ?? (await api.library.readSource(this.doc.meta.id))
    const { pdf, close } = await openPdf(bytes)
    this.pdfBytes = null
    try {
      this.set({ total: pdf.numPages, rendered: 0 })
      const pages: PageData[] = []
      for (let i = 0; i < pdf.numPages; i++) {
        if (this.cancelled) return
        const canvas = await renderPage(pdf, i, PAGE_MAX_SIDE)
        const rel = await api.library.writePage(this.doc.meta.id, i, await encodeJpeg(canvas, 0.9))
        const candidates = detectPanels(rasterize(canvas, 1000))
        pages.push({
          index: i,
          image: rel,
          width: canvas.width,
          height: canvas.height,
          kind: 'comic',
          status: 'pending',
          error: null,
          candidates,
          panels: [],
          skip: false,
        })
        canvas.width = 0 // release GPU memory early
        this.set({ rendered: i + 1 })
        if (i === 0 || i % 4 === 3) {
          this.doc.pages = [...pages]
          this.doc.meta = { ...this.doc.meta, pageCount: pdf.numPages, cover: pages[0].image }
          await this.save()
        }
      }
      this.doc.pages = pages
      this.doc.meta = {
        ...this.doc.meta,
        pageCount: pdf.numPages,
        cover: pages[0]?.image ?? null,
        stage: 'analyzing',
      }
      await this.save()
    } finally {
      void close()
    }
  }

  // --------------------------------------------------------------- analyze --

  private async analyze(onlyPages?: number[]): Promise<void> {
    const queue = this.doc.pages
      .filter((p) => (onlyPages ? onlyPages.includes(p.index) : p.status !== 'done'))
      .map((p) => p.index)
    this.set({
      phase: 'analyzing',
      total: this.doc.pages.length,
      analyzed: this.doc.pages.filter((p) => p.status === 'done' && !queue.includes(p.index)).length,
      failed: 0,
      error: null,
    })
    if (queue.length === 0) return
    this.doc.meta = { ...this.doc.meta, stage: this.doc.meta.stage === 'ready' ? 'ready' : 'analyzing' }

    const settings = await api.settings.get()
    const workers = Math.max(1, Math.min(settings.analysisConcurrency, queue.length))
    const next = (): number | undefined => (this.cancelled || this.state.error ? undefined : queue.shift())
    await Promise.all(
      Array.from({ length: workers }, async () => {
        for (let idx = next(); idx !== undefined; idx = next()) await this.analyzePage(idx)
      }),
    )
  }

  private async analyzePage(index: number): Promise<void> {
    this.set({ active: [...this.state.active, index] })
    const page = this.doc.pages[index]
    let bitmap: ImageBitmap | null = null
    try {
      bitmap = await loadPageBitmap(this.doc.meta.id, page.image)
      const candidates = page.candidates.map((rect, i) => ({ label: `P${i + 1}`, rect }))
      const [image, overlay] = await Promise.all([
        aiImage(bitmap),
        candidates.length ? overlayImage(bitmap, candidates) : Promise.resolve(null),
      ])
      const raster = rasterize(bitmap, 1400)
      const result = await api.ai.analyzePage({
        comicId: this.doc.meta.id,
        title: this.doc.meta.title,
        pageIndex: index,
        pageCount: this.doc.pages.length,
        image,
        overlay,
        candidates,
        roster: toRosterEntries(this.doc.characters),
      })
      if (this.cancelled) return
      applyPageResult(this.doc, index, result, { candidates, refineBubble: (r) => refineBubble(raster, r) })
      const usage = {
        inputTokens: this.state.usage.inputTokens + result.usage.inputTokens,
        outputTokens: this.state.usage.outputTokens + result.usage.outputTokens,
      }
      this.doc.meta = {
        ...this.doc.meta,
        analysis: { ...this.doc.meta.analysis, model: result.model, ...usage },
      }
      this.set({ analyzed: this.state.analyzed + 1, usage })
    } catch (err) {
      const code = errorCode(err)
      const message = errorMessage(err)
      this.doc.pages = this.doc.pages.map((p) =>
        p.index === index ? { ...p, status: 'error', error: message } : p,
      )
      this.set({ failed: this.state.failed + 1, error: code && FATAL.has(code) ? message : this.state.error })
    } finally {
      bitmap?.close()
      this.set({ active: this.state.active.filter((i) => i !== index) })
      await this.save()
    }
  }

  // ----------------------------------------------------------- consolidate --

  private async consolidate(): Promise<void> {
    const cast = this.doc.characters.filter((c) => !c.isNarrator && c.lineCount > 0)
    const extras = cast.filter((c) => !c.isMain)
    if (extras.length === 0) {
      pruneCharacters(this.doc)
      return
    }
    this.set({ phase: 'consolidating' })
    try {
      const bitmaps = new Map<number, ImageBitmap>()
      const bitmapFor = async (page: number): Promise<ImageBitmap> => {
        if (!bitmaps.has(page))
          bitmaps.set(page, await loadPageBitmap(this.doc.meta.id, this.doc.pages[page].image))
        return bitmaps.get(page)!
      }
      const characters: ConsolidateCharacter[] = []
      for (const c of cast) {
        const own: string[] = []
        const others: string[] = []
        for (const pg of this.doc.pages)
          for (const panel of pg.panels) {
            if (!panel.lines.some((l) => l.speakerId === c.id)) continue
            for (const l of panel.lines) {
              if (l.speakerId === c.id) own.push(l.text)
              else if (l.kind === 'speech') others.push(l.text)
            }
          }
        characters.push({
          id: c.id,
          name: c.name,
          nameConfidence: c.nameConfidence,
          gender: c.gender,
          genderConfidence: c.genderConfidence,
          age: c.age,
          description: c.description,
          isMain: c.isMain,
          sampleLines: own.slice(0, 5),
          addressedAs: c.isMain ? [] : others.slice(0, 6),
          thumb: !c.isMain && c.thumb ? await cropImage(await bitmapFor(c.thumb.page), c.thumb.rect) : null,
        })
      }
      for (const b of bitmaps.values()) b.close()
      const res = await api.ai.consolidate({ title: this.doc.meta.title, characters })
      applyConsolidation(this.doc, res)
    } catch (err) {
      // Consolidation only improves results – never fail the import because of it.
      console.warn('Cast consolidation failed:', errorMessage(err))
    }
    pruneCharacters(this.doc)
  }
}

// ---------------------------------------------------------------- registry --

const jobs = new Map<string, ImportJob>()
const jobListeners = new Set<() => void>()

function notifyJobs(): void {
  for (const l of jobListeners) l()
}

export function subscribeJobs(fn: () => void): () => void {
  jobListeners.add(fn)
  return () => jobListeners.delete(fn)
}

export function getJob(comicId: string): ImportJob | undefined {
  return jobs.get(comicId)
}

export function activeJobs(): ImportJob[] {
  return [...jobs.values()].filter((j) => j.running)
}

function launch(job: ImportJob, onlyPages?: number[]): ImportJob {
  jobs.set(job.state.comicId, job)
  notifyJobs()
  void job.run(onlyPages)
  return job
}

export function titleFromFileName(name: string): string {
  return (
    name
      .replace(/\.pdf$/i, '')
      .replace(/[_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Čtyřlístek'
  )
}

export async function startImport(file: File): Promise<ImportJob> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.length < 5 || new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') {
    throw new Error('Soubor není PDF.')
  }
  const doc = await api.library.create(titleFromFileName(file.name), bytes)
  return launch(new ImportJob(doc, bytes))
}

/** Continue an interrupted import, or re-analyse selected pages. */
export async function resumeImport(comicId: string, onlyPages?: number[]): Promise<ImportJob> {
  const existing = jobs.get(comicId)
  if (existing?.running) return existing
  const doc = await api.library.load(comicId)
  return launch(new ImportJob(doc), onlyPages)
}
