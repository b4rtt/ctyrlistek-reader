/**
 * Automatic voice casting.
 *
 * Picks an ElevenLabs voice for every character (matching gender, age, Czech
 * support and personality traits while keeping voices distinct) and derives
 * pitch/rate presets for the system-voice fallback.
 */
import type { VoiceInfo } from './api'
import type { Character, CharacterVoice } from './types'

const TRAIT_SYNONYMS: Record<string, string[]> = {
  deep: ['deep', 'low', 'bass', 'gravelly', 'raspy', 'husky', 'resonant'],
  calm: ['calm', 'soothing', 'relaxed', 'gentle', 'soft', 'measured'],
  warm: ['warm', 'friendly', 'pleasant', 'cozy'],
  storyteller: ['storyteller', 'storytelling', 'narration', 'narrative', 'audiobook', 'narrator'],
  narration: ['narration', 'narrative', 'narrator', 'audiobook', 'storytelling'],
  young: ['young', 'youthful', 'teen', 'childish', 'kid'],
  nervous: ['nervous', 'anxious', 'shy', 'timid', 'excitable'],
  jolly: ['jolly', 'cheerful', 'upbeat', 'playful', 'happy', 'friendly'],
  hearty: ['hearty', 'booming', 'jovial', 'robust'],
  kind: ['kind', 'friendly', 'warm', 'gentle', 'sweet'],
  confident: ['confident', 'assertive', 'professional', 'clear'],
  strong: ['strong', 'authoritative', 'powerful', 'robust'],
  smart: ['smart', 'intelligent', 'articulate', 'wise', 'sophisticated'],
  lively: ['lively', 'energetic', 'upbeat', 'dynamic', 'animated'],
  bright: ['bright', 'clear', 'crisp', 'light'],
  'higher-pitch': ['high', 'high-pitched', 'light', 'bright'],
  'mid-pitch': ['middle', 'balanced', 'neutral'],
  squeaky: ['squeaky', 'high-pitched', 'cartoon', 'animated'],
  gruff: ['gruff', 'gravelly', 'rough', 'raspy'],
  villain: ['villain', 'sinister', 'dark', 'menacing'],
  elderly: ['old', 'elderly', 'aged', 'grandfather', 'grandmother', 'wise'],
}

export function expandTraits(traits: string[]): Set<string> {
  const out = new Set<string>()
  for (const t of traits) {
    const k = t.toLowerCase().trim()
    out.add(k)
    for (const s of TRAIT_SYNONYMS[k] ?? []) out.add(s)
  }
  return out
}

function scoreVoice(voice: VoiceInfo, ch: Character, timesUsed: number): number {
  let score = 0

  if (ch.gender !== 'unknown') {
    if (voice.gender === ch.gender) score += 12
    else if (voice.gender !== 'unknown') score -= 30
  }

  if (ch.age === 'child') {
    if (voice.traits.some((t) => ['young', 'child', 'kid', 'childish', 'cartoon', 'animated'].includes(t))) score += 6
    if (voice.age === 'elderly') score -= 8
  } else if (ch.age === 'elderly') {
    if (voice.age === 'elderly') score += 6
    else if (voice.traits.includes('young')) score -= 3
  } else if (voice.age === 'elderly') {
    score -= 2
  }

  if (voice.languages.includes('cs')) score += 8

  const wanted = expandTraits(ch.voiceTraits)
  for (const t of voice.traits) if (wanted.has(t)) score += 2

  const useCase = (voice.useCase ?? '').toLowerCase()
  if (ch.isNarrator) {
    if (/narrat|story|audiobook/.test(useCase)) score += 6
  } else {
    if (/character|animation|game|cartoon/.test(useCase)) score += 4
    if (/conversation/.test(useCase)) score += 1
    if (/news|informative|educational/.test(useCase)) score -= 1
  }
  if (voice.category === 'premade') score += 0.5

  score -= timesUsed * 14
  return score
}

/** Order in which characters get to pick voices (most important first). */
export function castingOrder(characters: Character[]): Character[] {
  return [...characters].sort((a, b) => {
    const pa = a.isMain && !a.isNarrator ? 0 : a.isNarrator ? 1 : 2
    const pb = b.isMain && !b.isNarrator ? 0 : b.isNarrator ? 1 : 2
    if (pa !== pb) return pa - pb
    if (a.lineCount !== b.lineCount) return b.lineCount - a.lineCount
    return a.id.localeCompare(b.id)
  })
}

