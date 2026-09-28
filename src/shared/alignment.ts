import type { WordTiming } from './types'

/** Character-level alignment as returned by ElevenLabs `/with-timestamps`. */
export interface CharAlignment {
  characters: string[]
  character_start_times_seconds: number[]
  character_end_times_seconds: number[]
}

/** Find word boundaries in `text` (letters, digits and inner apostrophes/hyphens). */
export function wordSpans(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = []
  const re = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) spans.push({ start: m.index, end: m.index + m[0].length })
  return spans
}

/**
 * Convert character alignment into word timings for `text`.
 *
 * `offset` is the number of characters in the synthesized input that precede
 * `text` (e.g. v3 audio tags like `[angry] `). If the alignment does not match
 * the input (the service normalised it differently) we fall back to
 * proportional timing.
 */
export function wordsFromAlignment(
  text: string,
  offset: number,
  alignment: CharAlignment | null | undefined,
  durationSec: number,
): WordTiming[] {
  const spans = wordSpans(text)
  if (!alignment || alignment.characters.length < offset + text.length) {
    return proportionalWords(text, durationSec)
  }
  const aligned = alignment.characters.slice(offset, offset + text.length).join('')
  if (aligned !== text) return proportionalWords(text, durationSec)

  const starts = alignment.character_start_times_seconds
  const ends = alignment.character_end_times_seconds
  return spans.map((s) => ({
    start: s.start,
    end: s.end,
    t0: starts[offset + s.start] ?? 0,
    t1: ends[offset + s.end - 1] ?? durationSec,
  }))
}

/** Estimate word timings by distributing the duration by character count. */
export function proportionalWords(text: string, durationSec: number, leadIn = 0.08): WordTiming[] {
  const spans = wordSpans(text)
  if (spans.length === 0) return []
  // Weight = letters + a little for the following pause/punctuation.
  const weights = spans.map((s, i) => {
    const next = spans[i + 1]?.start ?? text.length
    const gap = text.slice(s.end, next)
    const pause = /[.!?…]/.test(gap) ? 4 : /[,;:—–-]/.test(gap) ? 2 : 0.6
    return s.end - s.start + pause
  })
  const total = weights.reduce((a, b) => a + b, 0)
  const usable = Math.max(0.1, durationSec - leadIn * 2)
  let t = leadIn
  return spans.map((s, i) => {
    const dur = (weights[i] / total) * usable
    const letters = ((s.end - s.start) / weights[i]) * dur
    const w = { start: s.start, end: s.end, t0: t, t1: t + letters }
    t += dur
    return w
  })
}

/** Index of the word being spoken at time `t` (or -1 before the first word). */
export function activeWordIndex(words: WordTiming[], t: number): number {
  let idx = -1
  for (let i = 0; i < words.length; i++) {
    if (words[i].t0 <= t) idx = i
    else break
  }
  return idx
}
