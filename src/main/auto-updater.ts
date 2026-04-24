import type { BrowserWindow } from 'electron'
import { app } from 'electron'
import type { IpcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { AppUpdateStatus } from './electron-api'
import { setQuitAndInstallRequested } from './quit-manager'

const UPDATE_CHECK_TIMEOUT_MS = 30_000

let appUpdateStatus: AppUpdateStatus = {
  status: 'checking',
  updateAvailable: false,
  downloadCompleted: false,
}
let updateCheckTimeoutId: ReturnType<typeof setTimeout> | null = null
let isUpdateCheckFinalized = false
let updateStatusBroadcaster: ((status: AppUpdateStatus) => void) | null = null
let updateDownloadProgressBroadcaster: ((progressPercent: number) => void) | null = null
let isUpdateDownloaded = false
let updateDownloadPromise: Promise<void> | null = null

export const getAppUpdateStatus = (): AppUpdateStatus => appUpdateStatus

const getUpdaterErrorMessage = (error: unknown): string => {
  if (error instanceof Error && typeof error.message === 'string' && error.message.trim()) {
    return error.message.trim()
  }

  return typeof error === 'string' && error.trim()
    ? error.trim()
    : 'Unknown updater error'
}

const isBenignUpdateCheckError = (error: unknown): boolean => {
  const message = getUpdaterErrorMessage(error).toLowerCase()

  if (message.includes('latest.yml') || message.includes('latest.yaml')) {
    return true
  }

  if (message.includes('no published versions')) {
    return true
  }

  if (message.includes('not found') && (message.includes('release') || message.includes('artifact') || message.includes('metadata'))) {
    return true
  }

  if (message.includes('channel') && message.includes('not found')) {
    return true
  }

  return false
}

const finalizeBenignUpdateCheck = (message: string): void => {
  setAppUpdateStatus({
    status: 'up-to-date',
    updateAvailable: false,
    downloadCompleted: false,
    message,
  })
}

const broadcastDownloadProgress = (progressPercent: number): void => {
  const normalized = Number.isFinite(progressPercent)
    ? Math.max(0, Math.min(100, progressPercent))
    : 0
  updateDownloadProgressBroadcaster?.(normalized)
}

const ensureUpdateDownloaded = async (): Promise<void> => {
  if (isUpdateDownloaded) return

  if (!updateDownloadPromise) {
    updateDownloadPromise = autoUpdater.downloadUpdate()
      .then(() => undefined)
      .catch((error) => {
        throw new Error(error instanceof Error ? error.message : 'Failed to download update')
      })
      .finally(() => {
        updateDownloadPromise = null
      })
  }

  await updateDownloadPromise

  if (!isUpdateDownloaded) {
    throw new Error('Update download did not complete yet. Please try again in a few moments.')
  }
}

const runUpdateCheck = async (): Promise<void> => {
  isUpdateCheckFinalized = false
  isUpdateDownloaded = false
  updateDownloadPromise = null
  broadcastDownloadProgress(0)
  setAppUpdateStatus({
    status: 'checking',
    updateAvailable: false,
    downloadCompleted: false,
  })
  startUpdateCheckTimeout()

  if (!app.isPackaged) {
    setAppUpdateStatus({
      status: 'up-to-date',
      updateAvailable: false,
      downloadCompleted: false,
      message: 'Development build detected. Skipping update check.',
    })
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false

  await autoUpdater.checkForUpdates()
}

const startUpdateCheckInBackground = (logContext: string): void => {
  void runUpdateCheck().catch((error) => {
    if (isBenignUpdateCheckError(error)) {
      finalizeBenignUpdateCheck('Update metadata was not published for this release. Treating as up-to-date.')
      console.warn(`${logContext} benign updater condition:`, getUpdaterErrorMessage(error))
      return
    }

    if (!isUpdateCheckFinalized) {
      setAppUpdateStatus({
        status: 'failed',
        updateAvailable: false,
        downloadCompleted: false,
        message: getUpdaterErrorMessage(error),
      })
    }
    console.error(logContext, error)
  })
}

export const registerAutoUpdaterHandlers = (ipcMain: IpcMain): void => {
  ipcMain.handle('app-update-status-get', () => {
    return getAppUpdateStatus()
  })

  ipcMain.handle('app-update-check-now', () => {
    startUpdateCheckInBackground('Failed to re-check for updates:')
    return getAppUpdateStatus()
  })

  ipcMain.handle('app-update-install-now', async () => {
    if (!app.isPackaged) {
      throw new Error('Update installation is unavailable in development builds.')
    }

    await ensureUpdateDownloaded()
    setQuitAndInstallRequested(true)
  })
}

export const registerAppUpdateDownloadProgressBroadcaster = (broadcaster: ((progressPercent: number) => void) | null): void => {
  updateDownloadProgressBroadcaster = broadcaster
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
      downloadCompleted: false,
      message: `Update check timed out after ${UPDATE_CHECK_TIMEOUT_MS / 1000} seconds.`,
    })
  }, UPDATE_CHECK_TIMEOUT_MS)
}

autoUpdater.on('checking-for-update', () => {
  if (isUpdateCheckFinalized) return
  setAppUpdateStatus({
    status: 'checking',
    updateAvailable: false,
    downloadCompleted: false,
  })
})

autoUpdater.on('update-not-available', () => {
  if (isUpdateCheckFinalized) return
  setAppUpdateStatus({
    status: 'up-to-date',
    updateAvailable: false,
    downloadCompleted: false,
  })
})

autoUpdater.on('update-available', (updateInfo) => {
  if (isUpdateCheckFinalized) return
  setAppUpdateStatus({
    status: 'update-available',
    updateAvailable: true,
    downloadCompleted: false,
    latestVersion: typeof updateInfo?.version === 'string' ? updateInfo.version : undefined,
  })
})

autoUpdater.on('update-downloaded', (updateInfo) => {
  isUpdateDownloaded = true
  broadcastDownloadProgress(100)
  setAppUpdateStatus({
    status: 'update-available',
    updateAvailable: true,
    downloadCompleted: true,
    latestVersion: typeof updateInfo?.version === 'string' ? updateInfo.version : undefined,
  })
})

autoUpdater.on('download-progress', (progressInfo) => {
  broadcastDownloadProgress(typeof progressInfo?.percent === 'number' ? progressInfo.percent : 0)
})

autoUpdater.on('error', (error) => {
  if (isUpdateCheckFinalized) return

  if (isBenignUpdateCheckError(error)) {
    finalizeBenignUpdateCheck('Update metadata was not published for this release. Treating as up-to-date.')
    console.warn('Updater reported a benign release artifact condition:', getUpdaterErrorMessage(error))
    return
  }

  setAppUpdateStatus({
    status: 'failed',
    updateAvailable: false,
    downloadCompleted: false,
    message: getUpdaterErrorMessage(error),
  })
})
