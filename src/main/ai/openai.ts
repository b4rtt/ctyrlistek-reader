/**
 * Page analysis with the OpenAI Responses API (vision + structured outputs).
 */
import OpenAI from 'openai'
import type {
  AiCharacter,
  AiLine,
  AiPanel,
  AnalyzePageRequest,
  AnalyzePageResult,
  ConsolidateRequest,
  ConsolidateResult,
  TestResult,
} from '@shared/api'
import { ERROR_CODES } from '@shared/api'
import { boxToRect } from '@shared/geometry'
import type { AgeGroup, Confidence, Delivery, Emotion, Gender, Intensity, LineKind, PageKind } from '@shared/types'
import { getSecret, getSettings } from '../settings'
import {
  CONSOLIDATE_SCHEMA,
  CONSOLIDATE_SYSTEM_PROMPT,
  PAGE_SCHEMA,
  PAGE_SYSTEM_PROMPT,
  consolidateUserText,
  pageUserText,
} from './prompts'

let client: OpenAI | null = null
let clientKey: string | null = null

function getClient(): OpenAI {
  const key = getSecret('openai')
  if (!key) throw new Error(`${ERROR_CODES.NO_OPENAI_KEY}: Chybí OpenAI API klíč – doplňte ho v Nastavení.`)
  if (!client || clientKey !== key) {
    client = new OpenAI({ apiKey: key, maxRetries: 4, timeout: 8 * 60 * 1000 })
    clientKey = key
  }
  return client
}

/** Translate SDK errors into user-facing Czech messages with a stable code prefix. */
export function describeOpenAIError(err: unknown): Error {
  if (err instanceof OpenAI.AuthenticationError || err instanceof OpenAI.PermissionDeniedError) {
    return new Error(`${ERROR_CODES.AUTH}: OpenAI odmítlo klíč (${err.status}). Zkontrolujte API klíč v Nastavení.`)
  }
  if (err instanceof OpenAI.RateLimitError) {
    const quota = /quota|billing|credit/i.test(err.message)
    return new Error(
      quota
        ? `${ERROR_CODES.QUOTA}: Na OpenAI účtu došel kredit. Doplňte ho na platform.openai.com.`
        : `${ERROR_CODES.RATE_LIMIT}: OpenAI hlásí příliš mnoho požadavků – zkuste to za chvíli, nebo snižte paralelní analýzu.`,
    )
  }
  if (err instanceof OpenAI.NotFoundError) {
    return new Error(`Model ${getSettings().openaiModel} není pro tento klíč dostupný. Vyberte jiný model v Nastavení.`)
  }
  if (err instanceof OpenAI.BadRequestError) {
    return new Error(`OpenAI požadavek odmítlo: ${err.message}`)
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return new Error(`${ERROR_CODES.NETWORK}: Nepodařilo se spojit s OpenAI. Jste připojeni k internetu?`)
  }
  if (err instanceof OpenAI.APIError) {
    return new Error(`OpenAI chyba ${err.status ?? ''}: ${err.message}`)
  }
  return err instanceof Error ? err : new Error(String(err))
}

const dataUrl = (bytes: Uint8Array): string => `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`

interface StructuredCall {
  instructions: string
  content: OpenAI.Responses.ResponseInputContent[]
  schemaName: string
  schema: Record<string, unknown>
  maxOutputTokens: number
}

async function structured<T>(call: StructuredCall): Promise<{ data: T; usage: { inputTokens: number; outputTokens: number }; model: string }> {
  const settings = getSettings()
  const openai = getClient()
  let maxOutputTokens = call.maxOutputTokens
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: OpenAI.Responses.Response
    try {
      response = await openai.responses.create({
        model: settings.openaiModel,
        reasoning: { effort: settings.openaiEffort },
        instructions: call.instructions,
        input: [{ role: 'user', content: call.content }],
        text: { format: { type: 'json_schema', name: call.schemaName, strict: true, schema: call.schema } },
        max_output_tokens: maxOutputTokens,
        store: false,
      })
    } catch (err) {
      throw describeOpenAIError(err)
    }

    if (response.status === 'incomplete' && response.incomplete_details?.reason === 'max_output_tokens' && attempt === 0) {
      maxOutputTokens *= 2
      continue
    }
    const refusal = response.output
      .flatMap((item) => (item.type === 'message' ? item.content : []))
      .find((c) => c.type === 'refusal')
    if (refusal && refusal.type === 'refusal') throw new Error(`AI odmítla stránku zpracovat: ${refusal.refusal}`)
    const text = response.output_text
    if (!text) throw new Error(`AI nevrátila žádná data (stav: ${response.status ?? 'neznámý'}).`)
    return {
      data: JSON.parse(text) as T,
      usage: { inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 },
      model: response.model,
    }
  }
  throw new Error('AI odpověď byla příliš dlouhá – zkuste stránku analyzovat znovu.')
}

