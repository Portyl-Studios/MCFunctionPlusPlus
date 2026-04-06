import { ipcMain, BrowserWindow, dialog } from 'electron'
import path from 'path'
import {
  parseWorkspaceFile,
  writeWorkspaceFile,
  createDefaultWorkspace,
  addDatapackPath,
  removeDatapackPath,
  setDatapackPaths,
  getDatapackPaths,
  toAbsoluteWorkspaceDatapackPath,
  toRelativeWorkspaceDatapackPath,
  type WorkspaceData
} from './workspace-parser'

class WorkspaceManager {
  private currentWorkspaceDir: string | null = null
  private currentWorkspaceName: string | null = null
  private currentWorkspaceData: WorkspaceData | null = null
  private datapackPathCache = new Map<string, string>()
  private static readonly OPEN_TABS_PREFERENCE_KEY = 'openTabs'
  private static readonly EXPLORER_EXPANDED_PREFERENCE_KEY = 'explorerExpandedPaths'

  private toStoredDatapackPath(metadataPath: string): string {
    const trimmed = metadataPath.trim()
    if (!trimmed) return ''

    if (!this.currentWorkspaceDir) {
      return trimmed.replace(/\\/g, '/')
    }

    return toRelativeWorkspaceDatapackPath(this.currentWorkspaceDir, trimmed)
  }

  private toAbsoluteDatapackPath(storedPath: string): string {
    const trimmed = storedPath.trim()
    if (!trimmed) return ''

    if (!this.currentWorkspaceDir) {
      const normalized = trimmed.replace(/\\/g, '/').replace(/\/+$/, '')
      if (!normalized) return ''

      if (normalized.toLowerCase().endsWith('/.mpp-datapack') || normalized.toLowerCase() === '.mpp-datapack') {
        return path.normalize(normalized)
      }

      return path.normalize(path.join(normalized, '.mpp-datapack'))
    }

    const cached = this.datapackPathCache.get(trimmed)
    if (cached) {
      return cached
    }

    const absolutePath = toAbsoluteWorkspaceDatapackPath(this.currentWorkspaceDir, trimmed)
    this.datapackPathCache.set(trimmed, absolutePath)
    return absolutePath
  }

  private rebuildDatapackPathCache(): void {
    this.datapackPathCache.clear()
    if (!this.currentWorkspaceData?.datapacks || !this.currentWorkspaceDir) {
      return
    }

    for (const storedPath of this.currentWorkspaceData.datapacks) {
      const absolutePath = this.toAbsoluteDatapackPath(storedPath)
      if (absolutePath) {
        this.datapackPathCache.set(storedPath, absolutePath)
      }
    }
  }

  private mapFileKeyDatapackDir(
    fileKey: string,
    mapper: (datapackDir: string) => string
  ): string {
    const separatorIndex = fileKey.indexOf('|')
    if (separatorIndex === -1) {
      return fileKey
    }

    const datapackDir = fileKey.slice(0, separatorIndex)
    const relativePath = fileKey.slice(separatorIndex + 1)
    const mappedDatapackDir = mapper(datapackDir)
    if (!mappedDatapackDir) {
      return fileKey
    }

    return `${mappedDatapackDir}|${relativePath}`
  }

  private toStoredWorkspacePreferenceValue(key: string, value: unknown): unknown {
    if (key === WorkspaceManager.OPEN_TABS_PREFERENCE_KEY) {
      if (!value || typeof value !== 'object') return value

      const session = value as { openedFiles?: unknown; activeFile?: unknown }
      const openedFiles = Array.isArray(session.openedFiles)
        ? session.openedFiles.map((entry) => {
            if (!entry || typeof entry !== 'object') return entry
            const openedFile = entry as Record<string, unknown>
            const datapackDir = typeof openedFile.datapackDir === 'string'
              ? this.toStoredDatapackPath(openedFile.datapackDir)
              : openedFile.datapackDir

            return {
              ...openedFile,
              datapackDir,
            }
          })
        : session.openedFiles

      const activeFile = typeof session.activeFile === 'string'
        ? this.mapFileKeyDatapackDir(session.activeFile, (datapackDir) => this.toStoredDatapackPath(datapackDir))
        : session.activeFile

      return {
        ...session,
        openedFiles,
        activeFile,
      }
    }

    if (key === WorkspaceManager.EXPLORER_EXPANDED_PREFERENCE_KEY) {
      if (!value || typeof value !== 'object') return value

      const payload = value as Record<string, unknown>
      const next: Record<string, unknown> = {}
      for (const [datapackDir, expandedPaths] of Object.entries(payload)) {
        const storedDatapackDir = this.toStoredDatapackPath(datapackDir)
        if (!storedDatapackDir) continue
        next[storedDatapackDir] = expandedPaths
      }

      return next
    }

    return value
  }

