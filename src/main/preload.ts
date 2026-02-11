import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  // Add APIs if needed
})
