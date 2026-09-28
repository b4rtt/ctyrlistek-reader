/**
 * ElevenLabs REST client: voice list, quota, expressive TTS with timestamps
 * and sound-effect generation.
 */
import type { ElevenQuota, TestResult, VoiceInfo } from '@shared/api'
import { ERROR_CODES } from '@shared/api'
import type { CharAlignment } from '@shared/alignment'
import { getSecret } from '../settings'
import { toVoiceInfo, type RawVoice } from './voiceInfo'

/** Overridable for integration tests. */
const API = process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io'

export class ElevenError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail: string,
  ) {
    super(message)
  }
}

function apiKey(): string {
  const key = getSecret('elevenlabs')
  if (!key)
    throw new Error(`${ERROR_CODES.NO_ELEVEN_KEY}: Chybí ElevenLabs API klíč – doplňte ho v Nastavení.`)
  return key
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function friendlyError(status: number, detail: string): ElevenError {
  if (status === 401 || status === 403) {
    if (/quota|credits|character/i.test(detail))
      return new ElevenError(`${ERROR_CODES.QUOTA}: Na ElevenLabs účtu došly znaky/kredity.`, status, detail)
    return new ElevenError(
      `${ERROR_CODES.AUTH}: ElevenLabs odmítl API klíč. Zkontrolujte ho v Nastavení.`,
      status,
      detail,
    )
  }
  if (status === 429)
    return new ElevenError(
      `${ERROR_CODES.RATE_LIMIT}: ElevenLabs je přetížený, zkouším znovu…`,
      status,
      detail,
    )
  return new ElevenError(`ElevenLabs chyba ${status}: ${detail.slice(0, 300)}`, status, detail)
}

/** fetch with retries on 429/5xx/network errors (exponential backoff). */
async function request(path: string, init: RequestInit = {}, attempts = 5): Promise<Response> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${API}${path}`, {
        ...init,
        headers: {
          'xi-api-key': apiKey(),
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
        signal: AbortSignal.timeout(120_000),
      })
      if (res.ok) return res
      const detail = await res.text().catch(() => '')
      const err = friendlyError(res.status, detail)
      if (res.status === 429 || res.status >= 500) {
        lastErr = err
        const retryAfter = Number(res.headers.get('retry-after'))
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 800 * 2 ** i)
        continue
      }
      throw err
    } catch (err) {
      if (err instanceof ElevenError) throw err
      if (err instanceof Error && err.message.startsWith(ERROR_CODES.NO_ELEVEN_KEY)) throw err
      lastErr = new Error(
        `${ERROR_CODES.NETWORK}: Nepodařilo se spojit s ElevenLabs (${(err as Error).message}).`,
      )
      await sleep(800 * 2 ** i)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('ElevenLabs požadavek selhal')
}

// ------------------------------------------------------------------ voices --

let voiceCache: { at: number; voices: VoiceInfo[] } | null = null

export async function listVoices(force = false): Promise<VoiceInfo[]> {
  if (!force && voiceCache && Date.now() - voiceCache.at < 10 * 60 * 1000) return voiceCache.voices
  const voices: VoiceInfo[] = []
  let token: string | null = null
  for (let page = 0; page < 20; page++) {
    const qs = new URLSearchParams({ page_size: '100', include_total_count: 'false' })
    if (token) qs.set('next_page_token', token)
    const res = await request(`/v2/voices?${qs}`)
    const body = (await res.json()) as {
      voices: RawVoice[]
      has_more: boolean
      next_page_token: string | null
    }
    voices.push(...body.voices.map(toVoiceInfo))
    if (!body.has_more || !body.next_page_token) break
    token = body.next_page_token
  }
  voiceCache = { at: Date.now(), voices }
  return voices
}

export async function quota(): Promise<ElevenQuota> {
  const res = await request('/v1/user/subscription')
  const s = (await res.json()) as {
    character_count: number
    character_limit: number
    tier: string
    next_character_count_reset_unix?: number | null
  }
  return {
    used: s.character_count,
    limit: s.character_limit,
    tier: s.tier,
    resetsAt: s.next_character_count_reset_unix
      ? new Date(s.next_character_count_reset_unix * 1000).toISOString()
      : null,
  }
}

export async function testEleven(): Promise<TestResult> {
  try {
    const q = await quota()
    return {
      ok: true,
      message: `Klíč funguje (tarif ${q.tier}, využito ${q.used.toLocaleString('cs')} z ${q.limit.toLocaleString('cs')} znaků).`,
    }
  } catch (err) {
    // Keys restricted to TTS may not read the subscription – try the voice list.
    try {
      const v = await listVoices(true)
      return { ok: true, message: `Klíč funguje (${v.length} hlasů).` }
    } catch {
      return { ok: false, message: (err as Error).message }
    }
  }
}

// --------------------------------------------------------------------- tts --

export interface TtsParams {
  voiceId: string
  text: string
  modelId: string
  voiceSettings: Record<string, unknown>
  languageCode: string | null
  previousText?: string
  nextText?: string
}

export interface TtsResult {
  audio: Buffer
  alignment: CharAlignment | null
}

const OUTPUT_FORMAT = 'mp3_44100_128'
/** Models for which the timestamps endpoint turned out to be unavailable. */
const noTimestamps = new Set<string>()

export async function synthesize(p: TtsParams): Promise<TtsResult> {
  const body: Record<string, unknown> = {
    text: p.text,
    model_id: p.modelId,
    voice_settings: p.voiceSettings,
    apply_text_normalization: 'auto',
  }
  if (p.languageCode) body.language_code = p.languageCode
  if (p.previousText) body.previous_text = p.previousText
  if (p.nextText) body.next_text = p.nextText

  const path = `/v1/text-to-speech/${encodeURIComponent(p.voiceId)}`
  const plain = async (b: Record<string, unknown>): Promise<TtsResult> => {
    const res = await request(`${path}?output_format=${OUTPUT_FORMAT}`, {
      method: 'POST',
      body: JSON.stringify(b),
    })
    return { audio: Buffer.from(await res.arrayBuffer()), alignment: null }
  }
  const run = async (b: Record<string, unknown>): Promise<TtsResult> => {
    if (noTimestamps.has(p.modelId)) return plain(b)
    try {
      const res = await request(`${path}/with-timestamps?output_format=${OUTPUT_FORMAT}`, {
        method: 'POST',
        body: JSON.stringify(b),
      })
      const json = (await res.json()) as { audio_base64: string; alignment: CharAlignment | null }
      return { audio: Buffer.from(json.audio_base64, 'base64'), alignment: json.alignment ?? null }
    } catch (err) {
      // Timestamps may not be available for every model – use plain audio
      // (word highlighting then falls back to estimated timings).
      if (err instanceof ElevenError && [400, 404, 422].includes(err.status)) {
        const result = await plain(b)
        noTimestamps.add(p.modelId)
        return result
      }
      throw err
    }
  }

  try {
    return await run(body)
  } catch (err) {
    // Unsupported optional parameters → retry with a minimal body.
    if (
      err instanceof ElevenError &&
      (err.status === 400 || err.status === 422) &&
      /language|previous_text|next_text/i.test(err.detail)
    ) {
      const { language_code: _l, previous_text: _p, next_text: _n, ...minimal } = body
      return run(minimal)
    }
    throw err
  }
}

export async function soundEffect(prompt: string, durationSeconds: number | null): Promise<Buffer> {
  const res = await request(`/v1/sound-generation?output_format=${OUTPUT_FORMAT}`, {
    method: 'POST',
    body: JSON.stringify({
      text: prompt,
      duration_seconds: durationSeconds,
      prompt_influence: 0.45,
    }),
  })
  return Buffer.from(await res.arrayBuffer())
}
