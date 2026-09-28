/**
 * "Acting" layer – turns the emotion/delivery the AI detected for a line into
 * concrete instructions for each TTS engine:
 *
 *  - ElevenLabs v3: audio tags such as `[angry]`, `[whispers]`, `[laughs]`.
 *  - ElevenLabs v2 / flash: voice_settings (stability / style / speed).
 *  - System voices: rate / pitch / volume modulation.
 */
import type { Delivery, Emotion, Intensity, LineKind } from './types'

export const EMOTION_META: Record<Emotion, { label: string; emoji: string }> = {
  neutral: { label: 'Normálně', emoji: '🙂' },
  happy: { label: 'Vesele', emoji: '😊' },
  excited: { label: 'Nadšeně', emoji: '🤩' },
  angry: { label: 'Naštvaně', emoji: '😠' },
  annoyed: { label: 'Otráveně', emoji: '😒' },
  sad: { label: 'Smutně', emoji: '😢' },
  scared: { label: 'Vyděšeně', emoji: '😨' },
  worried: { label: 'Ustaraně', emoji: '😟' },
  surprised: { label: 'Překvapeně', emoji: '😲' },
  curious: { label: 'Zvědavě', emoji: '🤔' },
  proud: { label: 'Hrdě', emoji: '😌' },
  sarcastic: { label: 'Ironicky', emoji: '😏' },
  mischievous: { label: 'Šibalsky', emoji: '😜' },
  tired: { label: 'Unaveně', emoji: '😴' },
  calm: { label: 'Klidně', emoji: '😇' },
  laughing: { label: 'Se smíchem', emoji: '😂' },
  crying: { label: 'Plačtivě', emoji: '😭' },
  thoughtful: { label: 'Zamyšleně', emoji: '💭' },
}

export const DELIVERY_META: Record<Delivery, { label: string; emoji: string }> = {
  whisper: { label: 'Šeptem', emoji: '🤫' },
  normal: { label: 'Normálně', emoji: '💬' },
  loud: { label: 'Hlasitě', emoji: '📢' },
  shout: { label: 'Křikem', emoji: '🗯️' },
}

export const KIND_META: Record<LineKind, { label: string }> = {
  speech: { label: 'Řeč' },
  thought: { label: 'Myšlenka' },
  narration: { label: 'Vypravěč' },
  sfx: { label: 'Zvuk' },
}

export interface PerformanceInput {
  kind: LineKind
  emotion: Emotion
  intensity: Intensity
  delivery: Delivery
}

// ---------------------------------------------------------- ElevenLabs v3 --

const V3_TAGS: Record<Emotion, [mild: string | null, strong: string | null]> = {
  neutral: [null, null],
  happy: ['happily', 'joyfully'],
  excited: ['excited', 'very excited'],
  angry: ['annoyed', 'angry'],
  annoyed: ['annoyed', 'irritated'],
  sad: ['sad', 'very sad'],
  scared: ['nervous', 'scared'],
  worried: ['worried', 'nervous'],
  surprised: ['surprised', 'shocked'],
  curious: ['curious', 'curious'],
  proud: ['proudly', 'proudly'],
  sarcastic: ['sarcastic', 'sarcastic'],
  mischievous: ['mischievously', 'mischievously'],
  tired: ['tired', 'exhausted'],
  calm: ['calmly', 'calmly'],
  laughing: ['laughs', 'laughs harder'],
  crying: ['sad', 'crying'],
  thoughtful: ['thoughtful', 'thoughtful'],
}

/** Audio tags to prepend for eleven_v3 (at most two, most important first). */
export function v3Tags(p: PerformanceInput): string[] {
  const tags: string[] = []
  if (p.delivery === 'whisper') tags.push('whispers')
  else if (p.delivery === 'shout') tags.push('shouting')

  const [mild, strong] = V3_TAGS[p.emotion]
  const emotionTag = p.intensity >= 2 ? strong : mild
  if (emotionTag) tags.push(emotionTag)

  if (tags.length === 0) {
    if (p.kind === 'thought') tags.push('softly')
    else if (p.kind === 'narration') tags.push('warmly')
  }
  return tags.slice(0, 2)
}

export function isV3(model: string): boolean {
  return model.startsWith('eleven_v3')
}

/** Text sent to ElevenLabs. Returns the offset where the spoken text starts. */
export function buildElevenText(
  text: string,
  p: PerformanceInput,
  model: string,
): { text: string; offset: number } {
  if (!isV3(model)) return { text, offset: 0 }
  const tags = v3Tags(p)
  const prefix = tags.map((t) => `[${t}] `).join('')
  return { text: prefix + text, offset: prefix.length }
}

