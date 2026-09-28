/**
 * Contract between the renderer and the main process.
 *
 * The preload script exposes an object implementing {@link AppApi} as
 * `window.ctyrlistek`. Every call is an IPC round-trip handled in
 * `src/main/ipc.ts`.
 */
import type {
  AgeGroup,
  AudioRef,
  ComicDoc,
  ComicSummary,
  Confidence,
  Delivery,
  Emotion,
  Gender,
  Intensity,
  LineKind,
  PageKind,
  Rect,
} from './types'

// ---------------------------------------------------------------- settings --

export type VoiceMode = 'elevenlabs' | 'system'
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high'

export interface Settings {
  /** OpenAI model used for page analysis. */
  openaiModel: string
  openaiEffort: ReasoningEffort
  /** How many pages are analysed in parallel. */
  analysisConcurrency: number

  voiceMode: VoiceMode
  elevenModel: string
  /** 0 = creative, 0.5 = natural, 1 = robust (eleven_v3 semantics). */
  elevenStability: number
  elevenConcurrency: number
  /** Generate sound effects (BUM!, PRÁSK!) with ElevenLabs. */
  sfxEnabled: boolean
  /** Default OS voice for the system-voice mode. */
  systemVoice: string

  subtitles: boolean
  wordHighlight: boolean
  /** Multiplier for pauses between lines/panels (0.6 = snappy, 1.6 = slow). */
  pace: number
  /** Show the whole page briefly before zooming into the first panel. */
  pageIntro: boolean
  /** Volume of sound effects relative to speech (0..1). */
  sfxVolume: number
}

export type KeySource = 'stored' | 'env' | null

export interface SettingsView extends Settings {
  openaiKey: KeySource
  elevenKey: KeySource
  /** Whether secrets are encrypted with the OS keychain. */
  secureStorage: boolean
  mockAi: boolean
}

export type SecretKind = 'openai' | 'elevenlabs'

export interface TestResult {
  ok: boolean
  message: string
}

// ---------------------------------------------------------------- analysis --

export interface EncodedImage {
  /** JPEG bytes. */
  data: Uint8Array
  width: number
  height: number
}

export interface RosterEntry {
  id: string
  name: string
  gender: Gender
  age: AgeGroup
  description: string
}

export interface AnalyzePageRequest {
  comicId: string
  title: string
  pageIndex: number
  pageCount: number
  /** Clean page image – all AI coordinates refer to this image. */
  image: EncodedImage
  /** Same page with candidate panels outlined and labelled P1, P2, … */
  overlay: EncodedImage | null
  candidates: { label: string; rect: Rect }[]
  roster: RosterEntry[]
}

export interface AiLine {
  kind: LineKind
  /** Roster id, a new `new_*` key, `narrator`, or '' for sfx. */
  speaker: string
  textOriginal: string
  textSpoken: string
  emotion: Emotion
  intensity: Intensity
  delivery: Delivery
  direction: string
  bubble: Rect | null
  sfxPrompt: string | null
}

export interface AiPanel {
  /** Candidate label (e.g. "P3") when the AI confirmed a detected panel. */
  label: string | null
  rect: Rect
  lines: AiLine[]
}

export interface AiCharacter {
  key: string
  isNew: boolean
  name: string
  nameConfidence: Confidence
  nameEvidence: string
  gender: Gender
  genderConfidence: Confidence
  age: AgeGroup
  look: string
  voiceTraits: string[]
  face: Rect | null
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
}

export interface AnalyzePageResult {
  pageKind: PageKind
  panels: AiPanel[]
  characters: AiCharacter[]
  notes: string
  usage: TokenUsage
  model: string
}

export interface ConsolidateCharacter {
  id: string
  name: string
  nameConfidence: Confidence
  gender: Gender
  genderConfidence: Confidence
  age: AgeGroup
  description: string
  isMain: boolean
  sampleLines: string[]
  /** Lines of *other* characters that may address this one. */
  addressedAs: string[]
  thumb: EncodedImage | null
}

export interface ConsolidateRequest {
  title: string
  characters: ConsolidateCharacter[]
}

export interface ConsolidateResult {
  merges: { into: string; from: string[] }[]
  updates: {
    id: string
    name: string
    nameConfidence: Confidence
    gender: Gender
    genderConfidence: Confidence
    age: AgeGroup
  }[]
  usage: TokenUsage
}

// ------------------------------------------------------------------ voices --

export interface VoiceInfo {
  id: string
  name: string
  gender: Gender
  age: AgeGroup
  accent: string | null
  description: string
  category: string
  previewUrl: string | null
  /** ISO 639-1 codes the voice is verified for. */
  languages: string[]
  /** Lower-cased descriptive words collected from labels/description. */
  traits: string[]
  useCase: string | null
}

export interface SystemVoiceInfo {
  name: string
  lang: string
}

export interface ElevenQuota {
  used: number
  limit: number
  tier: string
  resetsAt: string | null
}

export interface SynthesizeRequest {
  /** Comic to store the audio in; `null` = temporary preview cache. */
  comicId: string | null
  provider: VoiceMode
  kind: LineKind
  text: string
  emotion: Emotion
  intensity: Intensity
  delivery: Delivery
  voice: {
    elevenVoiceId: string | null
    systemVoice: string | null
    pitch: number
    rate: number
  }
  previousText?: string
  nextText?: string
}

export interface SfxRequest {
  comicId: string
  prompt: string
  text: string
}

// --------------------------------------------------------------------- api --

export interface AppApi {
  platform: string
  settings: {
    get(): Promise<SettingsView>
    update(patch: Partial<Settings>): Promise<SettingsView>
    setSecret(kind: SecretKind, value: string | null): Promise<SettingsView>
    test(kind: SecretKind): Promise<TestResult>
  }
  library: {
    list(): Promise<ComicSummary[]>
    create(title: string, pdf: Uint8Array): Promise<ComicDoc>
    load(id: string): Promise<ComicDoc>
    save(doc: ComicDoc): Promise<ComicDoc>
    remove(id: string): Promise<void>
    writePage(id: string, index: number, jpeg: Uint8Array): Promise<string>
    readSource(id: string): Promise<Uint8Array>
    reveal(id: string | null): Promise<void>
  }
  ai: {
    analyzePage(req: AnalyzePageRequest): Promise<AnalyzePageResult>
    consolidate(req: ConsolidateRequest): Promise<ConsolidateResult>
  }
  voices: {
    listEleven(force?: boolean): Promise<VoiceInfo[]>
    listSystem(): Promise<SystemVoiceInfo[]>
    quota(): Promise<ElevenQuota | null>
    synthesize(req: SynthesizeRequest): Promise<AudioRef | null>
    sfx(req: SfxRequest): Promise<AudioRef>
  }
}

/** Errors crossing IPC lose their class; we prefix messages with a code. */
export const ERROR_CODES = {
  NO_OPENAI_KEY: 'NO_OPENAI_KEY',
  NO_ELEVEN_KEY: 'NO_ELEVEN_KEY',
  QUOTA: 'QUOTA',
  AUTH: 'AUTH',
  RATE_LIMIT: 'RATE_LIMIT',
  NETWORK: 'NETWORK',
} as const
