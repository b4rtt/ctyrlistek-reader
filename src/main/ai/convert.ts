/** Conversion of the raw (schema-shaped) AI answer into app types. Pure – unit tested. */
import type { AiCharacter, AiLine, AiPanel, AnalyzePageResult } from '@shared/api'
import { boxToRect } from '@shared/geometry'
import type {
  AgeGroup,
  Confidence,
  Delivery,
  Emotion,
  Gender,
  Intensity,
  LineKind,
  PageKind,
} from '@shared/types'

type Box = { x0: number; y0: number; x1: number; y1: number }

interface RawLine {
  kind: LineKind
  speaker: string
  text_original: string
  text_spoken: string
  emotion: Emotion
  intensity: Intensity
  delivery: Delivery
  direction: string
  bubble_box: Box | null
  sfx_prompt: string | null
}

export interface RawPage {
  page_kind: PageKind
  panels: { label: string | null; box: Box; lines: RawLine[] }[]
  characters: {
    key: string
    is_new: boolean
    name: string
    name_confidence: Confidence
    name_evidence: string
    gender: Gender
    gender_confidence: Confidence
    age: AgeGroup
    look: string
    voice_traits: string[]
    face_box: Box | null
  }[]
  notes: string
}

export function convertPage(
  raw: RawPage,
  width: number,
  height: number,
): Omit<AnalyzePageResult, 'usage' | 'model'> {
  const panels: AiPanel[] = []
  for (const p of raw.panels) {
    const rect = boxToRect(p.box, width, height)
    if (!rect) continue
    const lines: AiLine[] = p.lines.map((l) => ({
      kind: l.kind,
      speaker: l.speaker,
      textOriginal: l.text_original,
      textSpoken: l.text_spoken,
      emotion: l.emotion,
      intensity: l.intensity,
      delivery: l.delivery,
      direction: l.direction,
      bubble: l.bubble_box ? boxToRect(l.bubble_box, width, height) : null,
      sfxPrompt: l.sfx_prompt,
    }))
    panels.push({ label: p.label, rect, lines })
  }
  const characters: AiCharacter[] = raw.characters.map((c) => ({
    key: c.key,
    isNew: c.is_new,
    name: c.name,
    nameConfidence: c.name_confidence,
    nameEvidence: c.name_evidence,
    gender: c.gender,
    genderConfidence: c.gender_confidence,
    age: c.age,
    look: c.look,
    voiceTraits: c.voice_traits,
    face: c.face_box ? boxToRect(c.face_box, width, height) : null,
  }))
  return { pageKind: raw.page_kind, panels, characters, notes: raw.notes }
}
