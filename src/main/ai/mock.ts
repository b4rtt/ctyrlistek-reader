/**
 * Deterministic fake analysis used when `CTYRLISTEK_MOCK_AI=1`.
 *
 * It lets developers (and the end-to-end tests) exercise the whole app –
 * import, review, voice generation and playback – without an OpenAI key.
 * Panels come from the local detector; lines are invented.
 */
import type {
  AiCharacter,
  AiLine,
  AiPanel,
  AnalyzePageRequest,
  AnalyzePageResult,
  ConsolidateRequest,
  ConsolidateResult,
} from '@shared/api'
import type { Delivery, Emotion, Intensity } from '@shared/types'

const SCRIPT: { speaker: string; text: string; emotion: Emotion; intensity: Intensity; delivery: Delivery }[] = [
  { speaker: 'myspulin', text: 'Mám nápad! Postavíme létající kolo.', emotion: 'excited', intensity: 2, delivery: 'normal' },
  { speaker: 'bobik', text: 'Létající kolo? A bude mít košík na buchty?', emotion: 'curious', intensity: 2, delivery: 'normal' },
  { speaker: 'pinda', text: 'Já se bojím výšek… nemůžeme radši jet po zemi?', emotion: 'scared', intensity: 2, delivery: 'normal' },
  { speaker: 'fifinka', text: 'Neboj, Pinďo. Budeme opatrní.', emotion: 'calm', intensity: 1, delivery: 'normal' },
  { speaker: 'new_soused', text: 'Co to tady zase vyvádíte?!', emotion: 'angry', intensity: 3, delivery: 'shout' },
  { speaker: 'bobik', text: 'Pst, soused se zlobí.', emotion: 'worried', intensity: 1, delivery: 'whisper' },
  { speaker: 'myspulin', text: 'Tři, dva, jedna… start!', emotion: 'excited', intensity: 3, delivery: 'loud' },
  { speaker: 'pinda', text: 'Hurá, letíme! To je nádhera!', emotion: 'happy', intensity: 3, delivery: 'loud' },
]

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function analyzePageMock(req: AnalyzePageRequest): Promise<AnalyzePageResult> {
  await sleep(250 + Math.random() * 400)
  const ordered = [...req.candidates].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
  const panels: { label: string | null; rect: AiPanel['rect'] }[] = ordered.length
    ? ordered
    : [{ label: null, rect: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 } }]
  let cursor = req.pageIndex * 3
  const used = new Set<string>()

  const resultPanels: AiPanel[] = panels.map((p, pi) => {
    const count = pi === 0 && req.pageIndex === 0 ? 2 : 1 + ((pi + req.pageIndex) % 2)
    const lines: AiLine[] = Array.from({ length: count }, (_, li): AiLine => {
      const s = SCRIPT[cursor++ % SCRIPT.length]
      used.add(s.speaker)
      const bw = Math.min(0.3, p.rect.w * 0.6)
      const bh = Math.min(0.08, p.rect.h * 0.3)
      return {
        kind: 'speech',
        speaker: s.speaker,
        textOriginal: s.text.toUpperCase(),
        textSpoken: s.text,
        emotion: s.emotion,
        intensity: s.intensity,
        delivery: s.delivery,
        direction: 'mock line',
        bubble: {
          x: p.rect.x + (li % 2 ? p.rect.w - bw - 0.01 : 0.01),
          y: p.rect.y + 0.01 + li * (bh + 0.01),
          w: bw,
          h: bh,
        },
        sfxPrompt: null,
      }
    })
    if (pi === 0 && req.pageIndex === 0) {
      lines.unshift({
        kind: 'narration',
        speaker: 'narrator',
        textOriginal: 'JEDNOHO RÁNA V TRAMTÁRII…',
        textSpoken: 'Jednoho rána v Tramtárii…',
        emotion: 'calm',
        intensity: 1,
        delivery: 'normal',
        direction: 'warm storyteller',
        bubble: null,
        sfxPrompt: null,
      })
    }
    return { label: p.label, rect: p.rect, lines }
  })

  const characters: AiCharacter[] = [...used]
    .filter((k) => k !== 'narrator')
    .map((key): AiCharacter =>
      key === 'new_soused'
        ? {
            key,
            isNew: true,
            name: 'Rozzlobený soused',
            nameConfidence: 'low',
            nameEvidence: 'no name visible',
            gender: 'unknown',
            genderConfidence: 'low',
            age: 'adult',
            look: 'postava v klobouku',
            voiceTraits: ['gruff', 'bossy'],
            face: null,
          }
        : {
            key,
            isNew: false,
            name: req.roster.find((r) => r.id === key)?.name ?? key,
            nameConfidence: 'high',
            nameEvidence: 'roster',
            gender: req.roster.find((r) => r.id === key)?.gender ?? 'unknown',
            genderConfidence: 'high',
            age: 'adult',
            look: '',
            voiceTraits: [],
            face: null,
          },
    )

  return {
    pageKind: 'comic',
    panels: resultPanels,
    characters,
    notes: 'mock analysis',
    usage: { inputTokens: 0, outputTokens: 0 },
    model: 'mock',
  }
}

export async function consolidateMock(_req: ConsolidateRequest): Promise<ConsolidateResult> {
  await sleep(200)
  return { merges: [], updates: [], usage: { inputTokens: 0, outputTokens: 0 } }
}
