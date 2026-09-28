import { describe, expect, it } from 'vitest'
import { activeWordIndex, proportionalWords, wordSpans, wordsFromAlignment } from '../../src/shared/alignment'

describe('word timings', () => {
  it('finds Czech words', () => {
    expect(wordSpans('Ahoj, Pinďo! Co děláš?').map((s) => s.end - s.start)).toEqual([4, 5, 2, 5])
  })

  it('maps character alignment past an audio-tag prefix', () => {
    const text = 'Ahoj Bobíku'
    const input = `[happily] ${text}`
    const chars = [...input]
    const starts = chars.map((_, i) => i * 0.1)
    const ends = chars.map((_, i) => i * 0.1 + 0.1)
    const words = wordsFromAlignment(
      text,
      10,
      { characters: chars, character_start_times_seconds: starts, character_end_times_seconds: ends },
      3,
    )
    expect(words).toHaveLength(2)
    expect(words[0].t0).toBeCloseTo(1.0)
    expect(words[1].t0).toBeCloseTo(1.5)
  })

  it('falls back to proportional timing on mismatch', () => {
    const words = wordsFromAlignment(
      'Ahoj světe',
      0,
      { characters: ['x'], character_start_times_seconds: [0], character_end_times_seconds: [1] },
      2,
    )
    expect(words).toHaveLength(2)
    expect(words[1].t0).toBeGreaterThan(words[0].t0)
    expect(words[1].t1).toBeLessThanOrEqual(2)
  })

  it('reports the active word', () => {
    const words = proportionalWords('jedna dva tři', 3)
    expect(activeWordIndex(words, 0)).toBe(-1)
    expect(activeWordIndex(words, 2.9)).toBe(2)
  })
})
