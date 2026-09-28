/**
 * TV playback: display discovery (AirPlay shows up as an extra display once
 * the Mac uses the TV as a separate monitor), IPC relay between the remote
 * (main window) and the TV window, and hot-plug handling.
 */
import { BrowserWindow, ipcMain, screen, shell } from 'electron'
import type { DisplayInfo, TvCommand, TvState } from '@shared/api'
import {
  closeTvWindow,
  getMainWindow,
  getTvDisplayId,
  getTvDisplayLabel,
  getTvWindow,
  openTvWindow,
} from './windows'

export function listDisplays(): DisplayInfo[] {
  const primary = screen.getPrimaryDisplay().id
  const anyDisplay = process.env.CTYRLISTEK_TV_TEST === '1'
  return screen.getAllDisplays().map((d) => ({
    id: d.id,
    label: d.label || (d.internal ? 'Vestavěný displej' : 'Externí displej'),
    // In tests every display counts as a TV so the flow can run on one screen.
    internal: anyDisplay ? false : d.internal || (d.id === primary && screen.getAllDisplays().length === 1),
    primary: d.id === primary,
    width: d.size.width,
    height: d.size.height,
  }))
}

function broadcastDisplays(): void {
  const displays = listDisplays()
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('tv:displays', displays)
  // The TV was disconnected (AirPlay stopped) – close its window.
  const tv = getTvWindow()
  if (tv && !screen.getAllDisplays().some((d) => d.id === getTvDisplayId())) tv.close()
}

export function registerTv(): void {
  screen.on('display-added', broadcastDisplays)
  screen.on('display-removed', broadcastDisplays)

  ipcMain.handle('tv:displays', () => listDisplays())
  ipcMain.handle('tv:open', (_e, comicId: string, displayId: number, beat: number) => {
    openTvWindow(comicId, displayId, beat)
  })
  ipcMain.handle('tv:close', () => closeTvWindow())
  ipcMain.handle('tv:isOpen', () => !!getTvWindow())
  ipcMain.handle('tv:openDisplaySettings', async () => {
    if (process.platform === 'darwin') {
      await shell.openExternal('x-apple.systempreferences:com.apple.Displays-Settings.extension')
    } else if (process.platform === 'win32') {
      await shell.openExternal('ms-settings:display')
    }
  })

  // Remote → TV.
  ipcMain.on('tv:command', (_e, cmd: TvCommand) => {
    getTvWindow()?.webContents.send('tv:command', cmd)
  })
  // TV → remote.
  ipcMain.on('tv:state', (e, state: TvState) => {
    if (e.sender !== getTvWindow()?.webContents) return
    getMainWindow()?.webContents.send('tv:state', { ...state, display: getTvDisplayLabel() })
  })
}
