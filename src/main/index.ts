import { BrowserWindow, app, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { testOpenAI } from './ai/openai'
import { registerIpc } from './ipc'
import { settingsView } from './settings'
import { testEleven } from './tts/elevenlabs'
import { dataDir } from './paths'
import { registerProtocols, registerSchemesAsPrivileged } from './protocol'

// Must run before the app is ready.
registerSchemesAsPrivileged()
app.setName('Čtyřlístek Reader')
// The default User-Agent embeds the app name; HTTP headers must be ASCII or
// custom-protocol requests fail ("Cannot convert argument to a ByteString").
app.userAgentFallback = app.userAgentFallback
  .normalize('NFD')
  .replace(/\p{M}/gu, '')
  .replace(/[^\x20-\x7e]/g, '')
if (process.env.CTYRLISTEK_DATA_DIR) app.setPath('userData', dataDir())

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL

function createWindow(): BrowserWindow {
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
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The player starts voice playback without a click on every page turn.
      autoplayPolicy: 'no-user-gesture-required',
      spellcheck: false,
    },
  })

  win.once('ready-to-show', () => {
    if (process.env.CTYRLISTEK_HIDDEN !== '1') win.show()
  })

  // Never open new windows inside the app; external links go to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev ? url.startsWith(process.env.ELECTRON_RENDERER_URL!) : url.startsWith('app://')
    if (!allowed) event.preventDefault()
  })

  if (isDev) void win.loadURL(process.env.ELECTRON_RENDERER_URL!)
  else void win.loadURL('app://bundle/index.html')
  return win
}

/**
 * `CTYRLISTEK_SELFTEST=1`: verify the stored API keys against both services,
 * print the result (never the keys) and quit. Handy for support/debugging.
 */
async function selfTest(): Promise<void> {
  const view = settingsView()
  console.log(`[selftest] keys: openai=${view.openaiKey ?? 'missing'} elevenlabs=${view.elevenKey ?? 'missing'}`)
  const [openai, eleven] = await Promise.all([testOpenAI(), testEleven()])
  console.log(`[selftest] openai: ${openai.ok ? 'OK' : 'FAIL'} – ${openai.message}`)
  console.log(`[selftest] elevenlabs: ${eleven.ok ? 'OK' : 'FAIL'} – ${eleven.message}`)
  app.quit()
}

app.whenReady().then(() => {
  if (process.env.CTYRLISTEK_SELFTEST === '1') {
    void selfTest()
    return
  }
  nativeTheme.themeSource = 'dark'
  registerProtocols(join(__dirname, '../renderer'))
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