export interface ElevenVoiceSettings {
  stability: number
  similarity_boost: number
  style: number
  use_speaker_boost: boolean
  speed: number
}

const SPEED: Partial<Record<Emotion, number>> = {
  excited: 1.06,
  scared: 1.06,
  angry: 1.03,
  surprised: 1.03,
  sad: 0.93,
  tired: 0.9,
  calm: 0.96,
  thoughtful: 0.95,
  crying: 0.94,
}

export function elevenVoiceSettings(
  p: PerformanceInput,
  model: string,
  baseStability: number,
  characterRate = 1,
): ElevenVoiceSettings {
  const speed = clampNum((SPEED[p.emotion] ?? 1) * characterRate, 0.8, 1.2)
  if (isV3(model)) {
    // v3 only distinguishes creative (0) / natural (0.5) / robust (1).
    const stability = baseStability <= 0.25 ? 0 : baseStability >= 0.75 ? 1 : 0.5
    return { stability, similarity_boost: 0.8, style: 0, use_speaker_boost: true, speed }
  }
  const emotional = p.emotion !== 'neutral' || p.delivery === 'shout' || p.delivery === 'whisper'
  const stability = clampNum(0.3 + baseStability * 0.4 - (emotional ? 0.08 * p.intensity : 0), 0.15, 0.85)
  const style = emotional ? clampNum(0.12 * p.intensity + 0.1, 0, 0.6) : 0.05
  return { stability, similarity_boost: 0.8, style, use_speaker_boost: true, speed }
}

// ---------------------------------------------------------- system voices --

export interface SystemProsody {
  /** Multiplier of the voice's default rate. */
  rate: number
  /** Pitch shift in "pbas" units (≈ semitones) relative to the voice. */
  pitch: number
  /** 0..1 */
  volume: number
  /** Pitch-modulation (expressiveness) multiplier. */
  modulation: number
}

const SYS_EMOTION: Partial<Record<Emotion, Partial<SystemProsody>>> = {
  happy: { rate: 1.04, pitch: 2, modulation: 1.2 },
  excited: { rate: 1.12, pitch: 4, modulation: 1.5 },
  angry: { rate: 1.08, pitch: -1, modulation: 1.4 },
  annoyed: { rate: 1.02, pitch: -1, modulation: 0.9 },
  sad: { rate: 0.88, pitch: -3, volume: 0.85, modulation: 0.7 },
  scared: { rate: 1.1, pitch: 3, modulation: 1.3 },
  worried: { rate: 0.98, pitch: 1 },
  surprised: { rate: 1.05, pitch: 5, modulation: 1.5 },
  curious: { rate: 1.0, pitch: 2, modulation: 1.2 },
  proud: { rate: 0.97, pitch: 1, modulation: 1.1 },
  mischievous: { rate: 1.03, pitch: 2, modulation: 1.3 },
  tired: { rate: 0.85, pitch: -3, volume: 0.85, modulation: 0.6 },
  calm: { rate: 0.95 },
  laughing: { rate: 1.08, pitch: 3, modulation: 1.4 },
  crying: { rate: 0.9, pitch: 2, volume: 0.9, modulation: 1.3 },
  thoughtful: { rate: 0.93, pitch: -1, volume: 0.85 },
}

export function systemProsody(p: PerformanceInput): SystemProsody {
  const e = SYS_EMOTION[p.emotion] ?? {}
  const k = p.intensity === 3 ? 1.5 : p.intensity === 2 ? 1 : 0.6
  let rate = 1 + ((e.rate ?? 1) - 1) * k
  let pitch = (e.pitch ?? 0) * k
  let volume = e.volume ?? 1
  let modulation = 1 + ((e.modulation ?? 1) - 1) * k

  switch (p.delivery) {
    case 'whisper':
      volume *= 0.55
      rate *= 0.93
      modulation *= 0.6
      break
    case 'loud':
      pitch += 1
      modulation *= 1.15
      break
    case 'shout':
      pitch += 3
      rate *= 1.06
      modulation *= 1.35
      break
  }
  if (p.kind === 'thought') volume *= 0.85

  rate = clampNum(rate, 0.75, 1.3)
  pitch = clampNum(pitch, -8, 10)
  volume = clampNum(volume, 0.3, 1)
  modulation = clampNum(modulation, 0.4, 2)
  return { rate, pitch, volume, modulation }
}

function clampNum(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}
