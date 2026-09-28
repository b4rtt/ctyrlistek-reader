/**
 * Core data model shared by the main process and the renderer.
 *
 * All geometry is stored in *normalized page coordinates* (0..1 on both axes,
 * origin top-left) so it is independent of the resolution a page was rendered
 * or analysed at.
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type Gender = 'male' | 'female' | 'unknown'
export type AgeGroup = 'child' | 'adult' | 'elderly' | 'unknown'
export type Confidence = 'high' | 'medium' | 'low'

/** What kind of text a line is. */
export type LineKind = 'speech' | 'thought' | 'narration' | 'sfx'

export const EMOTIONS = [
  'neutral',
  'happy',
  'excited',
  'angry',
  'annoyed',
  'sad',
  'scared',
  'worried',
  'surprised',
  'curious',
  'proud',
  'sarcastic',
  'mischievous',
  'tired',
  'calm',
  'laughing',
  'crying',
  'thoughtful',
] as const
export type Emotion = (typeof EMOTIONS)[number]

/** How loudly a line is delivered (bubble shape / lettering size). */
export const DELIVERIES = ['whisper', 'normal', 'loud', 'shout'] as const
export type Delivery = (typeof DELIVERIES)[number]

export type Intensity = 1 | 2 | 3

export interface WordTiming {
  /** Index range into `Line.text` (end exclusive). */
  start: number
  end: number
  /** Seconds from the start of the audio clip. */
  t0: number
  t1: number
}

export interface AudioRef {
  /** Path relative to the comic directory, e.g. `audio/3f2a….mp3`. */
  file: string
  durationMs: number
  /** Per-word timings for karaoke-style subtitles (null = unknown). */
  words: WordTiming[] | null
  /** Hash of everything that influenced the audio – used as cache key. */
  key: string
  provider: 'elevenlabs' | 'system'
}

export interface Line {
  id: string
  kind: LineKind
  /** Character id; `null` only for sound effects. */
  speakerId: string | null
  /** Speakable Czech text (normal capitalisation, no hyphenation). */
  text: string
  /** Text exactly as printed in the comic. */
  originalText: string
  emotion: Emotion
  intensity: Intensity
  delivery: Delivery
  /** Short English acting direction from the AI (informational). */
  direction: string
  /** Bubble / caption location, if known. */
  bubble: Rect | null
  /** English prompt for a sound-effect generator (sfx lines only). */
  sfxPrompt: string | null
  audio: AudioRef | null
}

export interface Panel {
  id: string
  rect: Rect
  lines: Line[]
}

export type PageKind = 'comic' | 'cover' | 'text' | 'other'
export type PageStatus = 'pending' | 'done' | 'error'

export interface PageData {
  index: number
  /** Path relative to the comic directory, e.g. `pages/p001.jpg`. */
  image: string
  width: number
  height: number
  kind: PageKind
  status: PageStatus
  error: string | null
  /** Panels found by local image analysis before the AI pass. */
  candidates: Rect[]
  /** Panels in reading order. */
  panels: Panel[]
  /** Excluded from playback (ads, puzzles, …). */
  skip: boolean
}

export interface CharacterVoice {
  elevenVoiceId: string | null
  elevenVoiceName: string | null
  /** System (OS) voice name, e.g. "Zuzana". */
  systemVoice: string | null
  /** Pitch shift in semitones for system voices (-8 … +6). */
  pitch: number
  /** Speaking-rate multiplier (0.75 – 1.3). */
  rate: number
  /** The user picked the voice by hand – never auto-reassign. */
  manual: boolean
}

export interface Character {
  id: string
  name: string
  nameConfidence: Confidence
  gender: Gender
  genderConfidence: Confidence
  age: AgeGroup
  /** Short Czech visual description ("prasátko v pruhovaném tričku"). */
  description: string
  /** Voice-casting hints, English words ("deep", "squeaky", "calm"). */
  voiceTraits: string[]
  isNarrator: boolean
  /** One of the four main heroes (or the narrator). */
  isMain: boolean
  /** Where to crop a portrait from. */
  thumb: { page: number; rect: Rect } | null
  lineCount: number
  /** The user confirmed name + gender in the review screen. */
  confirmed: boolean
  voice: CharacterVoice
  /** Accent colour used in the UI. */
  color: string
}

export type ComicStage = 'rendering' | 'analyzing' | 'review' | 'ready'

export interface ComicMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  pageCount: number
  stage: ComicStage
  /** Relative path to the cover image. */
  cover: string | null
  analysis: {
    model: string | null
    inputTokens: number
    outputTokens: number
    finishedAt: string | null
  }
  /** Beat index where playback was last left. */
  lastBeat: number | null
}

export interface ComicDoc {
  schemaVersion: 1
  meta: ComicMeta
  pages: PageData[]
  characters: Character[]
}

export interface ComicSummary {
  meta: ComicMeta
  pagesDone: number
  pagesFailed: number
  needsReview: number
  lineCount: number
  voicedLines: number
}
