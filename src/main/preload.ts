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
  readFile: (directory: string, filePath: string) => {
    return ipcRenderer.invoke('read-file', { directory, filePath })
  },
  listFiles: (directory: string) => {
    return ipcRenderer.invoke('list-files', { directory })
  },
  workspaceLoad: (directory: string, name: string) => {
    return ipcRenderer.invoke('workspace-load', { directory, name })
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
  workspaceUpdateSetting: (key: string, value: unknown) => {
    return ipcRenderer.invoke('workspace-update-setting', { key, value })
  },
  workspaceGetSetting: (key: string) => {
    return ipcRenderer.invoke('workspace-get-setting', { key })
  },
  workspaceSave: () => {
    return ipcRenderer.invoke('workspace-save')
  },
  createFolder: (folderPath: string) => {
    return ipcRenderer.invoke('create-folder', { folderPath })
  }
})
