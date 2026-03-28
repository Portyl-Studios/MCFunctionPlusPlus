import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

let quitAndInstallRequested = false

export const setQuitAndInstallRequested = (requested: boolean): void => {
  quitAndInstallRequested = requested
}

export const quitAppRespectingInstallFlag = (): void => {
  if (quitAndInstallRequested) {
    quitAndInstallRequested = false
    try {
      autoUpdater.quitAndInstall(false, true)
      return
    } catch (error) {
      console.error('Failed to quit and install update; falling back to app.quit():', error)
      autoUpdater.autoInstallOnAppQuit = true
    }
  }

  app.quit()
}
