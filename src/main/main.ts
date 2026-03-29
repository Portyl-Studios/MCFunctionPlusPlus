import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import parcelWatcher from '@parcel/watcher'
import type { AsyncSubscription } from '@parcel/watcher'
import { fileURLToPath } from 'url'
import { registerWindowControlHandlers } from './window'
import { readFile, registerFileOperationHandlers, registerPickDatapackMetadataFileHandler, validateDatapackFolder } from './fileops'
import { registerWorkspaceHandlers } from './workspace'
import workspaceManager from './workspace'
import { registerDatapackHandlers, datapackManager } from './datapack'
import {
  createDefaultDatapackMetadata,
  getDatapackMetadataPath,
  parseDatapackMetadata,
  writeDatapackMetadata,
} from './datapack-parser'
import { preferencesManager } from './preferences'
import {
  broadcastAppUpdateStatus,
  registerAppUpdateDownloadProgressBroadcaster,
  registerAutoUpdaterHandlers,
  registerAppUpdateStatusBroadcaster,
} from './auto-updater'
import { quitAppRespectingInstallFlag } from './quit-manager'

// Replicating __dirname using ES Modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const __resourcepath = app.isPackaged
  ? path.join(process.resourcesPath, 'resources')
  : path.join(__dirname, '../../resources')
const __userDataPath = app.getPath('userData')

const getWindowIconPath = () => {
  if (app.isPackaged) {
    // Prefer a bundled resource path in packaged builds.
    const packagedIconPath = path.join(process.resourcesPath, 'assets', 'icon.ico')
    if (fs.existsSync(packagedIconPath)) return packagedIconPath
  }

  return path.resolve(__dirname, '../../assets/icon.ico')
}

let mainWindow: BrowserWindow | null = null
let isAppQuitting = false
let isQuitRequestPending = false
const fileWatchSubscriptions = new Map<string, AsyncSubscription>()
const directoryWatchSubscriptions = new Map<string, AsyncSubscription>()
let pendingWorkspaceFilePath: string | null = null

const getWorkspaceFilePathFromArgv = (argv: string[]): string | null => {
  for (const arg of argv) {
    if (!arg || typeof arg !== 'string') continue
    if (arg.startsWith('-')) continue
    if (!arg.toLowerCase().endsWith('.mpp-workspace')) continue
    return path.resolve(arg)
  }
  return null
}

const deliverPendingWorkspaceOpenRequest = () => {
  if (!pendingWorkspaceFilePath || !mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    return
  }

  if (mainWindow.webContents.isLoadingMainFrame()) {
    return
  }

  mainWindow.webContents.send('workspace-open-requested', {
    filePath: pendingWorkspaceFilePath,
  })
  pendingWorkspaceFilePath = null
}

const initialWorkspaceFilePath = getWorkspaceFilePathFromArgv(process.argv)
if (initialWorkspaceFilePath) {
  pendingWorkspaceFilePath = initialWorkspaceFilePath
}

const singleInstanceLock = app.requestSingleInstanceLock()
if (!singleInstanceLock) {
  app.quit()
}

app.on('second-instance', (_event, argv) => {
  const workspaceFilePath = getWorkspaceFilePathFromArgv(argv)
  if (workspaceFilePath) {
    pendingWorkspaceFilePath = workspaceFilePath
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  mainWindow.focus()
  deliverPendingWorkspaceOpenRequest()
})

app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (!filePath.toLowerCase().endsWith('.mpp-workspace')) {
    return
  }

  pendingWorkspaceFilePath = path.resolve(filePath)
  deliverPendingWorkspaceOpenRequest()
})

const normalizeComparablePath = (targetPath: string): string => {
  const resolvedPath = path.resolve(targetPath)
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath
}

