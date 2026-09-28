/**
 * Prompts and JSON schemas for the OpenAI page analysis.
 *
 * Instructions are written in English (most reliable for the model); all
 * extracted text stays Czech.
 */
import { DELIVERIES, EMOTIONS } from '@shared/types'
import type { AnalyzePageRequest, ConsolidateRequest, VerifyPageRequest } from '@shared/api'
import { rectToBox } from '@shared/geometry'

export const PAGE_SYSTEM_PROMPT = `You are an expert comic-book analyst. You prepare pages of the Czech children's comic "Čtyřlístek" for a fully voiced "motion comic": a player will zoom into each panel in order, highlight each balloon and play it with a different voice actor per character. A small child will watch it, so completeness and correct speaker attribution matter more than anything else.

You receive IMAGE 1 (the clean page) and usually IMAGE 2 (the same page with automatically detected candidate panels outlined and labelled P1, P2, …). All coordinates you return are integer pixel coordinates in IMAGE 1 (origin top-left, x0 < x1, y0 < y1).

PANELS
- Every framed drawing is its own panel – including very small or narrow ones (e.g. a single character squeezed at the start of a row). Never merge neighbouring panels, even when a balloon spans both.
- Return panels in natural reading order: rows from top to bottom, left to right within a row (follow the layout if it clearly guides the eye differently).
- If a panel matches a candidate, set "label" to that candidate (e.g. "P3") and use its box. The detector can be wrong (two panels merged, one panel split, panels missing): then set label null and give your own box around the panel frame.
- Every balloon, caption and sound effect belongs to exactly one panel: the panel of the speaker its tail points to (for captions/effects the panel they sit in), even when the balloon sticks out over the border into the gutter or a neighbouring panel.

LINES (balloons, captions, sound effects) – in reading order inside the panel
- The reading order carries the story, so get it right. Start with the balloon placed highest; balloons at about the same height go left to right; a speaker's chained balloons stay consecutive. Then check the result as a conversation: a question comes before its answer, a remark before the reaction to it. When the layout and the dialogue logic disagree, follow the dialogue logic.
- kind: "speech" (balloon with a tail), "thought" (cloud balloon / bubble trail), "narration" (rectangular caption without a tail, or a sign/label the story wants us to read), "sfx" (onomatopoeia drawn in the artwork such as BUM!, PRÁSK!, CRRR – not text inside balloons).
- Skip author credits ("Napsala…", "Nakreslil…", "Scénář…"), page numbers, logos, prices and publisher notes. The story title may be read once as narration.
- speaker: decide from the tail direction, who is present and the story logic. Use roster ids for known characters, "narrator" for narration, "" for sfx. A speaker missing from the roster gets a new key "new_<short-slug>" (same key for the same character everywhere on this page) and must be listed in "characters".
- text_original: exact transcription as printed, with Czech diacritics; line breaks become spaces.
- text_spoken: the same words prepared for a Czech voice actor – normal sentence capitalisation (the lettering is ALL CAPS), correct diacritics, hyphenated line breaks joined, punctuation (! ? … ,) kept because it drives intonation, abbreviations/numbers written as words when natural, grawlixes (#@!) replaced by a short mild Czech exclamation or dropped. Never translate, summarise, add or censor words. For sfx use the onomatopoeia in lower case.
- emotion / intensity / delivery: judge from the face and body language, balloon shape (jagged or bold outline = shout, dashed outline or tiny letters = whisper, big bold letters = loud), punctuation and the situation. intensity: 1 mild, 2 clear, 3 very strong.
- direction: a short English acting note for the voice actor (e.g. "shouts angrily at Bobík, out of breath").
- bubble_box: box around the WHOLE balloon or caption outline (including any part that sticks out of the panel, excluding the tail); for sfx around the lettering. Be precise – the player zooms to these boxes.
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
  const roster = req.roster.map((r) => ({
    id: r.id,
    name: r.name,
    gender: r.gender,
    age: r.age,
    look: r.description,
  }))
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

// ------------------------------------------------------------------ verify --

export const VERIFY_SYSTEM_PROMPT = `You proofread the reading script of one page of the Czech children's comic "Čtyřlístek" before it is voiced for a small child.

The image shows the page with every panel outlined and labelled (P1, P2, …) and every balloon, caption and sound effect outlined and numbered in the CURRENT reading order (1, 2, 3, …). The list gives the text and current speaker of each number.

Check and fix:
1. Speaker – follow each balloon's tail precisely to the character it points at (the tail tip touches or points at the speaker's mouth/head). Thought balloons: the bubble trail leads to the thinker. Use the cast ids; captions stay "narrator"; sound effects keep "".
2. Order inside each panel – a balloon placed higher is read first; balloons at a similar height go left to right; a speaker's chained balloons stay together. Then make sure the conversation makes sense (a question before its answer, a remark before the reaction). If layout and dialogue logic disagree, follow the logic.
3. Duplicates – set drop = true only for a line whose text was already read earlier on this page (e.g. the same sign shown in two panels) or that is not story text at all (credits, page number). Never drop real dialogue.

Keep every line in its panel. Return every panel with all of its line numbers exactly once. Summarise what you changed in "changes" (empty when nothing changed).`

export const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    panels: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          panel: { type: 'integer' },
          lines: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                n: { type: 'integer' },
                speaker: { type: 'string' },
                drop: { type: 'boolean' },
              },
              required: ['n', 'speaker', 'drop'],
              additionalProperties: false,
            },
          },
        },
        required: ['panel', 'lines'],
        additionalProperties: false,
      },
    },
    changes: { type: 'string' },
  },
  required: ['panels', 'changes'],
  additionalProperties: false,
} as const

export function verifyUserText(req: VerifyPageRequest): string {
  const cast = req.cast.map((c) => ({ id: c.id, name: c.name, gender: c.gender, look: c.description }))
  const lines = req.lines
    .map((l) => `${l.n}. [P${l.panel}] ${l.kind} – ${l.speaker || '(sfx)'}: ${l.text}`)
    .join('\n')
  return [
    `Comic: "${req.title}", page ${req.pageIndex + 1}.`,
    `Cast (use these ids): ${JSON.stringify(cast)}`,
    `Current script:\n${lines}`,
  ].join('\n\n')
}