// ------------------------------------------------------------ page analysis --

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

interface RawPage {
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

export function convertPage(raw: RawPage, width: number, height: number): Omit<AnalyzePageResult, 'usage' | 'model'> {
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

export async function analyzePageOpenAI(req: AnalyzePageRequest): Promise<AnalyzePageResult> {
  const content: OpenAI.Responses.ResponseInputContent[] = [
    { type: 'input_text', text: pageUserText(req) },
    { type: 'input_text', text: 'IMAGE 1 (clean page):' },
    { type: 'input_image', image_url: dataUrl(req.image.data), detail: 'high' },
  ]
  if (req.overlay) {
    content.push(
      { type: 'input_text', text: 'IMAGE 2 (candidate panels outlined and labelled):' },
      { type: 'input_image', image_url: dataUrl(req.overlay.data), detail: 'low' },
    )
  }
  const { data, usage, model } = await structured<RawPage>({
    instructions: PAGE_SYSTEM_PROMPT,
    content,
    schemaName: 'comic_page',
    schema: PAGE_SCHEMA as unknown as Record<string, unknown>,
    maxOutputTokens: 32000,
  })
  return { ...convertPage(data, req.image.width, req.image.height), usage, model }
}

// -------------------------------------------------------------- consolidate --

interface RawConsolidate {
  merges: { into: string; from: string[] }[]
  updates: {
    id: string
    name: string
    name_confidence: Confidence
    gender: Gender
    gender_confidence: Confidence
    age: AgeGroup
  }[]
}

export async function consolidateOpenAI(req: ConsolidateRequest): Promise<ConsolidateResult> {
  const content: OpenAI.Responses.ResponseInputContent[] = [{ type: 'input_text', text: consolidateUserText(req) }]
  for (const c of req.characters) {
    if (!c.thumb) continue
    content.push(
      { type: 'input_text', text: `Portrait of id "${c.id}":` },
      { type: 'input_image', image_url: dataUrl(c.thumb.data), detail: 'low' },
    )
  }
  const { data, usage } = await structured<RawConsolidate>({
    instructions: CONSOLIDATE_SYSTEM_PROMPT,
    content,
    schemaName: 'cast_review',
    schema: CONSOLIDATE_SCHEMA as unknown as Record<string, unknown>,
    maxOutputTokens: 16000,
  })
  const ids = new Set(req.characters.map((c) => c.id))
  const main = new Set(req.characters.filter((c) => c.isMain).map((c) => c.id))
  return {
    merges: data.merges
      .filter((m) => ids.has(m.into) && m.into !== 'narrator')
      .map((m) => ({ into: m.into, from: m.from.filter((id) => ids.has(id) && !main.has(id) && id !== m.into) }))
      .filter((m) => m.from.length > 0),
    updates: data.updates
      .filter((u) => ids.has(u.id) && !main.has(u.id))
      .map((u) => ({
        id: u.id,
        name: u.name,
        nameConfidence: u.name_confidence,
        gender: u.gender,
        genderConfidence: u.gender_confidence,
        age: u.age,
      })),
    usage,
  }
}

export async function testOpenAI(): Promise<TestResult> {
  try {
    const model = getSettings().openaiModel
    await getClient().models.retrieve(model)
    return { ok: true, message: `Klíč funguje, model ${model} je dostupný.` }
  } catch (err) {
    return { ok: false, message: describeOpenAIError(err).message }
  }
}
