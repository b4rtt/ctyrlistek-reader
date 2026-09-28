import { contextBridge, ipcRenderer } from 'electron'
import type { AppApi } from '@shared/api'

const invoke =
  <T>(channel: string) =>
  (...args: unknown[]): Promise<T> =>
    ipcRenderer.invoke(channel, ...args) as Promise<T>

const api: AppApi = {
  platform: process.platform,
  settings: {
    get: invoke('settings:get'),
    update: invoke('settings:update'),
    setSecret: invoke('settings:setSecret'),
    test: invoke('settings:test'),
  },
  library: {
    list: invoke('library:list'),
    create: invoke('library:create'),
    load: invoke('library:load'),
    save: invoke('library:save'),
    remove: invoke('library:remove'),
    writePage: invoke('library:writePage'),
    readSource: invoke('library:readSource'),
    setLastBeat: invoke('library:setLastBeat'),
    reveal: invoke('library:reveal'),
  },
  ai: {
    analyzePage: invoke('ai:analyzePage'),
    consolidate: invoke('ai:consolidate'),
  },
  voices: {
    listEleven: invoke('voices:listEleven'),
    listSystem: invoke('voices:listSystem'),
    quota: invoke('voices:quota'),
    synthesize: invoke('voices:synthesize'),
    sfx: invoke('voices:sfx'),
  },
}

contextBridge.exposeInMainWorld('ctyrlistek', api)
