import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  writeFile: (directory: string, filename: string, contents: string) => {
    return ipcRenderer.invoke('write-file', { directory, filename, contents })
  }
})