  private toRuntimeWorkspacePreferenceValue(key: string, value: unknown): unknown {
    if (key === WorkspaceManager.OPEN_TABS_PREFERENCE_KEY) {
      if (!value || typeof value !== 'object') return value

      const session = value as { openedFiles?: unknown; activeFile?: unknown }
      const openedFiles = Array.isArray(session.openedFiles)
        ? session.openedFiles.map((entry) => {
            if (!entry || typeof entry !== 'object') return entry
            const openedFile = entry as Record<string, unknown>
            const datapackDir = typeof openedFile.datapackDir === 'string'
              ? this.toAbsoluteDatapackPath(openedFile.datapackDir)
              : openedFile.datapackDir

            return {
              ...openedFile,
              datapackDir,
            }
          })
        : session.openedFiles

      const activeFile = typeof session.activeFile === 'string'
        ? this.mapFileKeyDatapackDir(session.activeFile, (datapackDir) => this.toAbsoluteDatapackPath(datapackDir))
        : session.activeFile

      return {
        ...session,
        openedFiles,
        activeFile,
      }
    }

    if (key === WorkspaceManager.EXPLORER_EXPANDED_PREFERENCE_KEY) {
      if (!value || typeof value !== 'object') return value

      const payload = value as Record<string, unknown>
      const next: Record<string, unknown> = {}
      for (const [storedDatapackDir, expandedPaths] of Object.entries(payload)) {
        const absoluteDatapackDir = this.toAbsoluteDatapackPath(storedDatapackDir)
        if (!absoluteDatapackDir) continue
        next[absoluteDatapackDir] = expandedPaths
      }

      return next
    }

    return value
  }

  private normalizeStoredWorkspacePreferences(preferences: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!preferences) return {}

