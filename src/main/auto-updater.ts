import type { BrowserWindow } from 'electron'
import { app } from 'electron'
import type { IpcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { AppUpdateStatus } from './electron-api'

let hasCheckedForUpdatesThisSession = false
const UPDATE_CHECK_TIMEOUT_MS = 30_000

let appUpdateStatus: AppUpdateStatus = {
  status: 'checking',
  updateAvailable: false,
}
let updateCheckTimeoutId: ReturnType<typeof setTimeout> | null = null
let isUpdateCheckFinalized = false
let updateStatusBroadcaster: ((status: AppUpdateStatus) => void) | null = null

export const getAppUpdateStatus = (): AppUpdateStatus => appUpdateStatus

export const registerAutoUpdaterHandlers = (ipcMain: IpcMain): void => {
  ipcMain.handle('app-update-status-get', () => {
    return getAppUpdateStatus()
  })
}

export const registerAppUpdateStatusBroadcaster = (broadcaster: ((status: AppUpdateStatus) => void) | null): void => {
  updateStatusBroadcaster = broadcaster
}

export const broadcastAppUpdateStatus = (mainWindow: BrowserWindow | null): void => {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
  mainWindow.webContents.send('app-update-status-changed', appUpdateStatus)
}

const clearUpdateCheckTimeout = (): void => {
  if (!updateCheckTimeoutId) return
  clearTimeout(updateCheckTimeoutId)
  updateCheckTimeoutId = null
}

const setAppUpdateStatus = (status: AppUpdateStatus): void => {
  appUpdateStatus = status
  const isFinalState = status.status !== 'checking'

  if (isFinalState) {
    isUpdateCheckFinalized = true
    clearUpdateCheckTimeout()
  }

  updateStatusBroadcaster?.(appUpdateStatus)
}

const startUpdateCheckTimeout = (): void => {
  clearUpdateCheckTimeout()
  updateCheckTimeoutId = setTimeout(() => {
    if (isUpdateCheckFinalized) return
    setAppUpdateStatus({
      status: 'failed',
      updateAvailable: false,
      message: `Update check timed out after ${UPDATE_CHECK_TIMEOUT_MS / 1000} seconds.`,
    })
  }, UPDATE_CHECK_TIMEOUT_MS)
}

autoUpdater.on('checking-for-update', () => {
  if (isUpdateCheckFinalized) return
  setAppUpdateStatus({
    status: 'checking',
    updateAvailable: false,
  })
})

autoUpdater.on('update-not-available', () => {
  if (isUpdateCheckFinalized) return
  setAppUpdateStatus({
    status: 'up-to-date',
    updateAvailable: false,
  })
})

autoUpdater.on('update-available', (updateInfo) => {
  if (isUpdateCheckFinalized) return
  setAppUpdateStatus({
    status: 'update-available',
    updateAvailable: true,
    latestVersion: typeof updateInfo?.version === 'string' ? updateInfo.version : undefined,
  })
})

autoUpdater.on('error', (error) => {
  if (isUpdateCheckFinalized) return
  setAppUpdateStatus({
    status: 'failed',
    updateAvailable: false,
    message: error instanceof Error ? error.message : 'Unknown updater error',
  })
})

export const checkForUpdatesOncePerLaunch = (): void => {
  if (hasCheckedForUpdatesThisSession) return
  hasCheckedForUpdatesThisSession = true

  isUpdateCheckFinalized = false
  setAppUpdateStatus({
    status: 'checking',
    updateAvailable: false,
  })
  startUpdateCheckTimeout()

  if (!app.isPackaged) {
    setAppUpdateStatus({
      status: 'up-to-date',
      updateAvailable: false,
      message: 'Development build detected. Skipping update check.',
    })
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  void autoUpdater.checkForUpdates().catch((error) => {
    if (!isUpdateCheckFinalized) {
      setAppUpdateStatus({
        status: 'failed',
        updateAvailable: false,
        message: error instanceof Error ? error.message : 'Failed to check for updates.',
      })
    }
    console.error('Failed to check for app updates:', error)
  })
}
