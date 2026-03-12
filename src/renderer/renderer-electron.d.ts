import type { ElectronAPI } from '../main/electron-api'

declare global {
  interface Window {
    electron: ElectronAPI
  }
}

export {}
