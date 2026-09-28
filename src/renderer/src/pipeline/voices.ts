/**
 * Voice preparation: casting (automatic voice assignment) and batch audio
 * generation for every line, with progress reporting.
 */
import type { Settings, SettingsView, SynthesizeRequest, VoiceInfo } from '@shared/api'
import { NARRATOR_ID } from '@shared/defaults'
import { allLines } from '@shared/timeline'
import type { AudioRef, Character, ComicDoc, Line } from '@shared/types'
import { assignElevenVoices, assignSystemVoices } from '@shared/voiceMatch'
import { api, errorCode, errorMessage } from '../api'

/** Build the synthesis request for a line spoken by `ch`. */
export function lineRequest(
  comicId: string | null,
  line: Pick<Line, 'kind' | 'text' | 'emotion' | 'intensity' | 'delivery'>,
  ch: Character | undefined,
  settings: Settings,
  context: { previousText?: string; nextText?: string } = {},
): SynthesizeRequest {
  return {
    comicId,
    provider: settings.voiceMode,
    kind: line.kind,
    text: line.text,
    emotion: line.emotion,
    intensity: line.intensity,
    delivery: line.delivery,
    voice: {
      elevenVoiceId: ch?.voice.elevenVoiceId ?? null,
      systemVoice: ch?.voice.systemVoice ?? settings.systemVoice,
      pitch: ch?.voice.pitch ?? 0,
      rate: ch?.voice.rate ?? 1,
    },
    ...context,
  }
}

/** Make sure every character has a voice for the current mode. */
export function castVoices(doc: ComicDoc, settings: Settings, elevenVoices: VoiceInfo[]): ComicDoc {
  const characters =
    settings.voiceMode === 'elevenlabs' && elevenVoices.length
      ? assignElevenVoices(
          doc.characters.map((c) =>
            // Drop voices that no longer exist in the account.
            c.voice.elevenVoiceId && !elevenVoices.some((v) => v.id === c.voice.elevenVoiceId)
              ? { ...c, voice: { ...c.voice, elevenVoiceId: null, elevenVoiceName: null, manual: false } }
              : c,
          ),
          elevenVoices,
        )
      : doc.characters
  return { ...doc, characters: assignSystemVoices(characters, settings.systemVoice) }
}

/** Characters whose automatic casting may change when their gender/age changes. */
export function recastOne(doc: ComicDoc, id: string, settings: Settings, elevenVoices: VoiceInfo[]): ComicDoc {
  const reset = doc.characters.map((c) =>
    c.id === id && !c.voice.manual ? { ...c, voice: { ...c.voice, elevenVoiceId: null, elevenVoiceName: null } } : c,
  )
  return castVoices({ ...doc, characters: reset }, settings, elevenVoices)
}

export interface VoiceProgress {
  total: number
  done: number
  failed: number
  current: string
}

export function speakerOf(doc: ComicDoc, line: Line): Character | undefined {
  return doc.characters.find((c) => c.id === (line.speakerId ?? NARRATOR_ID))
}

/** Generate (or fetch from cache) audio for one line. */
export async function synthesizeLine(
  doc: ComicDoc,
  line: Line,
  settings: Settings,
  context: { previousText?: string; nextText?: string } = {},
): Promise<AudioRef | null> {
  if (line.kind === 'sfx') {
    if (settings.voiceMode === 'elevenlabs') {
      if (!settings.sfxEnabled) return null
      return api.voices.sfx({ comicId: doc.meta.id, prompt: line.sfxPrompt ?? line.text, text: line.text })
    }
    // System voices: the narrator reads the onomatopoeia with gusto.
    const narrator = doc.characters.find((c) => c.id === NARRATOR_ID)
    return api.voices.synthesize(lineRequest(doc.meta.id, { ...line, kind: 'narration', delivery: 'loud' }, narrator, settings))
  }
  return api.voices.synthesize(lineRequest(doc.meta.id, line, speakerOf(doc, line), settings, context))
}

const FATAL = new Set(['AUTH', 'QUOTA', 'NO_ELEVEN_KEY'])

/**
 * Generate audio for all lines. Returns the updated document; lines that
 * failed keep `audio: null` (the player retries them on the fly).
 */
export async function prepareVoices(
  doc: ComicDoc,
  settings: SettingsView,
  onProgress: (p: VoiceProgress) => void,
  signal: AbortSignal,
): Promise<{ doc: ComicDoc; error: string | null }> {
  const items = allLines(doc)
  const progress: VoiceProgress = { total: items.length, done: 0, failed: 0, current: '' }
  onProgress({ ...progress })
  const results = new Map<string, AudioRef | null>()
  let fatal: string | null = null
  const queue = items.map((it, i) => ({ ...it, i }))
  const workers = settings.voiceMode === 'elevenlabs' ? settings.elevenConcurrency + 1 : 3

  await Promise.all(
    Array.from({ length: Math.min(workers, queue.length) }, async () => {
      for (let item = queue.shift(); item && !fatal && !signal.aborted; item = queue.shift()) {
        const prev = items[item.i - 1]?.line
        const next = items[item.i + 1]?.line
        progress.current = item.line.text
        onProgress({ ...progress })
        try {
          const audio = await synthesizeLine(doc, item.line, settings, {
            previousText: prev && prev.speakerId === item.line.speakerId ? prev.text : undefined,
            nextText: next && next.speakerId === item.line.speakerId ? next.text : undefined,
          })
          results.set(item.line.id, audio)
        } catch (err) {
          const code = errorCode(err)
          if (code && FATAL.has(code)) fatal = errorMessage(err)
          progress.failed++
          console.warn('Voice generation failed:', errorMessage(err))
        }
        progress.done++
        onProgress({ ...progress })
      }
    }),
  )

  const updated: ComicDoc = {
    ...doc,
    pages: doc.pages.map((pg) => ({
      ...pg,
      panels: pg.panels.map((p) => ({
        ...p,
        lines: p.lines.map((l) => (results.has(l.id) ? { ...l, audio: results.get(l.id) ?? null } : l)),
      })),
    })),
  }
  return { doc: updated, error: fatal }
}

/** Characters needed for all lines (used for quota estimates). */
export function totalCharacters(doc: ComicDoc): number {
  return allLines(doc).reduce((n, { line }) => n + (line.kind === 'sfx' ? 0 : line.text.length + 12), 0)
}
