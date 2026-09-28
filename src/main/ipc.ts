/**
 * IPC handlers – the only entry points the renderer can reach. Channel names
 * mirror the `AppApi` shape (`library:list`, `voices:synthesize`, …).
 */
import { ipcMain } from 'electron'
import type {
  AnalyzePageRequest,
  ConsolidateRequest,
  SecretKind,
  Settings,
  SfxRequest,
  SynthesizeRequest,
} from '@shared/api'
import type { ComicDoc } from '@shared/types'
import { analyzePageMock, consolidateMock } from './ai/mock'
import { analyzePageOpenAI, consolidateOpenAI, testOpenAI } from './ai/openai'
import * as library from './library'
import { getSettings, isMockAi, setSecret, settingsView, updateSettings } from './settings'
import { generateSfx, synthesizeLine } from './tts/audio'
import { listVoices, quota, testEleven } from './tts/elevenlabs'
import { listSystemVoices } from './tts/system'

type Handler = (...args: never[]) => unknown

function handle(channel: string, fn: Handler): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    try {
      return await (fn as (...a: unknown[]) => unknown)(...args)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[ipc] ${channel} failed:`, message)
      // Only the message survives IPC serialisation – keep it user-friendly.
      throw new Error(message)
    }
  })
}

export function registerIpc(): void {
  handle('settings:get', () => settingsView())
  handle('settings:update', (patch: Partial<Settings>) => {
    updateSettings(patch)
    return settingsView()
  })
  handle('settings:setSecret', (kind: SecretKind, value: string | null) => {
    setSecret(kind, value)
    return settingsView()
  })
  handle('settings:test', (kind: SecretKind) => (kind === 'openai' ? testOpenAI() : testEleven()))

  handle('library:list', () => library.listComics())
  handle('library:create', (title: string, pdf: Uint8Array) => library.createComic(title, pdf))
  handle('library:load', (id: string) => library.loadComic(id))
  handle('library:save', (doc: ComicDoc) => library.saveComic(doc))
  handle('library:remove', (id: string) => library.removeComic(id))
  handle('library:writePage', (id: string, index: number, jpeg: Uint8Array, variant?: 'page' | 'thumb') =>
    library.writePage(id, index, jpeg, variant),
  )
  handle('library:readSource', (id: string) => library.readSource(id))
  handle('library:setLastBeat', (id: string, beat: number) => library.setLastBeat(id, beat))
  handle('library:reveal', (id: string | null) => library.revealComic(id))

  handle('ai:analyzePage', (req: AnalyzePageRequest) =>
    isMockAi() ? analyzePageMock(req) : analyzePageOpenAI(req),
  )
  handle('ai:consolidate', (req: ConsolidateRequest) =>
    isMockAi() ? consolidateMock(req) : consolidateOpenAI(req),
  )

  handle('voices:listEleven', (force?: boolean) => listVoices(force))
  handle('voices:listSystem', () => listSystemVoices())
  handle('voices:quota', async () => {
    try {
      return await quota()
    } catch {
      return null
    }
  })
  handle('voices:synthesize', (req: SynthesizeRequest) => synthesizeLine(req))
  handle('voices:sfx', (req: SfxRequest) => {
    if (!getSettings().sfxEnabled) throw new Error('Zvukové efekty jsou vypnuté')
    return generateSfx(req)
  })
}
