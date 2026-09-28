/**
 * Prompts and JSON schemas for the OpenAI page analysis.
 *
 * Instructions are written in English (most reliable for the model); all
 * extracted text stays Czech.
 */
import { DELIVERIES, EMOTIONS } from '@shared/types'
import type { AnalyzePageRequest, ConsolidateRequest } from '@shared/api'
import { rectToBox } from '@shared/geometry'

export const PAGE_SYSTEM_PROMPT = `You are an expert comic-book analyst. You prepare pages of the Czech children's comic "Čtyřlístek" for a fully voiced "motion comic": a player will zoom into each panel in order, highlight each balloon and play it with a different voice actor per character. A small child will watch it, so completeness and correct speaker attribution matter more than anything else.

You receive IMAGE 1 (the clean page) and usually IMAGE 2 (the same page with automatically detected candidate panels outlined and labelled P1, P2, …). All coordinates you return are integer pixel coordinates in IMAGE 1 (origin top-left, x0 < x1, y0 < y1).

PANELS
- Return panels in natural reading order (rows top to bottom, left to right within a row; follow the layout if it clearly guides the eye differently).
- If a panel matches a candidate, set "label" to that candidate (e.g. "P3") and use its box. The detector can be wrong (two panels merged, one panel split, panels missing): then set label null and give your own box.
- Every balloon, caption and sound effect must belong to exactly one panel. A title banner that should be read can be its own panel.

LINES (balloons, captions, sound effects) – in reading order inside the panel
- Order: top-to-bottom and left-to-right, but follow the conversation (a reply comes after its question; chained balloons of one speaker stay together).
- kind: "speech" (balloon with a tail), "thought" (cloud balloon / bubble trail), "narration" (rectangular caption without a tail), "sfx" (onomatopoeia drawn in the artwork such as BUM!, PRÁSK!, CRRR – not text inside balloons).
- speaker: decide from the tail direction, who is present and the story logic. Use roster ids for known characters, "narrator" for narration, "" for sfx. A speaker missing from the roster gets a new key "new_<short-slug>" (same key for the same character everywhere on this page) and must be listed in "characters".
- text_original: exact transcription as printed, with Czech diacritics; line breaks become spaces.
- text_spoken: the same words prepared for a Czech voice actor – normal sentence capitalisation (the lettering is ALL CAPS), correct diacritics, hyphenated line breaks joined, punctuation (! ? … ,) kept because it drives intonation, abbreviations/numbers written as words when natural, grawlixes (#@!) replaced by a short mild Czech exclamation or dropped. Never translate, summarise, add or censor words. For sfx use the onomatopoeia in lower case.
- emotion / intensity / delivery: judge from the face and body language, balloon shape (jagged or bold outline = shout, dashed outline or tiny letters = whisper, big bold letters = loud), punctuation and the situation. intensity: 1 mild, 2 clear, 3 very strong.
- direction: a short English acting note for the voice actor (e.g. "shouts angrily at Bobík, out of breath").
- bubble_box: tight box around the balloon or caption (for sfx around the lettering).
- sfx_prompt: for sfx a short English description for a sound-effect generator ("cartoon wooden crash with bouncing debris"); otherwise null.

CHARACTERS – everyone who speaks on this page
- The four heroes are Myšpulín (tomcat, inventor), Fifinka (female dog, the only girl), Bobík (pig, strongman) and Pinďa (hare, timid). Reuse roster ids for them and for any roster character; is_new = false.
- Names: use how others address the character (Czech vocative → nominative: "Bobíku" → Bobík, "Pinďo" → Pinďa, "Fifinko" → Fifinka, "Myšpulíne" → Myšpulín, "pane starosto" → starosta), captions, name tags or well-known recurring characters. Always output the nominative. If no name can be determined, give a short Czech descriptive label (e.g. "Vousatý námořník") with name_confidence "low". name_evidence: brief reason.
- gender: from Czech grammar first (past tense "byl jsem" = male, "byla jsem" = female; "sám/sama"; how others address them), then appearance. gender_confidence "low" when unsure, gender "unknown" when there is no clue at all.
- age: child / adult / elderly / unknown. look: short Czech visual description (species, clothes, colours). voice_traits: 2–5 English casting words (deep, squeaky, gruff, gentle, nervous, jolly, calm, bossy, elderly, sly, …).
- face_box: box around the character's head at its clearest appearance on this page, or null.

PAGE KIND
- "comic": story panels.
- "cover": a magazine/story cover – return one panel covering the page with a single narration line that reads the printed story title (ignore logos, prices, issue numbers).
- "text": text-only article, puzzle or letters page; "other": ads, blank pages. For "text" and "other" return no panels.

Be exhaustive – a missing balloon breaks the story for the child. Put short remarks about anything uncertain into "notes".`

const BOX = {
  type: 'object',
  properties: {
    x0: { type: 'integer' },
    y0: { type: 'integer' },
    x1: { type: 'integer' },
    y1: { type: 'integer' },
  },
  required: ['x0', 'y0', 'x1', 'y1'],
  additionalProperties: false,
} as const

