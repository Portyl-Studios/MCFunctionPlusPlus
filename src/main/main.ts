import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import * as parcelWatcher from '@parcel/watcher'
import { autoUpdater } from 'electron-updater'
import { fileURLToPath } from 'url'
import { registerWindowControlHandlers } from './window'
import { readFile, registerFileOperationHandlers, registerPickFolderHandler, validateDatapackFolder } from './fileops'
import { registerWorkspaceHandlers } from './workspace'
import workspaceManager from './workspace'
import { registerDatapackHandlers, datapackManager } from './datapack'
import { preferencesManager } from './preferences'

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
let hasCheckedForUpdatesThisSession = false
const fileWatchSubscriptions = new Map<string, parcelWatcher.AsyncSubscription>()

const checkForUpdatesOncePerLaunch = async (): Promise<void> => {
  if (hasCheckedForUpdatesThisSession) return
  hasCheckedForUpdatesThisSession = true

  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  try {
    await autoUpdater.checkForUpdatesAndNotify()
  } catch (error) {
    console.error('Failed to check for app updates:', error)
  }
}

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

const stopAllFileWatchesSafely = async (reason: string): Promise<void> => {
  try {
    await stopAllFileWatches()
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

registerPickFolderHandler(() => mainWindow)
registerWindowControlHandlers(() => mainWindow, {
  onQuitConfirmed: async () => {
    isAppQuitting = true
    await stopAllFileWatchesSafely('custom quit')
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

// IPC handler to add an existing datapack
ipcMain.handle('add-datapack-existing', async (_event, { datapackDir }) => {
  // Validate the folder is a datapack
  const isValidDatapack = await validateDatapackFolder(datapackDir)
  if (!isValidDatapack) {
    throw new Error('Folder does not contain a valid datapack (pack.mcmeta not found)')
  }

  // Load or create datapack metadata
  const metadata = await datapackManager.loadDatapack(datapackDir)
  
  // Get the metadata file path
  const { getDatapackMetadataPath } = await import('./datapack-parser')
  const metadataPath = getDatapackMetadataPath(datapackDir)
  
  // Add to workspace if one is loaded
  if (workspaceManager.getWorkspace()) {
    workspaceManager.addDatapack(metadataPath)
    await workspaceManager.saveWorkspace()
  }

  return {
    metadataPath,
    metadata
  }
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
  mainWindow.webContents.on('did-finish-load', emitWindowStateChanged)

  mainWindow.on('close', (event) => {
    if (isAppQuitting) return

    event.preventDefault()
    if (isQuitRequestPending) return

    if (mainWindow?.isDestroyed() || mainWindow?.webContents.isDestroyed()) {
      isAppQuitting = true
      app.quit()
      return
    }

    isQuitRequestPending = true
    mainWindow?.webContents.send('quit-requested')
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Register focused-window shortcuts
  setupWindowShortcuts(mainWindow)

  void checkForUpdatesOncePerLaunch()
})

app.on('before-quit', () => {
  isAppQuitting = true
  void stopAllFileWatchesSafely('before-quit')
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