/**
 * Assign ElevenLabs voices. Characters with `voice.manual` keep their voice
 * (and still count towards usage so others avoid it). Returns a new array.
 */
export function assignElevenVoices(characters: Character[], voices: VoiceInfo[]): Character[] {
  if (voices.length === 0) return characters
  const byId = new Map(voices.map((v) => [v.id, v]))
  const used = new Map<string, number>()
  const result = new Map<string, CharacterVoice>()

  // Manual choices first so automatic casting avoids them.
  for (const ch of characters) {
    if (ch.voice.manual && ch.voice.elevenVoiceId && byId.has(ch.voice.elevenVoiceId)) {
      used.set(ch.voice.elevenVoiceId, (used.get(ch.voice.elevenVoiceId) ?? 0) + 1)
      result.set(ch.id, ch.voice)
    }
  }

  const sortedVoices = [...voices].sort((a, b) => a.name.localeCompare(b.name))
  for (const ch of castingOrder(characters)) {
    if (result.has(ch.id)) continue
    let best: VoiceInfo | null = null
    let bestScore = -Infinity
    for (const v of sortedVoices) {
      const s = scoreVoice(v, ch, used.get(v.id) ?? 0)
      if (s > bestScore) {
        bestScore = s
        best = v
      }
    }
    if (!best) continue
    used.set(best.id, (used.get(best.id) ?? 0) + 1)
    result.set(ch.id, { ...ch.voice, elevenVoiceId: best.id, elevenVoiceName: best.name, manual: false })
  }

  return characters.map((ch) => (result.has(ch.id) ? { ...ch, voice: result.get(ch.id)! } : ch))
}

/** Pitch (semitones) / rate presets for the heroes when using system voices. */
const SYSTEM_PRESETS: Record<string, { pitch: number; rate: number }> = {
  bobik: { pitch: -6, rate: 0.96 },
  myspulin: { pitch: -4, rate: 1.0 },
  pinda: { pitch: -2, rate: 1.1 },
  fifinka: { pitch: 1, rate: 1.03 },
  narrator: { pitch: -1, rate: 0.97 },
}

const MALE_STEPS = [-5, -3, -7, -2.5, -6.5, -4]
const FEMALE_STEPS = [0.5, 2, -0.5, 3, 1.5, -1]
const CHILD_STEPS = [4, 5.5, 3, 6]
const RATE_STEPS = [1, 1.06, 0.95, 1.1, 0.92, 1.03]

/**
 * Give every non-manual character a system voice + pitch/rate so that even with
 * a single OS voice the characters sound different.
 */
export function assignSystemVoices(characters: Character[], systemVoice: string): Character[] {
  const counters = { male: 0, female: 0, child: 0, other: 0 }
  const voices = new Map<string, CharacterVoice>()
  for (const ch of castingOrder(characters)) {
    if (ch.voice.manual && ch.voice.systemVoice) continue
    const preset = SYSTEM_PRESETS[ch.id]
    let pitch: number
    let rate: number
    if (preset) {
      ;({ pitch, rate } = preset)
    } else if (ch.age === 'child') {
      pitch = CHILD_STEPS[counters.child % CHILD_STEPS.length]
      rate = RATE_STEPS[counters.child++ % RATE_STEPS.length]
    } else if (ch.gender === 'male') {
      pitch = MALE_STEPS[counters.male % MALE_STEPS.length]
      rate = RATE_STEPS[counters.male++ % RATE_STEPS.length]
    } else if (ch.gender === 'female') {
      pitch = FEMALE_STEPS[counters.female % FEMALE_STEPS.length]
      rate = RATE_STEPS[counters.female++ % RATE_STEPS.length]
    } else {
      pitch = [-1.5, 1, -3][counters.other % 3]
      rate = RATE_STEPS[counters.other++ % RATE_STEPS.length]
    }
    if (ch.age === 'elderly') rate *= 0.92
    voices.set(ch.id, { ...ch.voice, systemVoice, pitch, rate })
  }
  return characters.map((ch) => (voices.has(ch.id) ? { ...ch, voice: voices.get(ch.id)! } : ch))
}
