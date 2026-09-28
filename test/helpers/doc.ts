import type { AiCharacter, AiLine, AnalyzePageResult } from '../../src/shared/api'
import { initialRoster } from '../../src/shared/defaults'
import type { ComicDoc, PageData } from '../../src/shared/types'

export function page(index: number, patch: Partial<PageData> = {}): PageData {
  return {
    index,
    image: `pages/p${index + 1}.jpg`,
    width: 1000,
    height: 1400,
    kind: 'comic',
    status: 'pending',
    error: null,
    candidates: [],
    panels: [],
    skip: false,
    ...patch,
  }
}

export function makeDoc(pages = 2): ComicDoc {
  return {
    schemaVersion: 1,
    meta: {
      id: 'test-0001',
      title: 'Test',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      pageCount: pages,
      stage: 'analyzing',
      cover: null,
      analysis: { model: null, inputTokens: 0, outputTokens: 0, finishedAt: null },
      lastBeat: null,
    },
    pages: Array.from({ length: pages }, (_, i) => page(i)),
    characters: initialRoster(),
  }
}

export function aiLine(speaker: string, text: string, patch: Partial<AiLine> = {}): AiLine {
  return {
    kind: 'speech',
    speaker,
    textOriginal: text.toUpperCase(),
    textSpoken: text,
    emotion: 'neutral',
    intensity: 1,
    delivery: 'normal',
    direction: '',
    bubble: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 },
    sfxPrompt: null,
    ...patch,
  }
}

export function aiChar(key: string, name: string, patch: Partial<AiCharacter> = {}): AiCharacter {
  return {
    key,
    isNew: key.startsWith('new_'),
    name,
    nameConfidence: 'high',
    nameEvidence: '',
    gender: 'male',
    genderConfidence: 'high',
    age: 'adult',
    look: '',
    voiceTraits: [],
    face: null,
    ...patch,
  }
}

export function result(panels: AnalyzePageResult['panels'], characters: AiCharacter[]): AnalyzePageResult {
  return {
    pageKind: 'comic',
    panels,
    characters,
    notes: '',
    usage: { inputTokens: 10, outputTokens: 5 },
    model: 'test',
  }
}
