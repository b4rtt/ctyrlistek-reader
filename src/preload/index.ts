import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AppApi } from '@shared/api'

const invoke =
  <T>(channel: string) =>
  (...args: unknown[]): Promise<T> =>
    ipcRenderer.invoke(channel, ...args) as Promise<T>

/** Subscribe to a main → renderer event; returns an unsubscribe function. */
const listen =
  <T>(channel: string) =>
  (cb: (payload: T) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, payload: T): void => cb(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }

const api: AppApi = {
  platform: process.platform,
  settings: {
    get: invoke('settings:get'),
    update: invoke('settings:update'),
    setSecret: invoke('settings:setSecret'),
    test: invoke('settings:test'),
    onChange: listen('settings:changed'),
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
    verifyPage: invoke('ai:verifyPage'),
  },
  tv: {
    displays: invoke('tv:displays'),
    open: invoke('tv:open'),
    close: invoke('tv:close'),
    isOpen: invoke('tv:isOpen'),
    command: (cmd) => ipcRenderer.send('tv:command', cmd),
    publish: (state) => ipcRenderer.send('tv:state', state),
    onCommand: listen('tv:command'),
    onState: listen('tv:state'),
    onDisplays: listen('tv:displays'),
    openDisplaySettings: invoke('tv:openDisplaySettings'),
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
