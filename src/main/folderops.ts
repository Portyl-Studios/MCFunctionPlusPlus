import { BrowserWindow, dialog, ipcMain } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'

export const registerPickFolderHandler = (
  getMainWindow: () => BrowserWindow | null
) => {
  ipcMain.handle('pick-folder', async () => {
    const mainWindow = getMainWindow()
    if (!mainWindow) throw new Error('No main window')

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })
}

export const getAllFiles = async (rootDir: string): Promise<string[]> => {
  const results: string[] = []
  const entries = await fs.readdir(rootDir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name)

    if (entry.isDirectory()) {
      const nested = await getAllFiles(fullPath)
      results.push(...nested)
    } else if (entry.isFile()) {
      results.push(fullPath)
    }
  }

  return results
}
