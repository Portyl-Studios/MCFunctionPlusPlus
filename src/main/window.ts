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
    if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen())
  })

  ipcMain.handle('quit', async () => {
    app.quit()
  })
}
