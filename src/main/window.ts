import { BrowserWindow, ipcMain, shell } from 'electron'
import { quitAppRespectingInstallFlag } from './quit-manager'
import type { ExternalDestination } from './electron-api'

type WindowControlHandlerOptions = {
  onQuitCancelled?: () => void
  onQuitConfirmed?: () => Promise<boolean> | boolean
}

const EXTERNAL_DESTINATION_URLS: Record<ExternalDestination, string> = {
  'bug-report': 'https://github.com/Portyl-Studios/MCFunctionPlusPlus/issues',
}

const resolveExternalDestinationUrl = (rawDestination: unknown): string => {
  if (typeof rawDestination !== 'string') {
    throw new Error('Invalid external destination')
  }

  const destination = rawDestination as ExternalDestination
  const resolvedUrl = EXTERNAL_DESTINATION_URLS[destination]
  if (!resolvedUrl) {
    throw new Error('Blocked external destination')
  }

  return resolvedUrl
}

const getIsWindowExpanded = (mainWindow: BrowserWindow) => {
  return mainWindow.isFullScreen() || mainWindow.isMaximized()
}

const emitWindowStateChanged = (mainWindow: BrowserWindow) => {
  mainWindow.webContents.send('fullscreen-changed', getIsWindowExpanded(mainWindow))
}

export const registerWindowControlHandlers = (
  getMainWindow: () => BrowserWindow | null,
  options: WindowControlHandlerOptions = {}
) => {
  ipcMain.handle('minimize', async () => {
    const mainWindow = getMainWindow()
    if (mainWindow) mainWindow.minimize()
  })

  ipcMain.handle('toggle-fullscreen', async () => {
    const mainWindow = getMainWindow()
    if (mainWindow) {
      if (mainWindow.isFullScreen()) {
        mainWindow.setFullScreen(false)
      } else if (mainWindow.isMaximized()) {
        mainWindow.unmaximize()
      } else {
        mainWindow.maximize()
      }

      emitWindowStateChanged(mainWindow)
    }
  })

  ipcMain.handle('is-fullscreen', async () => {
    const mainWindow = getMainWindow()
    return mainWindow ? getIsWindowExpanded(mainWindow) : false
  })

  ipcMain.handle('quit', async () => {
    const mainWindow = getMainWindow()

    const wasHandled = await options.onQuitConfirmed?.()
    if (wasHandled) {
      return
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.destroy()
    }

    quitAppRespectingInstallFlag()
  })

  ipcMain.handle('quit-cancelled', async () => {
    options.onQuitCancelled?.()
  })

  ipcMain.handle('open-external', async (_event, { destination }) => {
    const safeUrl = resolveExternalDestinationUrl(destination)
    await shell.openExternal(safeUrl)
  })
}
