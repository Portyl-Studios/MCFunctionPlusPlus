import { useEffect, useRef, useState } from "react"
import type { AppUpdateStatus } from "../main/electron-api"
import { showToastEvent } from "./overlays/toast-events"

type UpdateDialogButton = {
  label: string
  onClick: () => void | Promise<void>
}

type UpdateDialogConfig = {
  title: string
  message: string
  buttons: UpdateDialogButton[]
}

type UpdateDialogApi = {
  isOpen: boolean
  openDialog: (config: UpdateDialogConfig) => void
  showAlert: (title: string, message: string) => Promise<void>
}

type UseAppUpdateParams = {
  dialog: UpdateDialogApi
  modifiedFilesCount: number
  saveAllFiles: () => Promise<boolean>
}

type UseAppUpdateResult = {
  appUpdateStatus: AppUpdateStatus
  hasPendingAppUpdate: boolean
  appUpdateTooltipContent: string
  isManualUpdateCheckInProgress: boolean
  handleManualUpdateCheck: () => Promise<void>
}

const defaultAppUpdateStatus: AppUpdateStatus = {
  status: "checking",
  updateAvailable: false,
  downloadCompleted: false,
}

const compareSemver = (left: string, right: string): number => {
  const toParts = (value: string) => value.split(".").map((part) => Number.parseInt(part, 10) || 0)
  const leftParts = toParts(left)
  const rightParts = toParts(right)
  const maxLength = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts[index] ?? 0
    const rightValue = rightParts[index] ?? 0
    if (leftValue > rightValue) return 1
    if (leftValue < rightValue) return -1
  }

  return 0
}

const getUpdateStatusMessage = (status: AppUpdateStatus): string => {
  if (status.status === "checking") {
    return "MCFunction++ is checking for updates."
  }

  if (status.status === "up-to-date") {
    return status.message ?? "You are running the latest version."
  }

  if (status.status === "update-available") {
    if (!status.downloadCompleted) {
      if (status.latestVersion) {
        return `Version ${status.latestVersion} found. Download started.`
      }
      return "A new version was found. Download started."
    }

    if (status.latestVersion) {
      return `Version ${status.latestVersion} finished downloading and is ready to install.`
    }
    return "A new version finished downloading and is ready to install."
  }

  return status.message ?? "Update check did not complete within 10 seconds."
}