const isPathWithinRoot = (targetPath: string, rootPath: string): boolean => {
  const comparablePath = normalizeComparablePath(targetPath)
  const comparableRoot = normalizeComparablePath(rootPath)
  const relativePath = path.relative(comparableRoot, comparablePath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

const assertWatchPathAllowed = (directory: string, relativePath: string): { absoluteDirectory: string; absoluteFilePath: string } => {
  if (!directory || typeof directory !== 'string' || !path.isAbsolute(directory)) {
    throw new Error('Invalid directory for file watch')
  }

  if (!relativePath || typeof relativePath !== 'string' || path.isAbsolute(relativePath)) {
    throw new Error('Invalid relative file path for file watch')
  }

  const allowedRoots = getAllowedFileOperationRoots()
  if (allowedRoots.length === 0) {
    throw new Error('File watching is unavailable until workspace or datapack context is loaded')
  }

  const absoluteDirectory = path.resolve(directory)
  const absoluteFilePath = path.resolve(absoluteDirectory, relativePath)

  const isAllowed = allowedRoots.some((root) => isPathWithinRoot(absoluteFilePath, root))
  if (!isAllowed) {
    throw new Error('File watching is only allowed within active workspace or datapack directories')
  }

  if (!isPathWithinRoot(absoluteFilePath, absoluteDirectory)) {
    throw new Error('File watch path escapes the selected datapack directory')
  }

  return {
    absoluteDirectory,
    absoluteFilePath,
  }
}

const assertWatchDirectoryAllowed = (directory: string): string => {
  if (!directory || typeof directory !== 'string' || !path.isAbsolute(directory)) {
    throw new Error('Invalid directory for directory watch')
  }

  const allowedRoots = getAllowedFileOperationRoots()
  if (allowedRoots.length === 0) {
    throw new Error('Directory watching is unavailable until workspace or datapack context is loaded')
  }

  const absoluteDirectory = path.resolve(directory)
  const isAllowed = allowedRoots.some((root) => isPathWithinRoot(absoluteDirectory, root))
  if (!isAllowed) {
    throw new Error('Directory watching is only allowed within active workspace or datapack directories')
  }

  return absoluteDirectory
}

const stopFileWatch = async (watchId: string): Promise<void> => {
  const subscription = fileWatchSubscriptions.get(watchId)
  if (!subscription) return

  fileWatchSubscriptions.delete(watchId)
  await subscription.unsubscribe()
}

const stopAllFileWatches = async (): Promise<void> => {
  const watchIds = [...fileWatchSubscriptions.keys()]
  await Promise.all(watchIds.map((watchId) => stopFileWatch(watchId)))
}

const stopDirectoryWatch = async (watchId: string): Promise<void> => {
  const subscription = directoryWatchSubscriptions.get(watchId)
  if (!subscription) return

  directoryWatchSubscriptions.delete(watchId)
  await subscription.unsubscribe()
}

const stopAllDirectoryWatches = async (): Promise<void> => {
  const watchIds = [...directoryWatchSubscriptions.keys()]
  await Promise.all(watchIds.map((watchId) => stopDirectoryWatch(watchId)))
}

const stopAllFileWatchesSafely = async (reason: string): Promise<void> => {
  try {
    await stopAllFileWatches()
    await stopAllDirectoryWatches()
  } catch (error) {
    console.error(`Failed to stop file watches during ${reason}:`, error)
  }
}

const getAllowedFileOperationRoots = (): string[] => {
  const roots = new Set<string>()

  const workspaceDir = workspaceManager.getWorkspaceDir()
  const resolvedWorkspaceDir = workspaceDir && path.isAbsolute(workspaceDir)
    ? path.resolve(workspaceDir)
    : null

  if (workspaceDir && path.isAbsolute(workspaceDir)) {
    roots.add(resolvedWorkspaceDir!)
  }

  for (const metadataPath of workspaceManager.getDatapacks()) {
    if (typeof metadataPath !== 'string') continue

    if (path.isAbsolute(metadataPath)) {
      roots.add(path.dirname(path.resolve(metadataPath)))
      continue
    }

    if (resolvedWorkspaceDir) {
      roots.add(path.dirname(path.resolve(resolvedWorkspaceDir, metadataPath)))
    }
  }

  const currentDatapackDir = datapackManager.getDatapackDir()
  if (currentDatapackDir && path.isAbsolute(currentDatapackDir)) {
    roots.add(path.resolve(currentDatapackDir))
  }

  return [...roots]
}

const setupWindowShortcuts = (window: BrowserWindow): void => {
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return

    const hasModifier = input.control || input.meta
    if (!hasModifier) return

    const key = input.key.toLowerCase()
    const sendShortcut = (action: string) => {
      event.preventDefault()
      window.webContents.send('shortcut', action)
    }

    if (key === 'q') {
      sendShortcut('quit')
      return
    }

    if (key === 'o') {
      sendShortcut('open')
      return
    }

    if (key === 's' && input.shift) {
      sendShortcut('saveAll')
      return
    }

    if (key === 's') {
      sendShortcut('save')
      return
    }

    if (key === 'w') {
      sendShortcut('close')
    }
  })
}

registerPickDatapackMetadataFileHandler(() => mainWindow)
registerWindowControlHandlers(() => mainWindow, {
  onQuitConfirmed: async () => {
    isAppQuitting = true
    await stopAllFileWatchesSafely('custom quit')
    return false
  },
  onQuitCancelled: () => {
    isQuitRequestPending = false
  },
})
registerWorkspaceHandlers(() => mainWindow)
registerDatapackHandlers()
registerFileOperationHandlers({
  getAllowedRoots: getAllowedFileOperationRoots,
})

