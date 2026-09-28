/**
 * Integration tests of the real OpenAI SDK / ElevenLabs HTTP code against a
 * local fake server: verifies the exact request payloads we send and that we
 * parse the responses correctly – without API keys or costs.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), isPackaged: false },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
  shell: {},
}))

interface Captured {
  method: string
  url: string
  headers: IncomingMessage['headers']
  body: string
}

type Handler = (req: Captured, res: ServerResponse) => void

let server: Server
let base = ''
const captured: Captured[] = []
let handler: Handler = (_req, res) => res.end()

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const c = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body }
      captured.push(c)
      handler(c, res)
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.CTYRLISTEK_DATA_DIR = mkdtempSync(join(tmpdir(), 'ctyrlistek-it-'))
  process.env.OPENAI_API_KEY = 'sk-test'
  process.env.OPENAI_BASE_URL = `${base}/v1`
  process.env.ELEVENLABS_API_KEY = 'xi-test'
  process.env.ELEVENLABS_BASE_URL = base
})

afterAll(() => server.close())
beforeEach(() => {
  captured.length = 0
})

const json = (res: ServerResponse, status: number, data: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

// ------------------------------------------------------------------ OpenAI --

const rawPage = {
  page_kind: 'comic',
  panels: [
    {
      label: 'P1',
      box: { x0: 0, y0: 0, x1: 500, y1: 700 },
      lines: [
        {
          kind: 'speech',
          speaker: 'new_hajny',
          text_original: 'STŮJTE!',
          text_spoken: 'Stůjte!',
          emotion: 'angry',
          intensity: 3,
          delivery: 'shout',
          direction: 'shouts at the kids',
          bubble_box: { x0: 50, y0: 50, x1: 250, y1: 150 },
          sfx_prompt: null,
        },
      ],
    },
  ],
  characters: [
    {
      key: 'new_hajny',
      is_new: true,
      name: 'Hajný',
      name_confidence: 'medium',
      name_evidence: 'uniform',
      gender: 'male',
      gender_confidence: 'high',
      age: 'adult',
      look: 'muž v zelené uniformě',
      voice_traits: ['gruff'],
      face_box: null,
    },
  ],
  notes: '',
}

function responsesReply(text: string): unknown {
  return {
    id: 'resp_1',
    object: 'response',
    created_at: 1,
    status: 'completed',
    model: 'gpt-6-sol',
    output: [
      {
        type: 'message',
        id: 'msg_1',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text, annotations: [] }],
      },
    ],
    usage: { input_tokens: 1200, output_tokens: 300, total_tokens: 1500 },
  }
}

describe('OpenAI page analysis', () => {
  it('sends a strict json_schema request with both images and parses the result', async () => {
    handler = (req, res) => json(res, 200, responsesReply(JSON.stringify(rawPage)))
    const { analyzePageOpenAI } = await import('../../src/main/ai/openai')
    const result = await analyzePageOpenAI({
      comicId: 'x',
      title: 'Test',
      pageIndex: 0,
      pageCount: 1,
      image: { data: new Uint8Array([1, 2, 3]), width: 1000, height: 1400 },
      overlay: { data: new Uint8Array([4]), width: 500, height: 700 },
      candidates: [{ label: 'P1', rect: { x: 0, y: 0, w: 0.5, h: 0.5 } }],
      roster: [{ id: 'bobik', name: 'Bobík', gender: 'male', age: 'adult', description: 'prasátko' }],
    })

    const req = captured.find((c) => c.url.endsWith('/v1/responses'))!
    expect(req.method).toBe('POST')
    expect(req.headers.authorization).toBe('Bearer sk-test')
    const body = JSON.parse(req.body)
    expect(body.model).toBe('gpt-6-sol')
    expect(body.reasoning).toEqual({ effort: 'medium' })
    expect(body.store).toBe(false)
    expect(body.text.format).toMatchObject({ type: 'json_schema', name: 'comic_page', strict: true })
    const images = body.input[0].content.filter((c: { type: string }) => c.type === 'input_image')
    expect(images).toHaveLength(2)
    expect(images[0].image_url).toMatch(/^data:image\/jpeg;base64,/)
    expect(images[0].detail).toBe('high')
    expect(body.instructions).toContain('Čtyřlístek')

    expect(result.usage).toEqual({ inputTokens: 1200, outputTokens: 300 })
    expect(result.panels[0].rect).toEqual({ x: 0, y: 0, w: 0.5, h: 0.5 })
    expect(result.panels[0].lines[0]).toMatchObject({
      emotion: 'angry',
      delivery: 'shout',
      textSpoken: 'Stůjte!',
    })
    expect(result.characters[0]).toMatchObject({ key: 'new_hajny', name: 'Hajný', gender: 'male' })
  })

  it('maps authentication errors to a friendly message', async () => {
    handler = (_req, res) =>
      json(res, 401, { error: { message: 'Incorrect API key', type: 'invalid_request_error' } })
    const { analyzePageOpenAI } = await import('../../src/main/ai/openai')
    await expect(
      analyzePageOpenAI({
        comicId: 'x',
        title: 'T',
        pageIndex: 0,
        pageCount: 1,
        image: { data: new Uint8Array([1]), width: 10, height: 10 },
        overlay: null,
        candidates: [],
        roster: [],
      }),
    ).rejects.toThrow(/^AUTH: /)
  })
})

// -------------------------------------------------------------- ElevenLabs --

describe('ElevenLabs', () => {
  it('pages through the voice list', async () => {
    handler = (req, res) => {
      const second = req.url.includes('next_page_token=p2')
      json(res, 200, {
        voices: [
          {
            voice_id: second ? 'v2' : 'v1',
            name: second ? 'Jana' : 'Pavel',
            category: 'premade',
            labels: { gender: second ? 'female' : 'male' },
            verified_languages: second ? [{ language: 'cs' }] : [],
          },
        ],
        has_more: !second,
        next_page_token: second ? null : 'p2',
      })
    }
    const { listVoices } = await import('../../src/main/tts/elevenlabs')
    const voices = await listVoices(true)
    expect(voices.map((v) => v.id)).toEqual(['v1', 'v2'])
    expect(voices[1].languages).toContain('cs')
    expect(captured[0].headers['xi-api-key']).toBe('xi-test')
    expect(captured[0].url).toContain('/v2/voices?page_size=100')
  })

  it('synthesizes with v3 audio tags, language code and word timings', async () => {
    const { buildElevenText } = await import('../../src/shared/performance')
    handler = (req, res) => {
      const body = JSON.parse(req.body)
      const chars = [...body.text]
      json(res, 200, {
        audio_base64: Buffer.alloc(16000).toString('base64'), // 1 s at 128 kbps
        alignment: {
          characters: chars,
          character_start_times_seconds: chars.map((_, i) => i * 0.02),
          character_end_times_seconds: chars.map((_, i) => i * 0.02 + 0.02),
        },
      })
    }
    const { synthesizeLine } = await import('../../src/main/tts/audio')
    const req = {
      comicId: null,
      provider: 'elevenlabs' as const,
      kind: 'speech' as const,
      text: 'Co to tady vyvádíte?!',
      emotion: 'angry' as const,
      intensity: 3 as const,
      delivery: 'shout' as const,
      voice: { elevenVoiceId: 'voice123', systemVoice: null, pitch: 0, rate: 1 },
    }
    const ref = await synthesizeLine(req)
    const call = captured.find((c) => c.url.startsWith('/v1/text-to-speech/voice123/with-timestamps'))!
    const body = JSON.parse(call.body)
    const expected = buildElevenText(req.text, req, 'eleven_v3')
    expect(body.text).toBe(expected.text)
    expect(body.text.startsWith('[shouting] [angry] ')).toBe(true)
    expect(body.model_id).toBe('eleven_v3')
    expect(body.language_code).toBe('cs')
    expect(body.voice_settings.stability).toBe(0.5)
    expect(call.url).toContain('output_format=mp3_44100_128')
    expect(ref!.durationMs).toBe(1000)
    expect(ref!.words).toHaveLength(4)
    expect(ref!.words![0].t0).toBeCloseTo(expected.offset * 0.02)

    // Second call is served from the disk cache.
    captured.length = 0
    const again = await synthesizeLine(req)
    expect(again!.key).toBe(ref!.key)
    expect(captured).toHaveLength(0)
  })

  it('falls back to the plain endpoint when timestamps are unavailable', async () => {
    handler = (req, res) => {
      if (req.url.includes('/with-timestamps'))
        return json(res, 422, { detail: { message: 'not supported' } })
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' })
      res.end(Buffer.alloc(8000))
    }
    const { synthesize } = await import('../../src/main/tts/elevenlabs')
    const params = {
      voiceId: 'v',
      text: 'Ahoj',
      modelId: 'eleven_test_model',
      voiceSettings: {},
      languageCode: null,
    }
    const res = await synthesize(params)
    expect(res.audio.length).toBe(8000)
    expect(res.alignment).toBeNull()
    captured.length = 0
    await synthesize(params)
    expect(captured.map((c) => c.url.includes('with-timestamps'))).toEqual([false])
  })

  it('reports an invalid key clearly', async () => {
    handler = (_req, res) => json(res, 401, { detail: { status: 'invalid_api_key' } })
    const { quota } = await import('../../src/main/tts/elevenlabs')
    await expect(quota()).rejects.toThrow(/^AUTH: /)
  })

  it('generates sound effects', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' })
      res.end(Buffer.alloc(4000))
    }
    const { soundEffect } = await import('../../src/main/tts/elevenlabs')
    const audio = await soundEffect('cartoon explosion boom', 1.2)
    expect(audio.length).toBe(4000)
    const body = JSON.parse(captured[0].body)
    expect(captured[0].url).toContain('/v1/sound-generation')
    expect(body).toMatchObject({ text: 'cartoon explosion boom', duration_seconds: 1.2 })
  })
})
