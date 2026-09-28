import { describe, expect, it } from 'vitest'
import { convertPage, type RawPage } from '../../src/main/ai/convert'
import { CONSOLIDATE_SCHEMA, PAGE_SCHEMA, pageUserText } from '../../src/main/ai/prompts'
import { toVoiceInfo } from '../../src/main/tts/voiceInfo'
import { decodeWav, encodeWav, pitchShift, trimSilence } from '../../src/main/tts/wav'

/** OpenAI strict mode: every object lists all properties as required and forbids extras. */
function assertStrict(schema: unknown, path = '$'): void {
  if (!schema || typeof schema !== 'object') return
  const s = schema as Record<string, unknown>
  if (s.type === 'object' || (Array.isArray(s.type) && s.type.includes('object'))) {
    expect(s.additionalProperties, `${path}.additionalProperties`).toBe(false)
    const props = Object.keys((s.properties as object) ?? {})
    expect([...((s.required as string[]) ?? [])].sort(), `${path}.required`).toEqual([...props].sort())
  }
  for (const [k, v] of Object.entries(s)) {
    if (Array.isArray(v)) v.forEach((x, i) => assertStrict(x, `${path}.${k}[${i}]`))
    else if (v && typeof v === 'object') assertStrict(v, `${path}.${k}`)
  }
}

describe('OpenAI schemas', () => {
  it('are valid for strict structured outputs', () => {
    assertStrict(PAGE_SCHEMA)
    assertStrict(CONSOLIDATE_SCHEMA)
  })

  it('describe candidates in image pixel coordinates', () => {
    const text = pageUserText({
      comicId: 'x',
      title: 'T',
      pageIndex: 0,
      pageCount: 2,
      image: { data: new Uint8Array(), width: 1000, height: 1400 },
      overlay: null,
      candidates: [{ label: 'P1', rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.25 } }],
      roster: [],
    })
    expect(text).toContain('P1: [100, 140, 600, 490]')
    expect(text).toContain('1000×1400')
  })
})

describe('convertPage', () => {
  it('normalizes pixel boxes and drops degenerate panels', () => {
    const raw: RawPage = {
      page_kind: 'comic',
      panels: [
        {
          label: 'P1',
          box: { x0: 100, y0: 140, x1: 600, y1: 700 },
          lines: [
            {
              kind: 'speech',
              speaker: 'bobik',
              text_original: 'AHOJ!',
              text_spoken: 'Ahoj!',
              emotion: 'happy',
              intensity: 2,
              delivery: 'loud',
              direction: 'waves',
              bubble_box: { x0: 150, y0: 180, x1: 350, y1: 280 },
              sfx_prompt: null,
            },
          ],
        },
        { label: null, box: { x0: 10, y0: 10, x1: 10, y1: 10 }, lines: [] },
      ],
      characters: [],
      notes: '',
    }
    const res = convertPage(raw, 1000, 1400)
    expect(res.panels).toHaveLength(1)
    const r = res.panels[0].rect
    expect([r.x, r.y, r.w, r.h].map((v) => Math.round(v * 1000) / 1000)).toEqual([0.1, 0.1, 0.5, 0.4])
    const b = res.panels[0].lines[0].bubble!
    expect(b.x).toBeCloseTo(0.15)
    expect(b.y).toBeCloseTo(180 / 1400)
    expect(b.w).toBeCloseTo(0.2)
    expect(b.h).toBeCloseTo(100 / 1400)
    expect(res.panels[0].lines[0].textSpoken).toBe('Ahoj!')
  })
})

describe('toVoiceInfo', () => {
  it('extracts gender, traits and Czech support', () => {
    const v = toVoiceInfo({
      voice_id: 'abc',
      name: 'Pavel',
      category: 'professional',
      description: 'Warm Czech storyteller',
      labels: { gender: 'male', age: 'middle_aged', descriptive: 'deep calm', use_case: 'narrative_story' },
      verified_languages: [{ language: 'cs' }],
    })
    expect(v.gender).toBe('male')
    expect(v.age).toBe('adult')
    expect(v.languages).toContain('cs')
    expect(v.traits).toEqual(expect.arrayContaining(['deep', 'calm', 'storyteller']))
    expect(v.useCase).toBe('narrative_story')
  })
})

describe('wav processing', () => {
  const sr = 22050
  const tone = new Float32Array(sr).map((_, i) => (i > sr * 0.2 && i < sr * 0.8 ? Math.sin(i / 10) * 0.5 : 0))

  it('round-trips PCM', () => {
    const back = decodeWav(encodeWav({ sampleRate: sr, samples: tone }))
    expect(back.sampleRate).toBe(sr)
    expect(back.samples.length).toBe(tone.length)
    expect(back.samples[sr / 2]).toBeCloseTo(tone[sr / 2], 3)
  })

  it('trims silence but keeps padding', () => {
    const trimmed = trimSilence(tone, sr)
    expect(trimmed.length).toBeLessThan(tone.length * 0.8)
    expect(trimmed.length).toBeGreaterThan(tone.length * 0.6)
  })

  it('lower pitch lengthens, higher shortens', () => {
    expect(pitchShift(tone, 0.8).length).toBeGreaterThan(tone.length)
    expect(pitchShift(tone, 1.25).length).toBeLessThan(tone.length)
  })
})