ipcMain.handle('watch-file-start', async (_event, { watchId, directory, relativePath }) => {
  if (!watchId || typeof watchId !== 'string') {
    throw new Error('Invalid file watch id')
  }

  const { absoluteFilePath } = assertWatchPathAllowed(directory, relativePath)
  const parentDirectory = path.dirname(absoluteFilePath)
  const comparableTargetPath = normalizeComparablePath(absoluteFilePath)

  await stopFileWatch(watchId)

  const subscription = await parcelWatcher.subscribe(parentDirectory, (error, events) => {
    if (error) {
      console.error(`File watch failed for ${watchId}:`, error)
      return
    }

    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
      return
    }

    for (const event of events) {
      const comparableEventPath = normalizeComparablePath(event.path)
      if (comparableEventPath !== comparableTargetPath) continue

      if (event.type !== 'update' && event.type !== 'create' && event.type !== 'delete') continue

      mainWindow.webContents.send('file-external-change', {
        watchId,
        changeType: event.type,
      })
    }
  })

  fileWatchSubscriptions.set(watchId, subscription)
})

ipcMain.handle('watch-file-stop', async (_event, { watchId }) => {
  if (!watchId || typeof watchId !== 'string') return
  await stopFileWatch(watchId)
})

ipcMain.handle('watch-file-stop-all', async () => {
  await stopAllFileWatches()
})

ipcMain.handle('watch-directory-start', async (_event, { watchId, directory }) => {
  if (!watchId || typeof watchId !== 'string') {
    throw new Error('Invalid directory watch id')
  }

  const absoluteDirectory = assertWatchDirectoryAllowed(directory)

  await stopDirectoryWatch(watchId)

  const subscription = await parcelWatcher.subscribe(absoluteDirectory, (error, events) => {
    if (error) {
      console.error(`Directory watch failed for ${watchId}:`, error)
      return
    }

    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
      return
    }

    for (const event of events) {
      if (event.type !== 'update' && event.type !== 'create' && event.type !== 'delete') continue

      mainWindow.webContents.send('directory-external-change', {
        watchId,
        changeType: event.type,
        path: event.path,
      })
    }
  })

  directoryWatchSubscriptions.set(watchId, subscription)
})

ipcMain.handle('watch-directory-stop', async (_event, { watchId }) => {
  if (!watchId || typeof watchId !== 'string') return
  await stopDirectoryWatch(watchId)
})

ipcMain.handle('watch-directory-stop-all', async () => {
  await stopAllDirectoryWatches()
})

registerAutoUpdaterHandlers(ipcMain)

