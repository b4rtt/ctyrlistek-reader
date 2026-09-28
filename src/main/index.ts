import { BrowserWindow, app, nativeTheme } from 'electron'
import { join } from 'node:path'
import { testOpenAI } from './ai/openai'
import { registerIpc } from './ipc'
import { settingsView } from './settings'
import { testEleven } from './tts/elevenlabs'
import { dataDir } from './paths'
import { registerProtocols, registerSchemesAsPrivileged } from './protocol'
import { registerTv } from './tv'
import { createMainWindow } from './windows'

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
  registerTv()
  createMainWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
