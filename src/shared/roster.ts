/**
 * Merging per-page AI results into the comic document: stable character ids
 * across pages, panel/line construction and review flags.
 */
import type { AiCharacter, AnalyzePageResult, ConsolidateResult, RosterEntry } from './api'
import { CHARACTER_COLORS, NARRATOR_ID, defaultVoice } from './defaults'
import { area, iou } from './geometry'
import type { Character, ComicDoc, Line, Panel, Rect } from './types'

export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function slugify(name: string): string {
  return normalizeName(name).replace(/ /g, '-').slice(0, 32) || 'postava'
}

export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

/** Characters the user should look at: uncertain name or gender. */
export function needsReview(ch: Character): boolean {
  if (ch.confirmed || ch.isNarrator || ch.lineCount === 0) return false
  return ch.nameConfidence === 'low' || ch.gender === 'unknown' || ch.genderConfidence === 'low'
}

export function toRosterEntries(characters: Character[]): RosterEntry[] {
  return characters.map((c) => ({
    id: c.id,
    name: c.name,
    gender: c.gender,
    age: c.age,
    description: c.description,
  }))
}

function uniqueId(base: string, taken: Set<string>): string {
  let id = base
  let n = 2
  while (taken.has(id)) id = `${base}-${n++}`
  return id
}

function newCharacter(ai: AiCharacter, id: string, colorIndex: number, page: number): Character {
  return {
    id,
    name: ai.name.trim() || 'Neznámá postava',
    nameConfidence: ai.nameConfidence,
    gender: ai.gender,
    genderConfidence: ai.gender === 'unknown' ? 'low' : ai.genderConfidence,
    age: ai.age,
    description: ai.look,
    voiceTraits: ai.voiceTraits.slice(0, 6),
    isNarrator: false,
    isMain: false,
    thumb: ai.face ? { page, rect: ai.face } : null,
    lineCount: 0,
    confirmed: false,
    voice: defaultVoice(),
    color: CHARACTER_COLORS[colorIndex % CHARACTER_COLORS.length],
  }
}

const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 } as const

/** Update an existing character with (possibly better) knowledge from a page. */
function improveCharacter(ch: Character, ai: AiCharacter, page: number): Character {
  const next = { ...ch }
  if (!ch.confirmed && !ch.isMain) {
    if (CONFIDENCE_RANK[ai.nameConfidence] > CONFIDENCE_RANK[ch.nameConfidence] && ai.name.trim()) {
      next.name = ai.name.trim()
      next.nameConfidence = ai.nameConfidence
    }
    if (ai.gender !== 'unknown' && (ch.gender === 'unknown' || CONFIDENCE_RANK[ai.genderConfidence] > CONFIDENCE_RANK[ch.genderConfidence])) {
      next.gender = ai.gender
      next.genderConfidence = ai.genderConfidence
    }
    if (ch.age === 'unknown' && ai.age !== 'unknown') next.age = ai.age
    if (!ch.description && ai.look) next.description = ai.look
    if (ch.voiceTraits.length === 0) next.voiceTraits = ai.voiceTraits.slice(0, 6)
  }
  if (ai.face && (!ch.thumb || area(ai.face) > area(ch.thumb.rect) * 1.2)) {
    next.thumb = { page, rect: ai.face }
  }
  return next
}

/**
 * Resolve the AI's character keys for one page to document character ids,
 * creating new characters where needed. Mutates `doc.characters`.
 */
export function resolveCharacters(doc: ComicDoc, pageIndex: number, result: AnalyzePageResult): Map<string, string> {
  const map = new Map<string, string>()
  const byId = new Map(doc.characters.map((c) => [c.id, c]))
  const byName = new Map(doc.characters.map((c) => [normalizeName(c.name), c]))
  const taken = new Set(doc.characters.map((c) => c.id))

  for (const ai of result.characters) {
    let target = byId.get(ai.key)
    if (!target && ai.name.trim()) {
      const candidate = byName.get(normalizeName(ai.name))
      // Only merge by name when the name is a real name, not a description.
      if (candidate && (candidate.nameConfidence !== 'low' || ai.nameConfidence !== 'low')) target = candidate
    }
    if (target) {
      const updated = improveCharacter(target, ai, pageIndex)
      doc.characters = doc.characters.map((c) => (c.id === target!.id ? updated : c))
      byId.set(updated.id, updated)
      map.set(ai.key, updated.id)
      continue
    }
    const id = uniqueId(slugify(ai.name || ai.key), taken)
    taken.add(id)
    const ch = newCharacter(ai, id, doc.characters.length, pageIndex)
    doc.characters = [...doc.characters, ch]
    byId.set(id, ch)
    byName.set(normalizeName(ch.name), ch)
    map.set(ai.key, id)
  }
  map.set(NARRATOR_ID, NARRATOR_ID)
  return map
}

/** Pick the panel rectangle: the locally detected one when the AI confirmed it. */
export function choosePanelRect(aiRect: Rect, label: string | null, candidates: { label: string; rect: Rect }[]): Rect {
  const byLabel = label ? candidates.find((c) => c.label === label) : undefined
  if (byLabel && iou(byLabel.rect, aiRect) > 0.3) return byLabel.rect
  // The AI may have mislabelled – snap to the best overlapping candidate.
  let best: Rect | null = null
  let bestIou = 0.55
  for (const c of candidates) {
    const v = iou(c.rect, aiRect)
    if (v > bestIou) {
      bestIou = v
      best = c.rect
    }
  }
  return best ?? byLabel?.rect ?? aiRect
}

