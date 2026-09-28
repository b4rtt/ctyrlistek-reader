/**
 * Application windows: the main window and the optional TV window (fullscreen
 * playback on an AirPlay / HDMI display while the main window becomes the
 * remote control).
 */
import { BrowserWindow, app, screen, shell } from 'electron'
import { join } from 'node:path'

const isDev = (): boolean => !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL

let mainWindow: BrowserWindow | null = null
let tvWindow: BrowserWindow | null = null
let tvDisplayLabel = ''
let tvDisplayId: number | null = null

function secureDefaults(win: BrowserWindow): void {
  // Never open new windows inside the app; external links go to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev() ? url.startsWith(process.env.ELECTRON_RENDERER_URL!) : url.startsWith('app://')
    if (!allowed) event.preventDefault()
  })
}

function loadRenderer(win: BrowserWindow, hash = ''): void {
  const base = isDev() ? process.env.ELECTRON_RENDERER_URL! : 'app://bundle/index.html'
  void win.loadURL(hash ? `${base}#${hash}` : base)
}

const webPreferences = (): Electron.WebPreferences => ({
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  // The player starts voice playback without a click on every page turn.
  autoplayPolicy: 'no-user-gesture-required',
  spellcheck: false,
})

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 900,
    minHeight: 620,
    show: false,
    title: 'Čtyřlístek Reader',
    backgroundColor: '#0f1a14',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: webPreferences(),
  })
  win.once('ready-to-show', () => {
    if (process.env.CTYRLISTEK_HIDDEN !== '1') win.show()
  })
  win.on('closed', () => {
    mainWindow = null
    // The remote is gone – do not leave the TV playing on its own.
    tvWindow?.close()
  })
  secureDefaults(win)
  loadRenderer(win)
  mainWindow = win
  return win
}

export const getMainWindow = (): BrowserWindow | null => mainWindow
export const getTvWindow = (): BrowserWindow | null => tvWindow
export const getTvDisplayLabel = (): string => tvDisplayLabel
export const getTvDisplayId = (): number | null => tvDisplayId

/**
 * Open fullscreen playback on the given display. `CTYRLISTEK_TV_TEST=1` opens
 * a normal window instead (end-to-end tests run on a single screen).
 */
export function openTvWindow(comicId: string, displayId: number, beat: number): BrowserWindow {
  const display = screen.getAllDisplays().find((d) => d.id === displayId)
  if (!display) throw new Error('Televize už není připojená.')
  tvWindow?.close()

  const test = process.env.CTYRLISTEK_TV_TEST === '1'
  const { x, y, width, height } = display.bounds
  const win = new BrowserWindow({
    x: test ? x + 40 : x,
    y: test ? y + 40 : y,
    width: test ? 960 : width,
    height: test ? 540 : height,
    show: false,
    frame: test,
    title: 'Čtyřlístek Reader – televize',
    backgroundColor: '#000000',
    webPreferences: webPreferences(),
  })
  win.once('ready-to-show', () => {
    if (!test) {
      win.setBounds(display.bounds)
      win.setFullScreen(true)
    }
    win.show()
  })
  win.on('closed', () => {
    if (tvWindow === win) {
      tvWindow = null
      mainWindow?.webContents.send('tv:state', null)
    }
  })
  secureDefaults(win)
  loadRenderer(win, `tv/${encodeURIComponent(comicId)}/${Math.max(0, Math.round(beat))}`)
  tvWindow = win
  tvDisplayLabel = display.label || 'Televize'
  tvDisplayId = display.id
  return win
}

export function closeTvWindow(): void {
  tvWindow?.close()
}
