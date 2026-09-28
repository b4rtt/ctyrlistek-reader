import { describe, expect, it } from 'vitest'
import { buildElevenText, elevenVoiceSettings, systemProsody, v3Tags } from '../../src/shared/performance'

const base = {
  kind: 'speech' as const,
  emotion: 'neutral' as const,
  intensity: 1 as const,
  delivery: 'normal' as const,
}

describe('v3 audio tags', () => {
  it('adds delivery and emotion tags', () => {
    expect(v3Tags({ ...base, emotion: 'angry', intensity: 3, delivery: 'shout' })).toEqual([
      'shouting',
      'angry',
    ])
    expect(v3Tags({ ...base, emotion: 'scared', delivery: 'whisper' })).toEqual(['whispers', 'nervous'])
    expect(v3Tags({ ...base, emotion: 'laughing', intensity: 3 })).toEqual(['laughs harder'])
  })
  it('keeps neutral speech untagged but colours thoughts and narration', () => {
    expect(v3Tags(base)).toEqual([])
    expect(v3Tags({ ...base, kind: 'thought' })).toEqual(['softly'])
    expect(v3Tags({ ...base, kind: 'narration' })).toEqual(['warmly'])
  })
  it('prefixes text only for v3 models and reports the offset', () => {
    const p = { ...base, emotion: 'excited' as const, intensity: 2 as const }
    expect(buildElevenText('Hurá!', p, 'eleven_v3')).toEqual({ text: '[very excited] Hurá!', offset: 15 })
    expect(buildElevenText('Hurá!', p, 'eleven_multilingual_v2')).toEqual({ text: 'Hurá!', offset: 0 })
  })
})

describe('voice settings', () => {
  it('snaps stability to v3 presets', () => {
    expect(elevenVoiceSettings(base, 'eleven_v3', 0.2).stability).toBe(0)
    expect(elevenVoiceSettings(base, 'eleven_v3', 0.5).stability).toBe(0.5)
    expect(elevenVoiceSettings(base, 'eleven_v3', 0.9).stability).toBe(1)
  })
  it('makes emotional v2 lines more expressive', () => {
    const calm = elevenVoiceSettings(base, 'eleven_multilingual_v2', 0.5)
    const angry = elevenVoiceSettings(
      { ...base, emotion: 'angry', intensity: 3 },
      'eleven_multilingual_v2',
      0.5,
    )
    expect(angry.style).toBeGreaterThan(calm.style)
    expect(angry.stability).toBeLessThan(calm.stability)
  })
})

describe('system prosody', () => {
  it('whispers quietly and shouts higher', () => {
    expect(systemProsody({ ...base, delivery: 'whisper' }).volume).toBeLessThan(0.7)
    expect(systemProsody({ ...base, delivery: 'shout' }).pitch).toBeGreaterThan(0)
  })
  it('slows down sad lines', () => {
    expect(systemProsody({ ...base, emotion: 'sad', intensity: 2 }).rate).toBeLessThan(1)
  })
})
