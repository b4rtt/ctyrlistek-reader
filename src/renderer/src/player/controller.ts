/**
 * Playback engine – framework-agnostic. Walks the beat timeline, drives the
 * camera, plays voices/sound effects (prefetching ahead) and exposes a small
 * observable state for the UI.
 *
 * All waits are pausable and bound to a "generation" counter: seeking starts a
 * new generation, which silently ends the previous async loop.
 */
import type { Settings } from '@shared/api'
import { activeWordIndex } from '@shared/alignment'
import { FULL_PAGE } from '@shared/geometry'
import { buildTimeline, beatLine, beatPanel, pageStartIndex, type Beat } from '@shared/timeline'
import type { AudioRef, Character, ComicDoc, Line, Rect, WordTiming } from '@shared/types'
import { systemProsody } from '@shared/performance'
import { errorMessage } from '../api'
import { audioUrl } from '../audio/preview'
import { speakerOf, synthesizeLine } from '../pipeline/voices'

export interface CameraTarget {
  page: number
  rect: Rect
  /** Transition duration in ms (0 = jump). */
  duration: number
  /** Dim everything outside `rect`. */
  spotlight: boolean
}

export interface PlayerState {
  beat: number
  total: number
  started: boolean
  playing: boolean
  ended: boolean
  /** Waiting for a voice to be generated. */
  loading: boolean
  camera: CameraTarget
  line: Line | null
  speaker: Character | null
  /** Word timings of the line being spoken (null = unknown). */
  words: WordTiming[] | null
  word: number
  /** Increments to retrigger the "shake" effect for loud sound effects. */
  shake: number
  error: string | null
}

type Listener = (s: PlayerState) => void

const LOOKAHEAD = 5
const easeDuration = (a: Rect, b: Rect): number => {
  const d = Math.hypot(a.x + a.w / 2 - (b.x + b.w / 2), a.y + a.h / 2 - (b.y + b.h / 2)) + Math.abs(a.w - b.w)
  return Math.round(Math.min(1250, Math.max(650, 650 + d * 900)))
}

export class PlayerController {
  readonly beats: Beat[]
  private state: PlayerState
  private listeners = new Set<Listener>()
  private gen = 0
  /** Generation of the loop that is currently running (-1 = none). */
  private loopGen = -1
  private paused = true
  private resumeWaiters: (() => void)[] = []
  private audio: HTMLAudioElement | null = null
  private speaking: SpeechSynthesisUtterance | null = null
  private prefetched = new Map<string, Promise<AudioRef | null>>()
  private elements = new Map<string, HTMLAudioElement>()
  private raf = 0
  private reportedError = false

  constructor(
    private doc: ComicDoc,
    private settings: Settings,
    private onPosition: (beat: number) => void = () => undefined,
  ) {
    this.beats = buildTimeline(doc)
    const first = this.beats[0]
    this.state = {
      beat: 0,
      total: this.beats.length,
      started: false,
      playing: false,
      ended: false,
      loading: false,
      camera: { page: first?.page ?? 0, rect: FULL_PAGE, duration: 0, spotlight: false },
      line: null,
      speaker: null,
      words: null,
      word: -1,
      shake: 0,
      error: null,
    }
  }

  get snapshot(): PlayerState {
    return this.state
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    fn(this.state)
    return () => this.listeners.delete(fn)
  }

  private set(patch: Partial<PlayerState>): void {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l(this.state)
  }

  updateSettings(settings: Settings): void {
    const voiceChanged = settings.voiceMode !== this.settings.voiceMode
    this.settings = settings
    if (voiceChanged) this.prefetched.clear()
  }

  // ------------------------------------------------------------ transport --

  start(from = 0): void {
    this.set({ started: true, ended: false })
    this.paused = false
    this.set({ playing: true })
    void this.run(Math.max(0, Math.min(from, this.beats.length - 1)))
  }

  toggle(): void {
    if (!this.state.started || this.state.ended) this.start(this.state.ended ? 0 : this.state.beat)
    else if (this.paused) this.resume()
    else this.pause()
  }

  pause(): void {
    if (this.paused) return
    this.paused = true
    this.audio?.pause()
    if (this.speaking) window.speechSynthesis.pause()
    this.set({ playing: false })
    this.onPosition(this.state.beat)
  }

  resume(): void {
    if (!this.paused) return
    this.paused = false
    this.set({ playing: true })
    if (this.loopGen !== this.gen) {
      // The user navigated while paused – start playing from the shown beat.
      void this.run(this.state.beat, true)
      return
    }
    void this.audio?.play().catch(() => undefined)
    if (this.speaking) window.speechSynthesis.resume()
    const waiters = this.resumeWaiters
    this.resumeWaiters = []
    for (const w of waiters) w()
  }

  /** Jump to a beat. Keeps the current play/pause state. */
  goTo(beat: number): void {
    const target = Math.max(0, Math.min(beat, this.beats.length - 1))
    this.stopSound()
    if (!this.state.started) this.set({ started: true })
    this.set({ ended: false })
    if (this.paused) {
      this.gen++
      this.showBeat(target, true)
      this.set({ beat: target })
      return
    }
    void this.run(target, true)
  }

