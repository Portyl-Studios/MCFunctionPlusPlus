// !!! must use commonjs syntax for electron's preload script
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
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
    ipcRenderer.on('fullscreen-changed', (_event: any, isFullScreen: boolean) => callback(isFullScreen))
  },
  quit: () => {
    return ipcRenderer.invoke('quit')
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
  datapackUpdate: (updates: Record<string, unknown>) => {
    return ipcRenderer.invoke('datapack-update', { updates })
  },
  datapackSave: () => {
    return ipcRenderer.invoke('datapack-save')
  },
  datapackClear: () => {
    return ipcRenderer.invoke('datapack-clear')
  }
})
