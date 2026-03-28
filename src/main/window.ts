import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { wait } from './utils'
import { quitAppRespectingInstallFlag } from './quit-manager'

type WindowControlHandlerOptions = {
  onQuitCancelled?: () => void
  onQuitConfirmed?: () => Promise<boolean> | boolean
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
      await wait(350)

      if (!mainWindow.isDestroyed()) {
        mainWindow.destroy()
      }
    }

    quitAppRespectingInstallFlag()
  })

  ipcMain.handle('quit-cancelled', async () => {
    options.onQuitCancelled?.()
  })

  ipcMain.handle('open-external', async (_event, { url }) => {
    await shell.openExternal(url)
  })
}