  next(): void {
    this.goTo(this.state.beat + 1)
  }

  prev(): void {
    this.goTo(this.state.beat - 1)
  }

  nextPage(): void {
    const page = this.beats[this.state.beat]?.page ?? 0
    const i = this.beats.findIndex((b) => b.page > page)
    if (i >= 0) this.goTo(i)
  }

  prevPage(): void {
    const page = this.beats[this.state.beat]?.page ?? 0
    const start = pageStartIndex(this.beats, page)
    if (this.state.beat > start) return this.goTo(start)
    const prevPage = [...this.beats].reverse().find((b) => b.page < page)?.page
    if (prevPage !== undefined) this.goTo(pageStartIndex(this.beats, prevPage))
  }

  goToPanel(page: number, panel: number): void {
    const i = this.beats.findIndex((b) => b.page === page && b.panel === panel)
    if (i >= 0) this.goTo(i)
  }

  goToLine(lineId: string): void {
    const i = this.beats.findIndex((b) => beatLine(this.doc, b)?.id === lineId)
    if (i >= 0) this.goTo(i)
  }

  destroy(): void {
    this.gen++
    this.paused = true
    this.stopSound()
    cancelAnimationFrame(this.raf)
    for (const el of this.elements.values()) el.src = ''
    this.elements.clear()
    this.listeners.clear()
  }

  // ----------------------------------------------------------------- loop --

  private async run(from: number, jumped = false): Promise<void> {
    const gen = ++this.gen
    this.loopGen = gen
    this.stopSound()
    for (let i = from; i < this.beats.length; i++) {
      if (gen !== this.gen) return
      const b = this.beats[i]
      const cameraMoves = this.showBeat(i, jumped && i === from)
      this.prefetchFrom(i)
      if (b.pageStart && !(jumped && i === from)) this.onPosition(i)

      if (cameraMoves.pageIntro && this.settings.pageIntro) {
        if (!(await this.wait(1500 * this.settings.pace, gen))) return
      }
      if (cameraMoves.panelMove) {
        const panel = beatPanel(this.doc, b)
        if (panel)
          this.set({
            camera: { page: b.page, rect: panel.rect, duration: cameraMoves.panelMove, spotlight: true },
          })
        if (!(await this.wait(cameraMoves.panelMove * 0.85, gen))) return
      }

      const line = beatLine(this.doc, b)
      if (line) {
        if (!(await this.speak(line, gen))) return
        const next = this.beats[i + 1]
        const nextLine = next ? beatLine(this.doc, next) : null
        const sameSpeaker = nextLine && nextLine.speakerId === line.speakerId && !next?.panelStart
        const gap = next?.pageStart ? 900 : next?.panelStart ? 450 : sameSpeaker ? 200 : 380
        if (!(await this.wait(gap * this.settings.pace, gen))) return
      } else {
        const hold = b.panel < 0 ? 3200 : 2000
        if (!(await this.wait(hold * this.settings.pace, gen))) return
      }
    }
    if (gen !== this.gen) return
    this.paused = true
    this.loopGen = -1
    this.set({ playing: false, ended: true, line: null, speaker: null, word: -1 })
    this.onPosition(0)
  }

  /**
   * Update visual state for beat `i`. Returns which camera moves the loop
   * should wait for.
   */
  private showBeat(i: number, jump: boolean): { pageIntro: boolean; panelMove: number } {
    const b = this.beats[i]
    const prev = this.state.camera
    const panel = beatPanel(this.doc, b)
    const line = beatLine(this.doc, b)
    const newPage = prev.page !== b.page || !this.state.started || jump
    let pageIntro = false
    let panelMove = 0

    if (b.panel < 0) {
      this.set({ camera: { page: b.page, rect: FULL_PAGE, duration: newPage ? 0 : 900, spotlight: false } })
    } else if (panel) {
      if (b.pageStart && !jump && this.settings.pageIntro) {
        // New page: show it whole first, then fly into the first panel.
        this.set({ camera: { page: b.page, rect: FULL_PAGE, duration: 0, spotlight: false } })
        pageIntro = true
        panelMove = 1100
      } else if (jump || newPage) {
        this.set({
          camera: { page: b.page, rect: panel.rect, duration: jump && !newPage ? 700 : 0, spotlight: true },
        })
      } else if (b.panelStart) {
        panelMove = easeDuration(prev.rect, panel.rect)
      }
    }

    this.set({
      beat: i,
      line: line ?? null,
      speaker: line ? (speakerOf(this.doc, line) ?? null) : null,
      words: null,
      word: -1,
      loading: false,
    })
    return { pageIntro, panelMove }
  }

  // ---------------------------------------------------------------- waits --

  private async untilResumed(gen: number): Promise<boolean> {
    while (this.paused && gen === this.gen) await new Promise<void>((r) => this.resumeWaiters.push(r))
    return gen === this.gen
  }

