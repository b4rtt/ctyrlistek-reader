/**
 * System-voice fallback (macOS `say`). Czech has a single built-in voice
 * (Zuzana), so characters are differentiated by pitch shifting and rate.
 * Modern voices ignore `[[pbas]]`/`[[volm]]`, therefore pitch and volume are
 * applied by post-processing the WAV (see wav.ts); only the rate is passed to
 * `say`, pre-compensated for the speed change caused by pitch shifting.
 */
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { SystemVoiceInfo } from '@shared/api'
import type { SystemProsody } from '@shared/performance'
import { applyGainAndFades, decodeWav, encodeWav, pitchShift, semitonesToFactor, trimSilence } from './wav'

const run = promisify(execFile)

export const systemTtsSupported = (): boolean => process.platform === 'darwin'

let voicesCache: SystemVoiceInfo[] | null = null

export async function listSystemVoices(): Promise<SystemVoiceInfo[]> {
  if (!systemTtsSupported()) return []
  if (voicesCache) return voicesCache
  const { stdout } = await run('say', ['-v', '?'])
  const voices: SystemVoiceInfo[] = []
  for (const line of stdout.split('\n')) {
    // "Zuzana (Enhanced)    cs_CZ    # Ahoj! …"
    const m = /^(.+?)\s{2,}([a-z]{2}_[A-Z]{2})\s+#/.exec(line)
    if (m) voices.push({ name: m[1].trim(), lang: m[2] })
  }
  const rank = (v: SystemVoiceInfo): number =>
    (v.lang === 'cs_CZ' ? 0 : v.lang === 'sk_SK' ? 10 : 20) -
    (/premium/i.test(v.name) ? 2 : /enhanced/i.test(v.name) ? 1 : 0)
  voicesCache = voices.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  return voicesCache
}

/**
 * Use the requested voice when installed, otherwise the best Czech voice,
 * otherwise the system default (undefined).
 */
export async function resolveSystemVoice(name: string): Promise<string | undefined> {
  const voices = await listSystemVoices().catch(() => [])
  if (voices.some((v) => v.name === name)) return name
  return voices.find((v) => v.lang === 'cs_CZ')?.name
}

/** Default speaking rate of macOS voices in words per minute. */
const BASE_WPM = 180

export interface SystemSynthParams {
  text: string
  voice: string
  /** Character pitch in semitones. */
  pitch: number
  /** Character rate multiplier. */
  rate: number
  prosody: SystemProsody
}

export async function synthesizeSystem(p: SystemSynthParams): Promise<{ wav: Buffer; durationMs: number }> {
  const semis = p.pitch + p.prosody.pitch
  const factor = semitonesToFactor(semis)
  // Resampling changes speed by `factor`; compensate when synthesising.
  const wpm = Math.round(Math.min(450, Math.max(90, (BASE_WPM * p.rate * p.prosody.rate) / factor)))
  const tmp = join(
    tmpdir(),
    `ctyrlistek-say-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`,
  )
  try {
    const voice = await resolveSystemVoice(p.voice)
    const args = [
      ...(voice ? ['-v', voice] : []),
      '-r',
      String(wpm),
      '--file-format=WAVE',
      '--data-format=LEI16@22050',
      '-o',
      tmp,
      p.text,
    ]
    await run('say', args, { timeout: 60_000 })
    const pcm = decodeWav(await fs.readFile(tmp))
    let samples = trimSilence(pcm.samples, pcm.sampleRate)
    samples = pitchShift(samples, factor)
    samples = applyGainAndFades(samples, pcm.sampleRate, 0.95 * p.prosody.volume)
    return {
      wav: encodeWav({ sampleRate: pcm.sampleRate, samples }),
      durationMs: Math.round((samples.length / pcm.sampleRate) * 1000),
    }
  } finally {
    await fs.rm(tmp, { force: true })
  }
}
