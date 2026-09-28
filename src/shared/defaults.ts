import type { Settings } from './api'
import type { Character, CharacterVoice } from './types'

export const DEFAULT_SETTINGS: Settings = {
  openaiModel: 'gpt-6-sol',
  openaiEffort: 'medium',
  analysisConcurrency: 3,
  verifyPass: true,

  voiceMode: 'elevenlabs',
  elevenModel: 'eleven_v3',
  elevenStability: 0.5,
  elevenConcurrency: 2,
  sfxEnabled: true,
  systemVoice: 'Zuzana',

  subtitles: true,
  wordHighlight: true,
  pace: 1,
  pageIntro: true,
  zoom: 'medium',
  sfxVolume: 0.7,
}

/** `price` = USD per 1M input / output tokens (for cost estimates only). */
export const OPENAI_MODELS: { id: string; label: string; hint: string; price: [number, number] }[] = [
  {
    id: 'gpt-6-sol',
    label: 'GPT-6 Sol',
    hint: 'Doporučeno – skvělá přesnost za rozumnou cenu',
    price: [2, 10],
  },
  { id: 'gpt-6-astra', label: 'GPT-6 Astra', hint: 'Nejvyšší kvalita, zhruba 5× dražší', price: [10, 50] },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna', hint: 'Nejlevnější, méně přesné čtení', price: [0.1, 0.5] },
]

export const ELEVEN_MODELS: { id: string; label: string; hint: string }[] = [
  { id: 'eleven_v3', label: 'Eleven v3', hint: 'Nejvíc „filmové“ – emoce, šepot, smích, křik' },
  { id: 'eleven_multilingual_v2', label: 'Multilingual v2', hint: 'Stabilní a přirozený, méně emocí' },
  { id: 'eleven_flash_v2_5', label: 'Flash v2.5', hint: 'Nejrychlejší a nejlevnější' },
]

export const NARRATOR_ID = 'narrator'

/** Palette used to colour characters in the UI (kid-friendly, high contrast). */
export const CHARACTER_COLORS = [
  '#f59e0b',
  '#3b82f6',
  '#ec4899',
  '#10b981',
  '#8b5cf6',
  '#ef4444',
  '#14b8a6',
  '#f97316',
  '#6366f1',
  '#84cc16',
  '#06b6d4',
  '#d946ef',
]

export function defaultVoice(): CharacterVoice {
  return {
    elevenVoiceId: null,
    elevenVoiceName: null,
    systemVoice: null,
    pitch: 0,
    rate: 1,
    manual: false,
  }
}

type Seed = Pick<Character, 'id' | 'name' | 'gender' | 'age' | 'description' | 'voiceTraits' | 'color'>

/**
 * The four heroes of Čtyřlístek plus the narrator. They are always part of the
 * roster so the AI reuses stable ids for them across pages.
 */
export const MAIN_CHARACTERS: Seed[] = [
  {
    id: 'myspulin',
    name: 'Myšpulín',
    gender: 'male',
    age: 'adult',
    description: 'kocour, vynálezce a myslitel skupiny; klidný, rozvážný, vždy má nápad',
    voiceTraits: ['calm', 'smart', 'warm', 'mid-pitch'],
    color: '#3b82f6',
  },
  {
    id: 'fifinka',
    name: 'Fifinka',
    gender: 'female',
    age: 'adult',
    description: 'fenka, jediná holka ve Čtyřlístku; hodná, chytrá, rozhodná a spravedlivá',
    voiceTraits: ['kind', 'bright', 'confident', 'young'],
    color: '#ec4899',
  },
  {
    id: 'bobik',
    name: 'Bobík',
    gender: 'male',
    age: 'adult',
    description: 'prasátko, siláček a sportovec; rád a hodně jí, dobrosrdečný a přímočarý',
    voiceTraits: ['deep', 'jolly', 'strong', 'hearty'],
    color: '#f59e0b',
  },
  {
    id: 'pinda',
    name: 'Pinďa',
    gender: 'male',
    age: 'adult',
    description: 'zajíc, bojácný, ale nakonec statečně překoná strach; hravý a trochu ukvapený',
    voiceTraits: ['nervous', 'lively', 'higher-pitch', 'young'],
    color: '#10b981',
  },
]

export const NARRATOR_SEED: Seed = {
  id: NARRATOR_ID,
  name: 'Vypravěč',
  gender: 'unknown',
  age: 'adult',
  description: 'vypravěč příběhu (texty v rámečcích)',
  voiceTraits: ['warm', 'storyteller', 'calm', 'narration'],
  color: '#64748b',
}

export function seedToCharacter(seed: Seed, isNarrator = false): Character {
  return {
    ...seed,
    nameConfidence: 'high',
    genderConfidence: isNarrator ? 'medium' : 'high',
    isNarrator,
    isMain: true,
    thumb: null,
    lineCount: 0,
    confirmed: true,
    voice: defaultVoice(),
  }
}

export function initialRoster(): Character[] {
  return [...MAIN_CHARACTERS.map((s) => seedToCharacter(s)), seedToCharacter(NARRATOR_SEED, true)]
}