  /** Sleep `ms` of *playing* time. Resolves false when superseded. */
  private async wait(ms: number, gen: number): Promise<boolean> {
    let remaining = ms
    while (remaining > 0) {
      if (!(await this.untilResumed(gen))) return false
      const step = Math.min(remaining, 50)
      const t0 = performance.now()
      await new Promise((r) => setTimeout(r, step))
      if (gen !== this.gen) return false
      if (!this.paused) remaining -= performance.now() - t0
    }
    return gen === this.gen
  }

  // ---------------------------------------------------------------- audio --

  private request(line: Line): Promise<AudioRef | null> {
    let p = this.prefetched.get(line.id)
    if (!p) {
      p = synthesizeLine(this.doc, line, this.settings).catch((err) => {
        if (!this.reportedError) {
          this.reportedError = true
          this.set({ error: errorMessage(err) })
        }
        return null
      })
      this.prefetched.set(line.id, p)
    }
    return p
  }

  private prefetchFrom(i: number): void {
    let n = 0
    for (let j = i; j < this.beats.length && n < LOOKAHEAD; j++) {
      const line = beatLine(this.doc, this.beats[j])
      if (!line) continue
      n++
      void this.request(line).then((ref) => {
        if (!ref || this.elements.has(line.id)) return
        const el = new Audio(audioUrl(this.doc.meta.id, ref))
        el.preload = 'auto'
        this.elements.set(line.id, el)
      })
    }
  }

  private stopSound(): void {
    cancelAnimationFrame(this.raf)
    if (this.audio) {
      this.audio.pause()
      this.audio.onended = null
      this.audio = null
    }
    if (this.speaking) {
      this.speaking = null
      window.speechSynthesis.cancel()
    }
  }

  private async speak(line: Line, gen: number): Promise<boolean> {
    let slow = false
    const loadingTimer = setTimeout(() => {
      slow = true
      if (gen === this.gen) this.set({ loading: true })
    }, 250)
    const ref = await this.request(line)
    clearTimeout(loadingTimer)
    if (slow) this.set({ loading: false })
    if (gen !== this.gen) return false
    if (!(await this.untilResumed(gen))) return false

    const isSfx = line.kind === 'sfx'
    if (isSfx && (line.intensity >= 2 || line.delivery === 'shout' || line.delivery === 'loud')) {
      this.set({ shake: this.state.shake + 1 })
    }

    if (!ref) {
      if (isSfx) return this.wait(900, gen) // silent effect: just a visual beat
      return this.speakWeb(line, gen)
    }

    let el = this.elements.get(line.id)
    if (!el) el = new Audio(audioUrl(this.doc.meta.id, ref))
    this.elements.delete(line.id)
    el.currentTime = 0
    el.volume = isSfx ? this.settings.sfxVolume : 1
    this.audio = el
    const words = ref.words ?? []
    this.set({ words: ref.words })

    const done = new Promise<void>((resolve) => {
      el!.onended = () => resolve()
      el!.onerror = () => resolve()
    })
    const tick = (): void => {
      if (this.audio !== el) return
      const w = activeWordIndex(words, el!.currentTime)
      if (w !== this.state.word) this.set({ word: w })
      this.raf = requestAnimationFrame(tick)
    }
    try {
      await el.play()
    } catch {
      // Autoplay or decode problem – fall back to speech so the story goes on.
      this.audio = null
      return isSfx ? this.wait(600, gen) : this.speakWeb(line, gen)
    }
    this.raf = requestAnimationFrame(tick)

    if (isSfx) {
      // Let the effect ring out under the next beat.
      const ok = await Promise.race([done.then(() => true), this.wait(Math.min(ref.durationMs, 1600), gen)])
      if (this.audio === el) this.audio = null
      cancelAnimationFrame(this.raf)
      return ok && gen === this.gen
    }

    // Safety net: never hang if 'ended' does not fire.
    await Promise.race([done, this.wait(ref.durationMs + 4000, gen)])
    cancelAnimationFrame(this.raf)
    if (this.audio === el) this.audio = null
    this.set({ word: words.length })
    return gen === this.gen
  }

  /** Web Speech API fallback (no audio file available). */
  private async speakWeb(line: Line, gen: number): Promise<boolean> {
    const synth = window.speechSynthesis
    if (!synth) return this.wait(Math.max(1500, line.text.length * 70), gen)
    const ch = speakerOf(this.doc, line)
    const prosody = systemProsody(line)
    const u = new SpeechSynthesisUtterance(line.text)
    u.lang = 'cs-CZ'
    const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith('cs'))
    if (voice) u.voice = voice
    u.pitch = Math.min(2, Math.max(0, 1 + ((ch?.voice.pitch ?? 0) + prosody.pitch) / 12))
    u.rate = Math.min(2, Math.max(0.5, (ch?.voice.rate ?? 1) * prosody.rate))
    u.volume = prosody.volume
    this.speaking = u
    const done = new Promise<void>((resolve) => {
      u.onend = () => resolve()
      u.onerror = () => resolve()
    })
    synth.speak(u)
    await Promise.race([done, this.wait(line.text.length * 150 + 4000, gen)])
    if (this.speaking === u) this.speaking = null
    return gen === this.gen
  }
}