// IPC handler to get or create default workspace
ipcMain.handle('workspace-get-or-create-default', async () => {
  try {
    const workspaceDir = __userDataPath
    const workspaceName = 'default'
    const workspace = await workspaceManager.loadWorkspace(workspaceDir, workspaceName)
    return {
      dir: workspaceDir,
      name: workspaceName,
      workspace
    }
  } catch (error) {
    throw new Error(`Failed to get or create default workspace: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
})

ipcMain.handle('workspace-launch-path-consume', async () => {
  const filePath = pendingWorkspaceFilePath
  pendingWorkspaceFilePath = null
  return filePath
})

const buildDefaultDatapackMetadata = async (datapackDir: string, selectedMcmetaPath?: string) => {
  const datapackName = path.basename(datapackDir)
  const sanitizedId = datapackName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 2).toUpperCase() || 'DP'
  const metadata = createDefaultDatapackMetadata(datapackName, sanitizedId)

  if (selectedMcmetaPath) {
    try {
      const mcmetaRaw = await readFile(selectedMcmetaPath)
      const parsedMcmeta = JSON.parse(mcmetaRaw)
      const packNode = parsedMcmeta?.pack

      if (packNode && typeof packNode === 'object') {
        const rawDescription = (packNode as { description?: unknown }).description
        if (typeof rawDescription === 'string' && rawDescription.trim()) {
          metadata.description = rawDescription.trim()
        } else if (rawDescription && typeof rawDescription === 'object') {
          const textDescription = (rawDescription as { text?: unknown }).text
          if (typeof textDescription === 'string' && textDescription.trim()) {
            metadata.description = textDescription.trim()
          } else {
            metadata.description = JSON.stringify(rawDescription)
          }
        }

        const directPackFormat = (packNode as { pack_format?: unknown }).pack_format
        if (typeof directPackFormat === 'number' && Number.isFinite(directPackFormat)) {
          metadata.packFormatVersionMin = directPackFormat
          metadata.packFormatVersionMax = directPackFormat
        }

        const supportedFormats = (packNode as { supported_formats?: unknown }).supported_formats
        if (typeof supportedFormats === 'number' && Number.isFinite(supportedFormats)) {
          metadata.packFormatVersionMin = supportedFormats
          metadata.packFormatVersionMax = supportedFormats
        } else if (Array.isArray(supportedFormats) && supportedFormats.length === 2) {
          const [minFormat, maxFormat] = supportedFormats
          if (typeof minFormat === 'number' && Number.isFinite(minFormat)) {
            metadata.packFormatVersionMin = minFormat
          }
          if (typeof maxFormat === 'number' && Number.isFinite(maxFormat)) {
            metadata.packFormatVersionMax = maxFormat
          }
        } else if (supportedFormats && typeof supportedFormats === 'object') {
          const minInclusive = (supportedFormats as { min_inclusive?: unknown }).min_inclusive
          const maxInclusive = (supportedFormats as { max_inclusive?: unknown }).max_inclusive
          if (typeof minInclusive === 'number' && Number.isFinite(minInclusive)) {
            metadata.packFormatVersionMin = minInclusive
          }
          if (typeof maxInclusive === 'number' && Number.isFinite(maxInclusive)) {
            metadata.packFormatVersionMax = maxInclusive
          }
        }
      }
    } catch (error) {
      console.warn('Failed to parse selected pack.mcmeta file while creating metadata:', error)
    }
  }

  return metadata
}

const ensureDatapackMetadata = async (datapackDir: string, preferredMcmetaPath?: string) => {
  let metadata = await parseDatapackMetadata(datapackDir)
  let created = false

  if (!metadata) {
    let mcmetaPathForExtraction: string | undefined = preferredMcmetaPath
    if (!mcmetaPathForExtraction) {
      const enabledMcmetaPath = path.join(datapackDir, 'pack.mcmeta')
      const disabledMcmetaPath = path.join(datapackDir, 'pack.mcmeta.disabled')
      if (fs.existsSync(enabledMcmetaPath)) {
        mcmetaPathForExtraction = enabledMcmetaPath
      } else if (fs.existsSync(disabledMcmetaPath)) {
        mcmetaPathForExtraction = disabledMcmetaPath
      }
    }

    metadata = await buildDefaultDatapackMetadata(datapackDir, mcmetaPathForExtraction)
    await writeDatapackMetadata(datapackDir, metadata)
    created = true
  }

  return {
    metadataPath: getDatapackMetadataPath(datapackDir),
    metadata,
    created,
  }
}

ipcMain.handle('add-datapack-from-metadata', async (_event, { metadataPath }) => {
  if (!metadataPath || typeof metadataPath !== 'string') {
    throw new Error('Invalid metadata path')
  }

  const selectedFileName = path.basename(metadataPath).toLowerCase()
  const isMppMetadata = selectedFileName === '.mpp-datapack'
  const isPackMcmeta = selectedFileName === 'pack.mcmeta' || selectedFileName === 'pack.mcmeta.disabled'

  if (!isMppMetadata && !isPackMcmeta) {
    throw new Error('Selected file must be .mpp-datapack, pack.mcmeta, or pack.mcmeta.disabled')
  }

  const datapackDir = path.dirname(metadataPath)
  const isValidDatapack = await validateDatapackFolder(datapackDir)
  if (!isValidDatapack) {
    throw new Error('Datapack folder is invalid for the selected metadata file')
  }

  const ensured = await ensureDatapackMetadata(datapackDir, isPackMcmeta ? metadataPath : undefined)

  if (workspaceManager.getWorkspace()) {
    workspaceManager.addDatapack(ensured.metadataPath)
    await workspaceManager.saveWorkspace()
  }

  return {
    metadataPath: ensured.metadataPath,
    metadata: ensured.metadata,
  }
})

ipcMain.handle('datapack-ensure-metadata', async (_event, { datapackDir }) => {
  if (!datapackDir || typeof datapackDir !== 'string') {
    throw new Error('Invalid datapack directory')
  }

  const isValidDatapack = await validateDatapackFolder(datapackDir)
  if (!isValidDatapack) {
    throw new Error('Folder does not contain a valid datapack (pack.mcmeta or pack.mcmeta.disabled not found)')
  }

  return await ensureDatapackMetadata(datapackDir)
})

// IPC handlers for preferences
ipcMain.handle('preferences-get', async (_event, { key }) => {
  return await preferencesManager.get(key)
})

ipcMain.handle('preferences-set', async (_event, { key, value }) => {
  return await preferencesManager.set(key, value)
})

ipcMain.handle('preferences-update', async (_event, { updates }) => {
  return await preferencesManager.update(updates)
})

ipcMain.handle('command-schema-get', async (_event, { version }) => {
  if (!version || typeof version !== 'string') {
    throw new Error('Invalid command schema version')
  }

  const normalizedVersion = version.trim()
  if (!/^[0-9]+(?:\.[0-9]+)*$/.test(normalizedVersion)) {
    throw new Error('Invalid command schema version format')
  }

  const schemaPath = path.join(__resourcepath, 'minecraft', normalizedVersion, 'commands.json')
  return await readFile(schemaPath)
})

ipcMain.handle('minecraft-data-get', async (_event, { version, dataType }) => {
  if (!version || typeof version !== 'string') {
    throw new Error('Invalid Minecraft data version')
  }

  if (!dataType || typeof dataType !== 'string') {
    throw new Error('Invalid data type')
  }

  const normalizedVersion = version.trim()
  if (!/^[0-9]+(?:\.[0-9]+)*$/.test(normalizedVersion)) {
    throw new Error('Invalid Minecraft data version format')
  }

  const normalizedDataType = dataType.trim()
  if (!/^[a-z_]+$/.test(normalizedDataType)) {
    throw new Error('Invalid data type format')
  }

  const dataPath = path.join(__resourcepath, 'minecraft', normalizedVersion, `${normalizedDataType}.json`)
  return await readFile(dataPath)
})

app.on('ready', async () => {
  if (!singleInstanceLock) {
    return
  }

  // Load preferences on startup
  await preferencesManager.load()

  const iconPath = getWindowIconPath()
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    frame: false,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false, // Disable node integration for security
      sandbox: true, // Enable the sandbox for added security
      webSecurity: true,
    },
  })

  const savedWindowPrefs = await preferencesManager.get('window')
  if (savedWindowPrefs?.isFullScreen) {
    mainWindow.maximize()
  }

  registerAppUpdateStatusBroadcaster((status) => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
    mainWindow.webContents.send('app-update-status-changed', status)
  })

  registerAppUpdateDownloadProgressBroadcaster((progressPercent) => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
    mainWindow.webContents.send('app-update-download-progress', progressPercent)
  })

  // In development, use Vite dev server; in production, load built files
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  const emitWindowStateChanged = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const isWindowExpanded = mainWindow.isFullScreen() || mainWindow.isMaximized()
    mainWindow.webContents.send('fullscreen-changed', isWindowExpanded)
    void preferencesManager.update({
      window: {
        isFullScreen: isWindowExpanded,
      },
    }).catch((error) => {
      console.error('Failed to persist fullscreen preference:', error)
    })
  }

  mainWindow.on('maximize', emitWindowStateChanged)
  mainWindow.on('unmaximize', emitWindowStateChanged)
  mainWindow.on('enter-full-screen', emitWindowStateChanged)
  mainWindow.on('leave-full-screen', emitWindowStateChanged)
  mainWindow.on('system-context-menu', (event, point) => {
    event.preventDefault()
    if (!mainWindow || mainWindow.isDestroyed()) return
    const bounds = mainWindow.getBounds()
    mainWindow.webContents.send('titlebar-context-menu', {
      x: point.x - bounds.x,
      y: point.y - bounds.y,
    })
  })
  mainWindow.webContents.on('did-finish-load', () => {
    emitWindowStateChanged()
    broadcastAppUpdateStatus(mainWindow)
    // set initial app update status
    deliverPendingWorkspaceOpenRequest()
  })

  mainWindow.on('close', (event) => {
    if (isAppQuitting) return

    event.preventDefault()
    if (isQuitRequestPending) return

    if (mainWindow?.isDestroyed() || mainWindow?.webContents.isDestroyed()) {
      isAppQuitting = true
      quitAppRespectingInstallFlag()
      return
    }

    isQuitRequestPending = true
    mainWindow?.webContents.send('quit-requested')
  })

  mainWindow.on('closed', () => {
    registerAppUpdateStatusBroadcaster(null)
    registerAppUpdateDownloadProgressBroadcaster(null)
    mainWindow = null
  })

  // Register focused-window shortcuts
  setupWindowShortcuts(mainWindow)
})

app.on('before-quit', () => {
  isAppQuitting = true
  void stopAllFileWatchesSafely('before-quit')
})

app.on('will-quit', () => {
  isQuitRequestPending = false
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') quitAppRespectingInstallFlag()
})
