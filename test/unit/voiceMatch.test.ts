import { describe, expect, it } from 'vitest'
import type { VoiceInfo } from '../../src/shared/api'
import { initialRoster } from '../../src/shared/defaults'
import type { Character } from '../../src/shared/types'
import { assignElevenVoices, assignSystemVoices } from '../../src/shared/voiceMatch'

const voice = (id: string, gender: VoiceInfo['gender'], extra: Partial<VoiceInfo> = {}): VoiceInfo => ({
  id,
  name: id,
  gender,
  age: 'adult',
  accent: null,
  description: '',
  category: 'premade',
  previewUrl: null,
  languages: [],
  traits: [],
  useCase: null,
  ...extra,
})

const voices = [
  voice('m-deep', 'male', { traits: ['deep', 'raspy'] }),
  voice('m-calm', 'male', { traits: ['calm', 'warm'] }),
  voice('m-young', 'male', { traits: ['young', 'energetic'] }),
  voice('f-bright', 'female', { traits: ['bright', 'friendly'] }),
  voice('f-cz', 'female', { languages: ['cs'] }),
  voice('n-story', 'male', { useCase: 'narrative_story', traits: ['warm'] }),
]

describe('assignElevenVoices', () => {
  const cast = assignElevenVoices(initialRoster(), voices)
  const by = (id: string): Character => cast.find((c) => c.id === id)!

  it('matches gender', () => {
    expect(voices.find((v) => v.id === by('fifinka').voice.elevenVoiceId)!.gender).toBe('female')
    for (const id of ['bobik', 'myspulin', 'pinda']) {
      expect(voices.find((v) => v.id === by(id).voice.elevenVoiceId)!.gender).toBe('male')
    }
  })

  it('prefers Czech voices and fitting traits', () => {
    expect(by('fifinka').voice.elevenVoiceId).toBe('f-cz')
    expect(by('bobik').voice.elevenVoiceId).toBe('m-deep')
  })

  it('keeps voices distinct while possible', () => {
    const ids = cast.map((c) => c.voice.elevenVoiceId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('respects manual choices', () => {
    const roster = initialRoster().map((c) =>
      c.id === 'bobik' ? { ...c, voice: { ...c.voice, elevenVoiceId: 'm-calm', elevenVoiceName: 'm-calm', manual: true } } : c,
    )
    const next = assignElevenVoices(roster, voices)
    expect(next.find((c) => c.id === 'bobik')!.voice.elevenVoiceId).toBe('m-calm')
    expect(next.filter((c) => c.voice.elevenVoiceId === 'm-calm')).toHaveLength(1)
  })
})

describe('assignSystemVoices', () => {
  it('gives heroes distinct pitch presets', () => {
    const cast = assignSystemVoices(initialRoster(), 'Zuzana')
    const pitches = cast.map((c) => c.voice.pitch)
    expect(new Set(pitches).size).toBe(pitches.length)
    expect(cast.every((c) => c.voice.systemVoice === 'Zuzana')).toBe(true)
    expect(cast.find((c) => c.id === 'bobik')!.voice.pitch).toBeLessThan(cast.find((c) => c.id === 'fifinka')!.voice.pitch)
  })
})
