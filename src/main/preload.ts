// !!! must use commonjs syntax for electron's preload script
const { contextBridge, ipcRenderer } = require('electron')

import type { IpcRendererEvent } from 'electron'
import type { AppUpdateStatus, ElectronAPI, ExternalFileChangeEvent, ShortcutHandler, TitlebarContextMenuPosition } from './electron-api'
import type { AppPreferences } from './preferences'

const electronApi: ElectronAPI = {
  minimize: () => {
    return ipcRenderer.invoke('minimize')
  },
  toggleFullscreen: () => {
    return ipcRenderer.invoke('toggle-fullscreen')
  },
  isFullScreen: () => {
    return ipcRenderer.invoke('is-fullscreen')
  },
  onFullscreenChange: (callback: (isFullScreen: boolean) => void) => {
    const listener = (_event: IpcRendererEvent, isFullScreen: boolean) => callback(isFullScreen)
    ipcRenderer.on('fullscreen-changed', listener)
    return () => {
      ipcRenderer.removeListener('fullscreen-changed', listener)
    }
  },
  onTitlebarContextMenu: (callback: (position: TitlebarContextMenuPosition) => void) => {
    const listener = (_event: IpcRendererEvent, position: TitlebarContextMenuPosition) => callback(position)
    ipcRenderer.on('titlebar-context-menu', listener)
    return () => {
      ipcRenderer.removeListener('titlebar-context-menu', listener)
    }
  },
  onQuitRequested: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('quit-requested', listener)
    return () => {
      ipcRenderer.removeListener('quit-requested', listener)
    }
  },
  quit: () => {
    return ipcRenderer.invoke('quit')
  },
  quitCancelled: () => {
    return ipcRenderer.invoke('quit-cancelled')
  },
  pickFolder: () => {
    return ipcRenderer.invoke('pick-folder')
  },
  writeFile: (directory: string, filename: string, contents: string) => {
    return ipcRenderer.invoke('write-file', { directory, filename, contents })
  },
  saveFile: (directory: string, relativePath: string, contents: string) => {
    return ipcRenderer.invoke('save-file', { directory, relativePath, contents })
  },
  readFile: (directory: string, filePath: string) => {
    return ipcRenderer.invoke('read-file', { directory, filePath })
  },
  readFileIfExists: (directory: string, filePath: string) => {
    return ipcRenderer.invoke('read-file-if-exists', { directory, filePath })
  },
  listFiles: (directory: string) => {
    return ipcRenderer.invoke('list-files', { directory })
  },
  workspaceLoad: (directory: string, name: string) => {
    return ipcRenderer.invoke('workspace-load', { directory, name })
  },
  workspaceGetOrCreateDefault: () => {
    return ipcRenderer.invoke('workspace-get-or-create-default')
  },
  workspaceGet: () => {
    return ipcRenderer.invoke('workspace-get')
  },
  workspaceInfo: () => {
    return ipcRenderer.invoke('workspace-info')
  },
  workspaceOpenDialog: () => {
    return ipcRenderer.invoke('workspace-open-dialog')
  },
  workspaceSaveDialog: (defaultName: string) => {
    return ipcRenderer.invoke('workspace-save-dialog', { defaultName })
  },
  workspaceSaveAs: (directory: string, name: string) => {
    return ipcRenderer.invoke('workspace-save-as', { directory, name })
  },
  workspaceUpdatePreference: (key: string, value: unknown) => {
    return ipcRenderer.invoke('workspace-update-preference', { key, value })
  },
  workspaceGetPreference: (key: string) => {
    return ipcRenderer.invoke('workspace-get-preference', { key })
  },
  workspaceSave: () => {
    return ipcRenderer.invoke('workspace-save')
  },
  workspaceAddDatapack: (metadataPath: string) => {
    return ipcRenderer.invoke('workspace-add-datapack', { metadataPath })
  },
  workspaceRemoveDatapack: (metadataPath: string) => {
    return ipcRenderer.invoke('workspace-remove-datapack', { metadataPath })
  },
  workspaceGetDatapacks: () => {
    return ipcRenderer.invoke('workspace-get-datapacks')
  },
  workspaceNew: () => {
    return ipcRenderer.invoke('workspace-new')
  },
  createFolder: (folderPath: string) => {
    return ipcRenderer.invoke('create-folder', { folderPath })
  },
  addDatapackExisting: (datapackDir: string) => {
    return ipcRenderer.invoke('add-datapack-existing', { datapackDir })
  },
  datapackLoad: (datapackDir: string) => {
    return ipcRenderer.invoke('datapack-load', { datapackDir })
  },
  datapackGet: () => {
    return ipcRenderer.invoke('datapack-get')
  },
  datapackUpdate: (updates) => {
    return ipcRenderer.invoke('datapack-update', { updates })
  },
  datapackSave: () => {
    return ipcRenderer.invoke('datapack-save')
  },
  datapackClear: () => {
    return ipcRenderer.invoke('datapack-clear')
  },
  onShortcut: (callback: ShortcutHandler) => {
    ipcRenderer.on('shortcut', callback)
    return () => {
      ipcRenderer.removeListener('shortcut', callback)
    }
  },
  revealInFileExplorer: (filePath: string) => {
    return ipcRenderer.invoke('reveal-in-file-explorer', { filePath })
  },
  renameFileOrFolder: (oldPath: string, newName: string) => {
    return ipcRenderer.invoke('rename-file-or-folder', { oldPath, newName })
  },
  deleteFileOrFolder: (targetPath: string) => {
    return ipcRenderer.invoke('delete-file-or-folder', { targetPath })
  },
  preferencesGet: <K extends keyof AppPreferences>(key: K) => {
    return ipcRenderer.invoke('preferences-get', { key }) as Promise<AppPreferences[K] | undefined>
  },
  preferencesSet: <K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) => {
    return ipcRenderer.invoke('preferences-set', { key, value })
  },
  preferencesUpdate: (updates: Partial<AppPreferences>) => {
    return ipcRenderer.invoke('preferences-update', { updates })
  },
  commandSchemaGet: (version: string) => {
    return ipcRenderer.invoke('command-schema-get', { version })
  },
  minecraftDataGet: (version: string, dataType: string) => {
    return ipcRenderer.invoke('minecraft-data-get', { version, dataType })
  },
  watchFileStart: (watchId: string, directory: string, relativePath: string) => {
    return ipcRenderer.invoke('watch-file-start', { watchId, directory, relativePath })
  },
  watchFileStop: (watchId: string) => {
    return ipcRenderer.invoke('watch-file-stop', { watchId })
  },
  watchFileStopAll: () => {
    return ipcRenderer.invoke('watch-file-stop-all')
  },
  onFileExternalChange: (callback: (event: ExternalFileChangeEvent) => void) => {
    const listener = (_event: IpcRendererEvent, payload: ExternalFileChangeEvent) => callback(payload)
    ipcRenderer.on('file-external-change', listener)
    return () => {
      ipcRenderer.removeListener('file-external-change', listener)
    }
  },
  getAppUpdateStatus: () => {
    return ipcRenderer.invoke('app-update-status-get') as Promise<AppUpdateStatus>
  },
  onAppUpdateStatusChange: (callback: (status: AppUpdateStatus) => void) => {
    const listener = (_event: IpcRendererEvent, status: AppUpdateStatus) => callback(status)
    ipcRenderer.on('app-update-status-changed', listener)
    return () => {
      ipcRenderer.removeListener('app-update-status-changed', listener)
    }
  },
}

contextBridge.exposeInMainWorld('electron', electronApi)