    const normalizedPreferences: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(preferences)) {
      normalizedPreferences[key] = this.toStoredWorkspacePreferenceValue(key, value)
    }

    return normalizedPreferences
  }

  async loadWorkspace(directory: string, name: string): Promise<WorkspaceData> {
    this.currentWorkspaceDir = directory
    this.currentWorkspaceName = name
    this.datapackPathCache.clear()

    // Try to load existing workspace file
    let workspaceData = await parseWorkspaceFile(directory, name)

    // If no workspace file exists, create a default one
    if (!workspaceData) {
      workspaceData = createDefaultWorkspace()
      await writeWorkspaceFile(directory, name, workspaceData)
    } else {
      const normalizedStoredPaths = (workspaceData.datapacks ?? [])
        .map((entry) => toRelativeWorkspaceDatapackPath(directory, entry))
      workspaceData = setDatapackPaths(workspaceData, normalizedStoredPaths)
      workspaceData.preferences = this.normalizeStoredWorkspacePreferences(workspaceData.preferences)

      // Update lastOpened timestamp
      workspaceData.lastOpened = new Date().toISOString()
      await writeWorkspaceFile(directory, name, workspaceData)
    }

    this.currentWorkspaceData = workspaceData
    this.rebuildDatapackPathCache()
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

  updatePreference(key: string, value: unknown): void {
    if (!this.currentWorkspaceData) return

    if (!this.currentWorkspaceData.preferences) {
      this.currentWorkspaceData.preferences = {}
    }

    this.currentWorkspaceData.preferences[key] = this.toStoredWorkspacePreferenceValue(key, value)
  }

  getPreference(key: string): unknown {
    if (!this.currentWorkspaceData) return null

    const storedValue = this.currentWorkspaceData.preferences?.[key]
    if (storedValue === undefined || storedValue === null) {
      return null
    }

    return this.toRuntimeWorkspacePreferenceValue(key, storedValue)
  }

  addDatapack(metadataPath: string): void {
    if (!this.currentWorkspaceData) return
    const storedPath = this.toStoredDatapackPath(metadataPath)
    if (!storedPath) return

    this.currentWorkspaceData = addDatapackPath(this.currentWorkspaceData, storedPath)
    const absolutePath = this.toAbsoluteDatapackPath(storedPath)
    if (absolutePath) {
      this.datapackPathCache.set(storedPath, absolutePath)
    }
  }

  removeDatapack(metadataPath: string): void {
    if (!this.currentWorkspaceData) return
    const storedPath = this.toStoredDatapackPath(metadataPath)
    if (!storedPath) return

    this.currentWorkspaceData = removeDatapackPath(this.currentWorkspaceData, storedPath)
    this.datapackPathCache.delete(storedPath)
  }

  getDatapacks(): string[] {
    if (!this.currentWorkspaceData) return []

    return getDatapackPaths(this.currentWorkspaceData)
      .map((storedPath) => this.toAbsoluteDatapackPath(storedPath))
      .filter((absolutePath) => absolutePath.length > 0)
  }

  setDatapacks(metadataPaths: string[]): string[] {
    if (!this.currentWorkspaceData) return []
    const storedPaths = metadataPaths
      .map((metadataPath) => this.toStoredDatapackPath(metadataPath))
      .filter((metadataPath) => metadataPath.length > 0)

    this.currentWorkspaceData = setDatapackPaths(this.currentWorkspaceData, storedPaths)
    this.rebuildDatapackPathCache()
    return getDatapackPaths(this.currentWorkspaceData)
      .map((storedPath) => this.toAbsoluteDatapackPath(storedPath))
      .filter((absolutePath) => absolutePath.length > 0)
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

    this.currentWorkspaceDir = directory
    const rebasedStoredPaths = (this.currentWorkspaceData.datapacks ?? [])
      .map((entry) => this.toStoredDatapackPath(entry))
      .filter((entry) => entry.length > 0)
    this.currentWorkspaceData = setDatapackPaths(this.currentWorkspaceData, rebasedStoredPaths)
    this.rebuildDatapackPathCache()

    // Save to new location with new name
    await writeWorkspaceFile(directory, newName, this.currentWorkspaceData)

    // Update current workspace to the new location
    this.currentWorkspaceName = newName

    return {
      dir: directory,
      name: newName
    }
  }

  clear(): void {
    this.currentWorkspaceDir = null
    this.currentWorkspaceData = null
    this.datapackPathCache.clear()
  }

  newWorkspace(): void {
    // Create a new default workspace in memory without saving
    this.currentWorkspaceData = createDefaultWorkspace()
    this.currentWorkspaceDir = null
    this.currentWorkspaceName = null
    this.datapackPathCache.clear()
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

  ipcMain.handle('workspace-update-preference', async (_event, { key, value }) => {
    workspaceManager.updatePreference(key, value)
    await workspaceManager.saveWorkspace()
  })

  ipcMain.handle('workspace-get-preference', async (_event, { key }) => {
    return workspaceManager.getPreference(key)
  })

  ipcMain.handle('workspace-save', async () => {
    await workspaceManager.saveWorkspace()
  })

  ipcMain.handle('workspace-add-datapack', async (_event, { metadataPath }) => {
    workspaceManager.addDatapack(metadataPath)
    await workspaceManager.saveWorkspace()
    return workspaceManager.getDatapacks()
  })

  ipcMain.handle('workspace-remove-datapack', async (_event, { metadataPath }) => {
    workspaceManager.removeDatapack(metadataPath)
    await workspaceManager.saveWorkspace()
    return workspaceManager.getDatapacks()
  })

  ipcMain.handle('workspace-get-datapacks', async () => {
    return workspaceManager.getDatapacks()
  })

  ipcMain.handle('workspace-set-datapacks', async (_event, { metadataPaths }) => {
    if (!Array.isArray(metadataPaths)) {
      throw new Error('Invalid metadata paths payload')
    }

    const nextDatapacks = workspaceManager.setDatapacks(metadataPaths)
    await workspaceManager.saveWorkspace()
    return nextDatapacks
  })

  ipcMain.handle('workspace-new', async () => {
    workspaceManager.newWorkspace()
    return { success: true }
  })
}

export default workspaceManager
