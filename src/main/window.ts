import { BrowserWindow, ipcMain } from 'electron'

type WindowControlHandlerOptions = {
  onQuitCancelled?: () => void
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
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide()
    }
    setImmediate(() => {
      mainWindow?.close()
    })
  })

  ipcMain.handle('quit-cancelled', async () => {
    options.onQuitCancelled?.()
  })
}