export interface ApplyOptions {
  candidates: { label: string; rect: Rect }[]
  /** Optional precise bubble refinement (local image analysis). */
  refineBubble?: (approx: Rect) => Rect
}

/** Write one page's AI result into the document. Mutates and returns `doc`. */
export function applyPageResult(doc: ComicDoc, pageIndex: number, result: AnalyzePageResult, opts: ApplyOptions): ComicDoc {
  const idMap = resolveCharacters(doc, pageIndex, result)
  const unknownFallback = (): string => {
    const existing = doc.characters.find((c) => c.id === 'neznamy')
    if (existing) return existing.id
    doc.characters = [
      ...doc.characters,
      {
        ...newCharacter(
          {
            key: 'neznamy',
            isNew: true,
            name: 'Neznámá postava',
            nameConfidence: 'low',
            nameEvidence: '',
            gender: 'unknown',
            genderConfidence: 'low',
            age: 'unknown',
            look: '',
            voiceTraits: [],
            face: null,
          },
          'neznamy',
          doc.characters.length,
          pageIndex,
        ),
      },
    ]
    return 'neznamy'
  }

  const panels: Panel[] = result.panels.map((p, pi) => {
    const rect = choosePanelRect(p.rect, p.label, opts.candidates)
    const lines: Line[] = p.lines
      .filter((l) => l.textSpoken.trim() || l.kind === 'sfx')
      .map((l, li) => {
        let speakerId: string | null = null
        if (l.kind === 'narration') speakerId = NARRATOR_ID
        else if (l.kind !== 'sfx') speakerId = idMap.get(l.speaker) ?? (doc.characters.some((c) => c.id === l.speaker) ? l.speaker : unknownFallback())
        const bubble = l.bubble && opts.refineBubble ? opts.refineBubble(l.bubble) : l.bubble
        return {
          id: `p${pageIndex}-${pi}-${li}-${Math.random().toString(36).slice(2, 7)}`,
          kind: l.kind,
          speakerId,
          text: l.textSpoken.trim(),
          originalText: l.textOriginal.trim(),
          emotion: l.emotion,
          intensity: l.intensity,
          delivery: l.delivery,
          direction: l.direction,
          bubble,
          sfxPrompt: l.kind === 'sfx' ? l.sfxPrompt || l.textOriginal : null,
          audio: null,
        }
      })
    return { id: `p${pageIndex}-${pi}`, rect, lines }
  })

  doc.pages = doc.pages.map((pg) =>
    pg.index === pageIndex
      ? {
          ...pg,
          kind: result.pageKind,
          status: 'done',
          error: null,
          panels,
          skip: result.pageKind === 'text' || result.pageKind === 'other' ? pg.skip || panels.every((p) => p.lines.length === 0) : pg.skip,
        }
      : pg,
  )
  recountLines(doc)
  return doc
}

export function recountLines(doc: ComicDoc): void {
  const counts = new Map<string, number>()
  for (const pg of doc.pages)
    for (const p of pg.panels)
      for (const l of p.lines) if (l.speakerId) counts.set(l.speakerId, (counts.get(l.speakerId) ?? 0) + 1)
  doc.characters = doc.characters.map((c) => ({ ...c, lineCount: counts.get(c.id) ?? 0 }))
}

/** Move all lines of `from` characters to `into` and drop the merged ones. */
export function mergeCharacters(doc: ComicDoc, into: string, from: string[]): ComicDoc {
  const drop = new Set(from.filter((id) => id !== into && id !== NARRATOR_ID))
  if (drop.size === 0 || !doc.characters.some((c) => c.id === into)) return doc
  const target = doc.characters.find((c) => c.id === into)!
  let thumb = target.thumb
  for (const c of doc.characters) {
    if (drop.has(c.id) && c.thumb && (!thumb || area(c.thumb.rect) > area(thumb.rect))) thumb = c.thumb
  }
  doc.pages = doc.pages.map((pg) => ({
    ...pg,
    panels: pg.panels.map((p) => ({
      ...p,
      lines: p.lines.map((l) => (l.speakerId && drop.has(l.speakerId) ? { ...l, speakerId: into, audio: null } : l)),
    })),
  }))
  doc.characters = doc.characters.filter((c) => !drop.has(c.id)).map((c) => (c.id === into ? { ...c, thumb } : c))
  recountLines(doc)
  return doc
}

/** Apply the AI consolidation pass (duplicate merging + better names). */
export function applyConsolidation(doc: ComicDoc, res: ConsolidateResult): ComicDoc {
  for (const m of res.merges) mergeCharacters(doc, m.into, m.from)
  doc.characters = doc.characters.map((c) => {
    const u = res.updates.find((x) => x.id === c.id)
    if (!u || c.confirmed || c.isMain) return c
    return {
      ...c,
      name: u.name.trim() || c.name,
      nameConfidence: u.nameConfidence,
      gender: u.gender,
      genderConfidence: u.gender === 'unknown' ? 'low' : u.genderConfidence,
      age: u.age === 'unknown' ? c.age : u.age,
    }
  })
  return doc
}

/** Drop auto-created characters that ended up with no lines (keeps heroes). */
export function pruneCharacters(doc: ComicDoc): ComicDoc {
  doc.characters = doc.characters.filter((c) => c.isMain || c.lineCount > 0)
  return doc
}
