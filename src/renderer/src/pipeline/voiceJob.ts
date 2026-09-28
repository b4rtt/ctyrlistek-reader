/**
 * Background voice generation. Runs independently of screens (so playback can
 * start immediately while the rest of the comic is being voiced) and uses low
 * priority so the player's own requests always go first.
 */
import type { SettingsView } from '@shared/api'
import { allLines } from '@shared/timeline'
import type { AudioRef, ComicDoc } from '@shared/types'
import { api, errorMessage } from '../api'
import { prepareVoices, type VoiceProgress } from './voices'

export interface VoiceJobState extends VoiceProgress {
  comicId: string
  running: boolean
  error: string | null
}

type Listener = (s: VoiceJobState) => void

class VoiceJob {
  state: VoiceJobState
  private listeners = new Set<Listener>()
  private abort = new AbortController()

  constructor(comicId: string) {
    this.state = { comicId, running: true, error: null, total: 0, done: 0, failed: 0, current: '' }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    fn(this.state)
    return () => this.listeners.delete(fn)
  }

  private set(patch: Partial<VoiceJobState>): void {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l(this.state)
    for (const l of registryListeners) l()
  }

  cancel(): void {
    this.abort.abort()
  }

  async run(doc: ComicDoc, settings: SettingsView): Promise<void> {
    try {
      const { doc: voiced, error } = await prepareVoices(
        doc,
        settings,
        (p) => this.set(p),
        this.abort.signal,
        'low',
      )
      // Merge the audio references into the latest saved document (the user
      // may have edited it meanwhile).
      const refs = new Map<string, { audio: AudioRef; text: string }>()
      for (const { line } of allLines(voiced))
        if (line.audio) refs.set(line.id, { audio: line.audio, text: line.text })
      const latest = await api.library.load(doc.meta.id)
      await api.library.save({
        ...latest,
        pages: latest.pages.map((pg) => ({
          ...pg,
          panels: pg.panels.map((p) => ({
            ...p,
            lines: p.lines.map((l) => {
              const ref = refs.get(l.id)
              // Only fill in lines whose text did not change meanwhile.
              return ref && l.text === ref.text ? { ...l, audio: ref.audio } : l
            }),
          })),
        })),
      })
      this.set({ running: false, error, current: '' })
    } catch (err) {
      this.set({ running: false, error: errorMessage(err), current: '' })
    }
  }
}

const jobs = new Map<string, VoiceJob>()
const registryListeners = new Set<() => void>()

export function getVoiceJob(comicId: string): VoiceJob | undefined {
  return jobs.get(comicId)
}

/** Start (or return the already running) background voice job for a comic. */
export function startVoiceJob(doc: ComicDoc, settings: SettingsView): VoiceJob {
  const existing = jobs.get(doc.meta.id)
  if (existing?.state.running) return existing
  const job = new VoiceJob(doc.meta.id)
  jobs.set(doc.meta.id, job)
  void job.run(doc, settings)
  for (const l of registryListeners) l()
  return job
}

export function subscribeVoiceJobs(fn: () => void): () => void {
  registryListeners.add(fn)
  return () => registryListeners.delete(fn)
}
