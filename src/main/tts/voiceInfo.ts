/** Mapping of ElevenLabs voice objects to `VoiceInfo`. Pure – unit tested. */
import type { VoiceInfo } from '@shared/api'
import type { AgeGroup, Gender } from '@shared/types'

export interface RawVoice {
  voice_id: string
  name: string
  category?: string
  description?: string | null
  preview_url?: string | null
  labels?: Record<string, string> | null
  verified_languages?: { language: string; accent?: string | null }[] | null
}

function mapGender(g: string | undefined): Gender {
  const v = (g ?? '').toLowerCase()
  if (v === 'male' || v === 'man') return 'male'
  if (v === 'female' || v === 'woman') return 'female'
  return 'unknown'
}

function mapAge(a: string | undefined): AgeGroup {
  const v = (a ?? '').toLowerCase()
  if (/old|elder|senior/.test(v)) return 'elderly'
  if (/child|kid/.test(v)) return 'child'
  if (v) return 'adult'
  return 'unknown'
}

export function toVoiceInfo(v: RawVoice): VoiceInfo {
  const labels = v.labels ?? {}
  const words = new Set<string>()
  const add = (s: string | null | undefined): void => {
    for (const w of (s ?? '').toLowerCase().split(/[^a-z-]+/)) if (w.length > 2) words.add(w)
  }
  add(labels.description)
  add(labels.descriptive)
  add(labels.use_case)
  add(labels.age)
  add(v.description)
  const languages = new Set<string>()
  for (const l of v.verified_languages ?? []) languages.add(l.language.toLowerCase().slice(0, 2))
  if (labels.language) languages.add(labels.language.toLowerCase().slice(0, 2))
  if (/czech|česk/i.test(`${labels.accent ?? ''} ${v.description ?? ''}`)) languages.add('cs')
  return {
    id: v.voice_id,
    name: v.name,
    gender: mapGender(labels.gender),
    age: mapAge(labels.age),
    accent: labels.accent ?? null,
    description: v.description ?? labels.description ?? '',
    category: v.category ?? 'unknown',
    previewUrl: v.preview_url ?? null,
    languages: [...languages],
    traits: [...words],
    useCase: labels.use_case ?? null,
  }
}