export const useAppUpdate = ({ dialog, modifiedFilesCount, saveAllFiles }: UseAppUpdateParams): UseAppUpdateResult => {
  const [appUpdateStatus, setAppUpdateStatus] = useState<AppUpdateStatus>(defaultAppUpdateStatus)
  const [deferredUpdateVersion, setDeferredUpdateVersion] = useState<string | null>(null)
  const [isManualUpdateCheckInProgress, setIsManualUpdateCheckInProgress] = useState(false)
  const [isUpdateNowInProgress, setIsUpdateNowInProgress] = useState(false)

  const lastAppUpdateToastKeyRef = useRef<string | null>(null)
  const deferredUpdateVersionRef = useRef<string | null>(deferredUpdateVersion)
  const updatePromptOpenRef = useRef(false)
  const promptedUpdateVersionRef = useRef<string | null>(null)

  useEffect(() => {
    deferredUpdateVersionRef.current = deferredUpdateVersion
  }, [deferredUpdateVersion])

  const saveDeferredUpdateVersion = async (version: string | null) => {
    const normalizedVersion = version && version.trim().length > 0 ? version.trim() : null
    setDeferredUpdateVersion(normalizedVersion)

    const existingPrefs = await window.electron.preferencesGet("updates")
    await window.electron.preferencesSet("updates", {
      ...existingPrefs,
      deferredVersion: normalizedVersion ?? undefined,
    })
  }

  const shouldPromptForUpdateVersion = (latestVersion?: string): boolean => {
    if (!latestVersion || !latestVersion.trim()) return true
    if (!deferredUpdateVersionRef.current) return true
    return compareSemver(latestVersion, deferredUpdateVersionRef.current) > 0
  }

  const requestQuitWithOptionalUpdateInstall = async (prepareUpdateInstallNow: boolean): Promise<void> => {
    const prepareIfNeeded = async (): Promise<boolean> => {
      if (!prepareUpdateInstallNow) return true

      try {
        await window.electron.prepareAppUpdateInstallNow()
        return true
      } catch (error) {
        console.error("Failed to prepare update install:", error)
        await dialog.showAlert("Update Not Ready", error instanceof Error ? error.message : "Failed to prepare app update.")
        return false
      }
    }

    if (prepareUpdateInstallNow) {
      const shouldQuit = await prepareIfNeeded()
      if (!shouldQuit) return
      await window.electron.quit()
      return
    }

    if (modifiedFilesCount === 0) {
      const shouldQuit = await prepareIfNeeded()
      if (!shouldQuit) return
      await window.electron.quit()
      return
    }

    await new Promise<void>((resolve) => {
      dialog.openDialog({
        title: "Unsaved Changes",
        message: `You have ${modifiedFilesCount} unsaved file(s). Do you want to save before quitting?`,
        buttons: [
          {
            label: "Save",
            onClick: async () => {
              const didSave = await saveAllFiles()
              if (!didSave) {
                resolve()
                return
              }

              const shouldQuit = await prepareIfNeeded()
              if (shouldQuit) {
                await window.electron.quit()
              }
              resolve()
            },
          },
          {
            label: "Discard",
            onClick: async () => {
              const shouldQuit = await prepareIfNeeded()
              if (shouldQuit) {
                await window.electron.quit()
              }
              resolve()
            },
          },
          {
            label: "Cancel",
            onClick: () => {
              resolve()
            },
          },
        ],
      })
    })
  }

  const handleUpdateNow = async (latestVersion?: string) => {
    setIsUpdateNowInProgress(true)

    try {
      promptedUpdateVersionRef.current = latestVersion ?? null
      await saveDeferredUpdateVersion(null)
      await requestQuitWithOptionalUpdateInstall(true)
    } catch (error) {
      console.error("Failed to run update-now action:", error)
      await dialog.showAlert("Error", `Failed to start update: ${error instanceof Error ? error.message : "Unknown error"}`)
    } finally {
      setIsUpdateNowInProgress(false)
    }
  }

  const handleUpdateLater = async (latestVersion?: string) => {
    if (!latestVersion) {
      return
    }

    try {
      await saveDeferredUpdateVersion(latestVersion)
      promptedUpdateVersionRef.current = latestVersion
      showToastEvent(`Update ${latestVersion} deferred.`)
    } catch (error) {
      console.error("Failed to defer update:", error)
      await dialog.showAlert("Error", `Failed to defer update: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }

  const handleManualUpdateCheck = async () => {
    if (isManualUpdateCheckInProgress) return

    setIsManualUpdateCheckInProgress(true)
    promptedUpdateVersionRef.current = null

    try {
      await saveDeferredUpdateVersion(null)
      const status = await window.electron.checkAppUpdateNow()
      setAppUpdateStatus(status)
      const toastKey = `${status.status}|${status.updateAvailable}|${status.latestVersion ?? ""}|${status.message ?? ""}`
      lastAppUpdateToastKeyRef.current = toastKey
      showToastEvent(getUpdateStatusMessage(status))
    } catch (error) {
      console.error("Failed to manually check for updates:", error)
      await dialog.showAlert("Error", `Failed to check for updates: ${error instanceof Error ? error.message : "Unknown error"}`)
    } finally {
      setIsManualUpdateCheckInProgress(false)
    }
  }

  useEffect(() => {
    const loadUpdatePreferences = async () => {
      try {
        const updatesPrefs = await window.electron.preferencesGet("updates")
        if (typeof updatesPrefs?.deferredVersion === "string" && updatesPrefs.deferredVersion.trim()) {
          setDeferredUpdateVersion(updatesPrefs.deferredVersion)
        } else {
          setDeferredUpdateVersion(null)
        }
      } catch (error) {
        console.error("Failed to load update preferences:", error)
        await dialog.showAlert("Error", `Failed to load update preferences: ${error instanceof Error ? error.message : "Unknown error"}`)
      }
    }

    void loadUpdatePreferences()
  }, [])

  useEffect(() => {
    let isDisposed = false

    const notifyUpdateStatus = (status: AppUpdateStatus) => {
      if (status.status === "checking") return

      if (status.status === "update-available" && status.downloadCompleted) {
        const latestVersion = status.latestVersion
        const deferredVersion = deferredUpdateVersionRef.current

        if (latestVersion?.trim() && deferredVersion && compareSemver(latestVersion, deferredVersion) <= 0) {
          return
        }
      }

      const toastKey = `${status.status}|${status.updateAvailable}|${status.downloadCompleted ? "downloaded" : "discovering"}|${status.latestVersion ?? ""}|${status.message ?? ""}`
      if (lastAppUpdateToastKeyRef.current === toastKey) return

      lastAppUpdateToastKeyRef.current = toastKey
      showToastEvent(getUpdateStatusMessage(status))
    }

    const syncInitialUpdateStatus = async () => {
      try {
        const status = await window.electron.getAppUpdateStatus()
        if (!isDisposed) {
          setAppUpdateStatus(status)
          notifyUpdateStatus(status)
        }
      } catch (error) {
        console.error("Failed to get app update status:", error)
        if (!isDisposed) {
          const failedStatus: AppUpdateStatus = {
            status: "failed",
            updateAvailable: false,
            message: "Unable to fetch update status from the main process.",
          }
          setAppUpdateStatus(failedStatus)
          notifyUpdateStatus(failedStatus)
        }
        return
      }

      try {
        await window.electron.checkAppUpdateNow()
      } catch (error) {
        console.error("Failed to start startup update check:", error)
        if (!isDisposed) {
          const failedStatus: AppUpdateStatus = {
            status: "failed",
            updateAvailable: false,
            message: "Unable to start startup update check.",
          }
          setAppUpdateStatus(failedStatus)
          notifyUpdateStatus(failedStatus)
        }
      }
    }

    const unsubscribe = window.electron.onAppUpdateStatusChange((status: AppUpdateStatus) => {
      if (isDisposed) return
      setAppUpdateStatus(status)
      notifyUpdateStatus(status)
    })

    void syncInitialUpdateStatus()

    return () => {
      isDisposed = true
      if (typeof unsubscribe === "function") {
        unsubscribe()
      }
    }
  }, [])

  useEffect(() => {
    if (!dialog.isOpen) {
      updatePromptOpenRef.current = false
    }
  }, [dialog.isOpen])

  useEffect(() => {
    if (appUpdateStatus.status !== "update-available") return
    if (!appUpdateStatus.updateAvailable) return
    if (!appUpdateStatus.downloadCompleted) return
    if (isUpdateNowInProgress) return

    const latestVersion = appUpdateStatus.latestVersion
    if (!shouldPromptForUpdateVersion(latestVersion)) return
    if (updatePromptOpenRef.current) return
    if (latestVersion && promptedUpdateVersionRef.current === latestVersion) return

    updatePromptOpenRef.current = true
    if (latestVersion) {
      promptedUpdateVersionRef.current = latestVersion
    }

    dialog.openDialog({
      title: "Update Available",
      message: latestVersion
        ? `Version ${latestVersion} is ready. Would you like to update now or later?`
        : "A new version is ready. Would you like to update now or later?",
      buttons: [
        {
          label: "Update Now",
          onClick: async () => {
            updatePromptOpenRef.current = false
            await handleUpdateNow(latestVersion)
          },
        },
        {
          label: "Update Later",
          onClick: async () => {
            updatePromptOpenRef.current = false
            await handleUpdateLater(latestVersion)
          },
        },
      ],
    })
  }, [appUpdateStatus, isUpdateNowInProgress, dialog])

  const hasPendingAppUpdate = appUpdateStatus.updateAvailable
  const appUpdateTooltipContent = hasPendingAppUpdate
    ? `New version${appUpdateStatus.latestVersion ? ` (${appUpdateStatus.latestVersion})` : ""} available. Click to check updates.`
    : "Check for updates"

  return {
    appUpdateStatus,
    hasPendingAppUpdate,
    appUpdateTooltipContent,
    isManualUpdateCheckInProgress,
    handleManualUpdateCheck,
  }
}
