import { BrowserWindow, app, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { dataDir } from './paths'
import { registerProtocols, registerSchemesAsPrivileged } from './protocol'

// Must run before the app is ready.
registerSchemesAsPrivileged()
app.setName('Čtyřlístek Reader')
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

app.whenReady().then(() => {
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
