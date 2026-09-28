/**
 * Audio generation front-end: picks the engine, applies the "acting" layer,
 * caches results on disk (content-addressed) and limits concurrency.
 */
import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { SfxRequest, SynthesizeRequest } from '@shared/api'
import { proportionalWords, wordsFromAlignment } from '@shared/alignment'
import { buildElevenText, elevenVoiceSettings, isV3, systemProsody } from '@shared/performance'
import type { AudioRef } from '@shared/types'
import { comicAsset, previewDir } from '../paths'
import { getSettings } from '../settings'
import { soundEffect, synthesize } from './elevenlabs'
import { synthesizeSystem, systemTtsSupported } from './system'

/** Bump when the processing pipeline changes so caches are regenerated. */
const PIPELINE_VERSION = 3
export const PREVIEW_HOST = 'preview-cache'

class Semaphore {
  private queue: (() => void)[] = []
  private active = 0
  constructor(private limit: () => number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit()) await new Promise<void>((r) => this.queue.push(r))
    this.active++
    try {
      return await fn()
    } finally {
      this.active--
      this.queue.shift()?.()
    }
  }
}

const elevenGate = new Semaphore(() => getSettings().elevenConcurrency)
const systemGate = new Semaphore(() => 3)
const inflight = new Map<string, Promise<AudioRef>>()

function hash(obj: unknown): string {
  return createHash('sha1').update(JSON.stringify(obj)).digest('hex').slice(0, 20)
}

function audioDir(comicId: string | null): string {
  return comicId ? comicAsset(comicId, 'audio') : previewDir()
}

interface StoredMeta {
  durationMs: number
  words: AudioRef['words']
}

async function cached(
  dir: string,
  key: string,
  ext: string,
  provider: AudioRef['provider'],
): Promise<AudioRef | null> {
  const meta = join(dir, `${key}.json`)
  const file = join(dir, `${key}.${ext}`)
  if (!existsSync(meta) || !existsSync(file)) return null
  try {
    const m = JSON.parse(await fs.readFile(meta, 'utf8')) as StoredMeta
    return { file: `audio/${key}.${ext}`, durationMs: m.durationMs, words: m.words, key, provider }
  } catch {
    return null
  }
}

async function store(
  dir: string,
  key: string,
  ext: string,
  data: Buffer,
  meta: StoredMeta,
  provider: AudioRef['provider'],
): Promise<AudioRef> {
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(join(dir, `${key}.${ext}`), data)
  await fs.writeFile(join(dir, `${key}.json`), JSON.stringify(meta))
  return { file: `audio/${key}.${ext}`, durationMs: meta.durationMs, words: meta.words, key, provider }
}

/** Constant-bitrate MP3 duration estimate (we always request 128 kbps). */
const mp3DurationMs = (bytes: number): number => Math.round((bytes * 8) / 128)

function dedupe(key: string, fn: () => Promise<AudioRef>): Promise<AudioRef> {
  const existing = inflight.get(key)
  if (existing) return existing
  const p = fn().finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

export async function synthesizeLine(req: SynthesizeRequest): Promise<AudioRef | null> {
  const text = req.text.trim()
  if (!text) return null
  const settings = getSettings()
  const perf = { kind: req.kind, emotion: req.emotion, intensity: req.intensity, delivery: req.delivery }
  const dir = audioDir(req.comicId)

  if (req.provider === 'system') {
    if (!systemTtsSupported()) return null // renderer falls back to Web Speech
    const voice = req.voice.systemVoice || settings.systemVoice
    const prosody = systemProsody(perf)
    const key = hash({
      v: PIPELINE_VERSION,
      e: 'system',
      text,
      voice,
      pitch: req.voice.pitch,
      rate: req.voice.rate,
      prosody,
    })
    return dedupe(key, async () => {
      const hit = await cached(dir, key, 'wav', 'system')
      if (hit) return hit
      const { wav, durationMs } = await systemGate.run(() =>
        synthesizeSystem({ text, voice, pitch: req.voice.pitch, rate: req.voice.rate, prosody }),
      )
      return store(
        dir,
        key,
        'wav',
        wav,
        { durationMs, words: proportionalWords(text, durationMs / 1000) },
        'system',
      )
    })
  }

  const voiceId = req.voice.elevenVoiceId
  if (!voiceId) throw new Error('Postava nemá přiřazený ElevenLabs hlas.')
  const model = settings.elevenModel
  const { text: input, offset } = buildElevenText(text, perf, model)
  const voiceSettings = elevenVoiceSettings(perf, model, settings.elevenStability, req.voice.rate)
  const languageCode = isV3(model) || model.includes('flash') || model.includes('turbo') ? 'cs' : null
  // Context helps v2 intonation; v3 is driven by tags instead.
  const previousText = isV3(model) ? undefined : req.previousText
  const nextText = isV3(model) ? undefined : req.nextText
  const key = hash({
    v: PIPELINE_VERSION,
    e: 'eleven',
    input,
    voiceId,
    model,
    voiceSettings,
    languageCode,
    previousText,
    nextText,
  })

  return dedupe(key, async () => {
    const hit = await cached(dir, key, 'mp3', 'elevenlabs')
    if (hit) return hit
    const res = await elevenGate.run(() =>
      synthesize({
        voiceId,
        text: input,
        modelId: model,
        voiceSettings: { ...voiceSettings },
        languageCode,
        previousText,
        nextText,
      }),
    )
    const durationMs = mp3DurationMs(res.audio.length)
    const words = wordsFromAlignment(text, offset, res.alignment, durationMs / 1000)
    return store(dir, key, 'mp3', res.audio, { durationMs, words }, 'elevenlabs')
  })
}

export async function generateSfx(req: SfxRequest): Promise<AudioRef> {
  const prompt = req.prompt.trim() || req.text
  // Short, punchy effects fit comic onomatopoeia best.
  const duration = Math.min(3, Math.max(0.8, req.text.length * 0.18))
  const key = hash({ v: PIPELINE_VERSION, e: 'sfx', prompt, duration })
  const dir = audioDir(req.comicId)
  return dedupe(key, async () => {
    const hit = await cached(dir, key, 'mp3', 'elevenlabs')
    if (hit) return hit
    const audio = await elevenGate.run(() => soundEffect(prompt, duration))
    return store(
      dir,
      key,
      'mp3',
      audio,
      { durationMs: mp3DurationMs(audio.length), words: null },
      'elevenlabs',
    )
  })
}