const NULLABLE_BOX = { anyOf: [BOX, { type: 'null' }] } as const
const CONFIDENCE = { type: 'string', enum: ['high', 'medium', 'low'] } as const
const GENDER = { type: 'string', enum: ['male', 'female', 'unknown'] } as const
const AGE = { type: 'string', enum: ['child', 'adult', 'elderly', 'unknown'] } as const

export const PAGE_SCHEMA = {
  type: 'object',
  properties: {
    page_kind: { type: 'string', enum: ['comic', 'cover', 'text', 'other'] },
    panels: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: ['string', 'null'] },
          box: BOX,
          lines: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['speech', 'thought', 'narration', 'sfx'] },
                speaker: { type: 'string' },
                text_original: { type: 'string' },
                text_spoken: { type: 'string' },
                emotion: { type: 'string', enum: [...EMOTIONS] },
                intensity: { type: 'integer', enum: [1, 2, 3] },
                delivery: { type: 'string', enum: [...DELIVERIES] },
                direction: { type: 'string' },
                bubble_box: NULLABLE_BOX,
                sfx_prompt: { type: ['string', 'null'] },
              },
              required: [
                'kind',
                'speaker',
                'text_original',
                'text_spoken',
                'emotion',
                'intensity',
                'delivery',
                'direction',
                'bubble_box',
                'sfx_prompt',
              ],
              additionalProperties: false,
            },
          },
        },
        required: ['label', 'box', 'lines'],
        additionalProperties: false,
      },
    },
    characters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          is_new: { type: 'boolean' },
          name: { type: 'string' },
          name_confidence: CONFIDENCE,
          name_evidence: { type: 'string' },
          gender: GENDER,
          gender_confidence: CONFIDENCE,
          age: AGE,
          look: { type: 'string' },
          voice_traits: { type: 'array', items: { type: 'string' } },
          face_box: NULLABLE_BOX,
        },
        required: [
          'key',
          'is_new',
          'name',
          'name_confidence',
          'name_evidence',
          'gender',
          'gender_confidence',
          'age',
          'look',
          'voice_traits',
          'face_box',
        ],
        additionalProperties: false,
      },
    },
    notes: { type: 'string' },
  },
  required: ['page_kind', 'panels', 'characters', 'notes'],
  additionalProperties: false,
} as const

export function pageUserText(req: AnalyzePageRequest): string {
  const { width: w, height: h } = req.image
  const roster = req.roster.map((r) => ({ id: r.id, name: r.name, gender: r.gender, age: r.age, look: r.description }))
  const candidates = req.candidates.length
    ? req.candidates
        .map((c) => {
          const b = rectToBox(c.rect, w, h)
          return `${c.label}: [${b.x0}, ${b.y0}, ${b.x1}, ${b.y1}]`
        })
        .join('\n')
    : '(none detected – find the panels yourself)'
  return [
    `Comic: "${req.title}". This is page ${req.pageIndex + 1} of ${req.pageCount}.`,
    `IMAGE 1 is ${w}×${h} px. All boxes must use IMAGE 1 pixel coordinates.`,
    `Roster (reuse these ids): ${JSON.stringify(roster)}`,
    `Candidate panels [x0, y0, x1, y1]:\n${candidates}`,
  ].join('\n\n')
}

// -------------------------------------------------------------- consolidate --

export const CONSOLIDATE_SYSTEM_PROMPT = `You review the cast list that was extracted page by page from a Czech "Čtyřlístek" comic. Pages were analysed independently, so the same character may appear under several ids, and names or genders may be uncertain.

Tasks:
1. merges: groups of ids that are clearly the same character. "into" is the id to keep (prefer a hero/main id, otherwise the one with the best name). Never merge two different main heroes, never merge anything into or out of "narrator". Only merge when you are confident.
2. updates: for every non-main character, your best final name (Czech nominative; a proper name if any evidence exists – e.g. how others address them in the sample lines – otherwise a short descriptive Czech label), name_confidence, gender (use Czech grammar in their lines: "byl jsem" male, "byla jsem" female), gender_confidence and age. Keep existing values when you have nothing better.

Portraits (when provided) are labelled with the id they belong to.`

export const CONSOLIDATE_SCHEMA = {
  type: 'object',
  properties: {
    merges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          into: { type: 'string' },
          from: { type: 'array', items: { type: 'string' } },
        },
        required: ['into', 'from'],
        additionalProperties: false,
      },
    },
    updates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          name_confidence: CONFIDENCE,
          gender: GENDER,
          gender_confidence: CONFIDENCE,
          age: AGE,
        },
        required: ['id', 'name', 'name_confidence', 'gender', 'gender_confidence', 'age'],
        additionalProperties: false,
      },
    },
  },
  required: ['merges', 'updates'],
  additionalProperties: false,
} as const

export function consolidateUserText(req: ConsolidateRequest): string {
  const list = req.characters.map((c) => ({
    id: c.id,
    main: c.isMain,
    name: c.name,
    name_confidence: c.nameConfidence,
    gender: c.gender,
    gender_confidence: c.genderConfidence,
    age: c.age,
    look: c.description,
    sample_lines: c.sampleLines,
    lines_of_others_that_may_address_them: c.addressedAs,
  }))
  return `Comic: "${req.title}".\nCast:\n${JSON.stringify(list, null, 1)}`
}
