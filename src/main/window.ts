import { app, BrowserWindow, ipcMain } from 'electron'

export const registerWindowControlHandlers = (
  getMainWindow: () => BrowserWindow | null
) => {
  ipcMain.handle('minimize', async () => {
    const mainWindow = getMainWindow()
    if (mainWindow) mainWindow.minimize()
  })

  ipcMain.handle('toggle-fullscreen', async () => {
    const mainWindow = getMainWindow()
    if (mainWindow) {
      mainWindow.setFullScreen(!mainWindow.isFullScreen())
      mainWindow.webContents.send('fullscreen-changed', mainWindow.isFullScreen())
    }
  })

  ipcMain.handle('is-fullscreen', async () => {
    const mainWindow = getMainWindow()
    return mainWindow?.isFullScreen() ?? false
  })

  ipcMain.handle('quit', async () => {
    app.quit()
  })
}
