import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
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
  onQuitCancelled: () => {
    isQuitRequestPending = false
  },
})
registerWorkspaceHandlers(() => mainWindow)
registerDatapackHandlers()
registerFileOperationHandlers({
  getAllowedRoots: getAllowedFileOperationRoots,
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

  mainWindow.on('closed', () => (mainWindow = null))

  // Register focused-window shortcuts
  setupWindowShortcuts(mainWindow)
})

app.on('before-quit', () => {
  isAppQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
