import { useCallback, useEffect, useRef, type MutableRefObject } from "react"

import type { ExternalFileChangeEvent } from "../main/electron-api"
import { createFileKey, parseFileKey } from "./utils"

const INTERNAL_SAVE_WATCHER_SUPPRESS_MS = 1500
const EVENT_COALESCE_MS = 80
const IN_FLIGHT_RETRY_ATTEMPTS = 6
const IN_FLIGHT_RETRY_DELAY_MS = 50
const DELETE_CREATE_BUFFER_MS = 250

export type ExternalWatcherOpenedFile = {
  datapackDir: string
  relativePath: string
  content?: string
}

type UseExternalFileWatcherOptions = {
  openedFiles: ExternalWatcherOpenedFile[]
  openedFilesRef: MutableRefObject<ExternalWatcherOpenedFile[]>
  onExternalFileChange: (fileKey: string) => Promise<void>
  onExternalFileDeleted: (fileKey: string) => Promise<void>
  onExternalStructureChanged: (datapackDir: string) => Promise<void>
}

export function useExternalFileWatcher({
  openedFiles,
  openedFilesRef,
  onExternalFileChange,
  onExternalFileDeleted,
  onExternalStructureChanged,
}: UseExternalFileWatcherOptions) {
  const watchedFilesRef = useRef<Map<string, { datapackDir: string; relativePath: string }>>(new Map())
  const coalescedEventTimersRef = useRef<Map<string, number>>(new Map())
  const pendingDeleteFinalizeTimersRef = useRef<Map<string, number>>(new Map())
  const recentDeleteBufferRef = useRef<Map<string, { timestamp: number; previousContent: string | null }>>(new Map())
  const pendingExternalChangeQueueRef = useRef<string[]>([])
  const pendingExternalChangeSetRef = useRef<Set<string>>(new Set())
  const isProcessingExternalChangesRef = useRef(false)
  const suppressExternalChangesUntilRef = useRef<Map<string, number>>(new Map())
  const onExternalFileChangeRef = useRef(onExternalFileChange)
  const onExternalFileDeletedRef = useRef(onExternalFileDeleted)
  const onExternalStructureChangedRef = useRef(onExternalStructureChanged)

  useEffect(() => {
    onExternalFileChangeRef.current = onExternalFileChange
  }, [onExternalFileChange])

  useEffect(() => {
    onExternalFileDeletedRef.current = onExternalFileDeleted
  }, [onExternalFileDeleted])

  useEffect(() => {
    onExternalStructureChangedRef.current = onExternalStructureChanged
  }, [onExternalStructureChanged])

  const markInternalSaveForWatcherSuppress = useCallback((fileKey: string) => {
    suppressExternalChangesUntilRef.current.set(fileKey, Date.now() + INTERNAL_SAVE_WATCHER_SUPPRESS_MS)
  }, [])

  const shouldIgnoreExternalChangeForFile = useCallback((fileKey: string): boolean => {
    const suppressUntil = suppressExternalChangesUntilRef.current.get(fileKey)
    if (!suppressUntil) return false

    if (Date.now() <= suppressUntil) {
      return true
    }

    suppressExternalChangesUntilRef.current.delete(fileKey)
    return false
  }, [])

  const wait = useCallback(async (milliseconds: number): Promise<void> => {
    await new Promise((resolve) => window.setTimeout(resolve, milliseconds))
  }, [])

  const isFileOpen = useCallback((fileKey: string): boolean => {
    return openedFilesRef.current.some((file) => createFileKey(file.datapackDir, file.relativePath) === fileKey)
  }, [openedFilesRef])

  const getOpenedFileContent = useCallback((fileKey: string): string | null => {
    const openedFile = openedFilesRef.current.find((file) => createFileKey(file.datapackDir, file.relativePath) === fileKey)
    if (!openedFile) return null
    return typeof openedFile.content === "string" ? openedFile.content : null
  }, [openedFilesRef])

  const isFileReadableOnDisk = useCallback(async (fileKey: string): Promise<boolean> => {
    const { datapackDir, relativePath } = parseFileKey(fileKey)
    const content = await window.electron.readFileIfExists(datapackDir, relativePath)
    return content !== null
  }, [])

  const runInFlightBufferStep = useCallback(async (fileKey: string): Promise<boolean> => {
    if (!isFileOpen(fileKey)) return false

    for (let attempt = 0; attempt < IN_FLIGHT_RETRY_ATTEMPTS; attempt += 1) {
      if (!isFileOpen(fileKey)) return false

      const isReadable = await isFileReadableOnDisk(fileKey)
      if (isReadable) return true

      await wait(IN_FLIGHT_RETRY_DELAY_MS)
    }

    return false
  }, [isFileOpen, isFileReadableOnDisk, wait])

  const pruneExpiredDeleteBufferEntries = useCallback(() => {
    const now = Date.now()
    for (const [fileKey, entry] of recentDeleteBufferRef.current.entries()) {
      if (now - entry.timestamp <= DELETE_CREATE_BUFFER_MS) continue
      recentDeleteBufferRef.current.delete(fileKey)
    }
  }, [])

  const bufferDeleteEvent = useCallback((fileKey: string) => {
    const previousContent = getOpenedFileContent(fileKey)
    recentDeleteBufferRef.current.set(fileKey, {
      timestamp: Date.now(),
      previousContent,
    })
  }, [getOpenedFileContent])

  const clearPendingDeleteFinalize = useCallback((fileKey: string) => {
    const timerId = pendingDeleteFinalizeTimersRef.current.get(fileKey)
    if (timerId !== undefined) {
      window.clearTimeout(timerId)
      pendingDeleteFinalizeTimersRef.current.delete(fileKey)
    }
  }, [])

  const scheduleDeleteFinalize = useCallback((fileKey: string) => {
    clearPendingDeleteFinalize(fileKey)

    const timerId = window.setTimeout(() => {
      pendingDeleteFinalizeTimersRef.current.delete(fileKey)

      void (async () => {
        const bufferedDelete = recentDeleteBufferRef.current.get(fileKey)
        if (!bufferedDelete) return

        recentDeleteBufferRef.current.delete(fileKey)
        if (!isFileOpen(fileKey)) return

        const { datapackDir } = parseFileKey(fileKey)
        await onExternalStructureChangedRef.current(datapackDir)
        await onExternalFileDeletedRef.current(fileKey)
      })()
    }, DELETE_CREATE_BUFFER_MS)

    pendingDeleteFinalizeTimersRef.current.set(fileKey, timerId)
  }, [clearPendingDeleteFinalize, isFileOpen])

  const isDeleteCreateReplacementWithoutContentChange = useCallback(async (fileKey: string): Promise<boolean> => {
    const bufferedDelete = recentDeleteBufferRef.current.get(fileKey)
    if (!bufferedDelete) return false

    const elapsed = Date.now() - bufferedDelete.timestamp
    if (elapsed > DELETE_CREATE_BUFFER_MS) {
      recentDeleteBufferRef.current.delete(fileKey)
      return false
    }

    recentDeleteBufferRef.current.delete(fileKey)

    if (bufferedDelete.previousContent === null) return false

    const { datapackDir, relativePath } = parseFileKey(fileKey)
    const diskContent = await window.electron.readFileIfExists(datapackDir, relativePath)
    if (diskContent === null) return false

    return diskContent === bufferedDelete.previousContent
  }, [])

  const processExternalFileChangeQueue = useCallback(async () => {
    if (isProcessingExternalChangesRef.current) return

    isProcessingExternalChangesRef.current = true
    try {
      while (pendingExternalChangeQueueRef.current.length > 0) {
        const nextFileKey = pendingExternalChangeQueueRef.current.shift()
        if (!nextFileKey) continue

        pendingExternalChangeSetRef.current.delete(nextFileKey)

        if (shouldIgnoreExternalChangeForFile(nextFileKey)) continue
        await onExternalFileChangeRef.current(nextFileKey)
      }
    } finally {
      isProcessingExternalChangesRef.current = false
    }
  }, [shouldIgnoreExternalChangeForFile])

  const enqueueModelReloadStep = useCallback((fileKey: string) => {
    if (shouldIgnoreExternalChangeForFile(fileKey)) return
    if (!isFileOpen(fileKey)) return

    if (pendingExternalChangeSetRef.current.has(fileKey)) return

    pendingExternalChangeSetRef.current.add(fileKey)
    pendingExternalChangeQueueRef.current.push(fileKey)
    void processExternalFileChangeQueue()
  }, [isFileOpen, processExternalFileChangeQueue, shouldIgnoreExternalChangeForFile])

  const stageCoalescedExternalEvent = useCallback((fileKey: string) => {
    if (shouldIgnoreExternalChangeForFile(fileKey)) return
    if (!isFileOpen(fileKey)) return

    const existingTimerId = coalescedEventTimersRef.current.get(fileKey)
    if (existingTimerId !== undefined) {
      window.clearTimeout(existingTimerId)
    }

    const timerId = window.setTimeout(() => {
      coalescedEventTimersRef.current.delete(fileKey)

      void (async () => {
        if (shouldIgnoreExternalChangeForFile(fileKey)) return
        if (!isFileOpen(fileKey)) return

        const isStable = await runInFlightBufferStep(fileKey)
        if (!isStable) return

        enqueueModelReloadStep(fileKey)
      })()
    }, EVENT_COALESCE_MS)

    coalescedEventTimersRef.current.set(fileKey, timerId)
  }, [enqueueModelReloadStep, isFileOpen, runInFlightBufferStep, shouldIgnoreExternalChangeForFile])

  const handleRawExternalEvent = useCallback((event: ExternalFileChangeEvent) => {
    if (!event.watchId) return

    const fileKey = event.watchId
    pruneExpiredDeleteBufferEntries()

    if (event.changeType === "delete") {
      bufferDeleteEvent(fileKey)
      scheduleDeleteFinalize(fileKey)
      return
    }

    if (event.changeType === "create") {
      void (async () => {
        clearPendingDeleteFinalize(fileKey)

        const { datapackDir } = parseFileKey(fileKey)
        await onExternalStructureChangedRef.current(datapackDir)

        const isReplacementWithoutContentChange = await isDeleteCreateReplacementWithoutContentChange(fileKey)
        if (isReplacementWithoutContentChange) {
          enqueueModelReloadStep(fileKey)
          return
        }

        stageCoalescedExternalEvent(fileKey)
      })()
      return
    }

    if (event.changeType === "update") {
      stageCoalescedExternalEvent(fileKey)
      return
    }

    stageCoalescedExternalEvent(fileKey)
  }, [bufferDeleteEvent, clearPendingDeleteFinalize, enqueueModelReloadStep, isDeleteCreateReplacementWithoutContentChange, pruneExpiredDeleteBufferEntries, scheduleDeleteFinalize, stageCoalescedExternalEvent])

  useEffect(() => {
    let isDisposed = false

    const syncFileWatches = async () => {
      const desiredFiles = new Map<string, { datapackDir: string; relativePath: string }>()
      for (const file of openedFiles) {
        const fileKey = createFileKey(file.datapackDir, file.relativePath)
        desiredFiles.set(fileKey, { datapackDir: file.datapackDir, relativePath: file.relativePath })
      }

      const currentWatchIds = [...watchedFilesRef.current.keys()]
      for (const watchId of currentWatchIds) {
        if (desiredFiles.has(watchId)) continue
        try {
          await window.electron.watchFileStop(watchId)
        } catch (error) {
          console.error("Failed to stop file watch:", error)
        } finally {
          watchedFilesRef.current.delete(watchId)
        }
      }

      for (const [watchId, file] of desiredFiles) {
        if (isDisposed) return
        if (watchedFilesRef.current.has(watchId)) continue

        try {
          await window.electron.watchFileStart(watchId, file.datapackDir, file.relativePath)
          watchedFilesRef.current.set(watchId, file)
        } catch (error) {
          console.error("Failed to start file watch:", error)
        }
      }
    }

    void syncFileWatches()

    return () => {
      isDisposed = true
    }
  }, [openedFiles])

  useEffect(() => {
    const unsubscribeExternalChange = window.electron.onFileExternalChange((event: ExternalFileChangeEvent) => {
      handleRawExternalEvent(event)
    })

    return () => {
      if (typeof unsubscribeExternalChange === "function") {
        unsubscribeExternalChange()
      }
    }
  }, [handleRawExternalEvent])

  useEffect(() => {
    return () => {
      coalescedEventTimersRef.current.forEach((timerId) => window.clearTimeout(timerId))
      coalescedEventTimersRef.current.clear()
      pendingDeleteFinalizeTimersRef.current.forEach((timerId) => window.clearTimeout(timerId))
      pendingDeleteFinalizeTimersRef.current.clear()
      recentDeleteBufferRef.current.clear()
      pendingExternalChangeQueueRef.current = []
      pendingExternalChangeSetRef.current.clear()
      watchedFilesRef.current.clear()
      void window.electron.watchFileStopAll()
    }
  }, [])

  return {
    markInternalSaveForWatcherSuppress,
  }
}
