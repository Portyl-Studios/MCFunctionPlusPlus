import { ipcMain, BrowserWindow, dialog } from 'electron'
import path from 'path'
import {
  parseWorkspaceFile,
  writeWorkspaceFile,
  createDefaultWorkspace,
  type WorkspaceData
} from './workspace-parser'

class WorkspaceManager {
  private currentWorkspaceDir: string | null = null
  private currentWorkspaceName: string | null = null
  private currentWorkspaceData: WorkspaceData | null = null

  async loadWorkspace(directory: string, name: string): Promise<WorkspaceData> {
    this.currentWorkspaceDir = directory
    this.currentWorkspaceName = name

    // Try to load existing workspace file
    let workspaceData = await parseWorkspaceFile(directory, name)

    // If no workspace file exists, create a default one
    if (!workspaceData) {
      workspaceData = createDefaultWorkspace()
      await writeWorkspaceFile(directory, name, workspaceData)
    } else {
      // Update lastOpened timestamp
      workspaceData.lastOpened = new Date().toISOString()
      await writeWorkspaceFile(directory, name, workspaceData)
    }

    this.currentWorkspaceData = workspaceData
    return workspaceData
  }

  getWorkspace(): WorkspaceData | null {
    return this.currentWorkspaceData
  }

  getWorkspaceDir(): string | null {
    return this.currentWorkspaceDir
  }

  getWorkspaceName(): string | null {
    return this.currentWorkspaceName
  }

  getCurrentWorkspaceInfo(): { dir: string | null; name: string | null } {
    return {
      dir: this.currentWorkspaceDir,
      name: this.currentWorkspaceName
    }
  }

  updateSetting(key: string, value: unknown): void {
    if (!this.currentWorkspaceData) return

    if (!this.currentWorkspaceData.settings) {
      this.currentWorkspaceData.settings = {}
    }

    this.currentWorkspaceData.settings[key] = value
  }

  getSetting(key: string): unknown {
    if (!this.currentWorkspaceData) return null
    return this.currentWorkspaceData.settings?.[key] ?? null
  }

  async saveWorkspace(): Promise<void> {
    if (!this.currentWorkspaceDir || !this.currentWorkspaceName || !this.currentWorkspaceData) {
      throw new Error('No workspace loaded')
    }

    await writeWorkspaceFile(this.currentWorkspaceDir, this.currentWorkspaceName, this.currentWorkspaceData)
  }

  async saveWorkspaceAs(directory: string, newName: string): Promise<{ dir: string; name: string }> {
    // If no workspace is loaded, create a default one
    if (!this.currentWorkspaceData) {
      this.currentWorkspaceData = createDefaultWorkspace()
    }

    // Save to new location with new name
    await writeWorkspaceFile(directory, newName, this.currentWorkspaceData)

    // Update current workspace to the new location
    this.currentWorkspaceDir = directory
    this.currentWorkspaceName = newName

    return {
      dir: directory,
      name: newName
    }
  }

  clear(): void {
    this.currentWorkspaceDir = null
    this.currentWorkspaceData = null
  }
}

// Create singleton instance
const workspaceManager = new WorkspaceManager()

// IPC Handlers
export const registerWorkspaceHandlers = (getMainWindow: () => BrowserWindow | null) => {
  ipcMain.handle('workspace-load', async (_event, { directory, name }) => {
    const workspace = await workspaceManager.loadWorkspace(directory, name)
    return workspace
  })

  ipcMain.handle('workspace-get', async () => {
    return workspaceManager.getWorkspace()
  })

  ipcMain.handle('workspace-info', async () => {
    return workspaceManager.getCurrentWorkspaceInfo()
  })

  ipcMain.handle('workspace-open-dialog', async () => {
    const mainWindow = getMainWindow()
    if (!mainWindow) throw new Error('No main window')

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'MCFunction++ Workspace', extensions: ['mpp-workspace'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const filePath = result.filePaths[0]
    const dir = path.dirname(filePath)
    const filename = path.basename(filePath)
    const name = filename.replace(/\.mpp-workspace$/, '')

    return { dir, name, filePath }
  })

  ipcMain.handle('workspace-save-dialog', async (_event, { defaultName }) => {
    const mainWindow = getMainWindow()
    if (!mainWindow) throw new Error('No main window')

    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Workspace As',
      defaultPath: defaultName || 'workspace',
      filters: [
        { name: 'MCFunction++ Workspace', extensions: ['mpp-workspace'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled || !result.filePath) {
      return null
    }

    return result.filePath
  })

  ipcMain.handle('workspace-save-as', async (_event, { directory, name }) => {
    const result = await workspaceManager.saveWorkspaceAs(directory, name)
    return result
  })

  ipcMain.handle('workspace-update-setting', async (_event, { key, value }) => {
    workspaceManager.updateSetting(key, value)
    await workspaceManager.saveWorkspace()
  })

  ipcMain.handle('workspace-get-setting', async (_event, { key }) => {
    return workspaceManager.getSetting(key)
  })

  ipcMain.handle('workspace-save', async () => {
    await workspaceManager.saveWorkspace()
  })
}

export default workspaceManager
