import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { registerWindowControlHandlers } from './window'
import { readFile, writeFile, writeFileFromDirectory, readFileFromDirectory, createFolder, getAllFiles, registerPickFolderHandler, validateDatapackFolder, renameFileOrFolder, deleteFileOrFolder } from './fileops'
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

let mainWindow: BrowserWindow | null = null

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
registerWindowControlHandlers(() => mainWindow)
registerWorkspaceHandlers(() => mainWindow)
registerDatapackHandlers()

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


// IPC handler to write a file after validation
ipcMain.handle('write-file', async (_event, { directory, filename, contents }) => {
  return await writeFile(directory, filename, contents)
})

// IPC handler to save a file (similar to write-file but for existing files)
ipcMain.handle('save-file', async (_event, { directory, relativePath, contents }) => {
  return await writeFileFromDirectory(directory, relativePath, contents)
})

// IPC handler to read a file
ipcMain.handle('read-file', async (_event, { directory, filePath }) => {
  return await readFileFromDirectory(directory, filePath)
})

// IPC handler to list files in a directory
ipcMain.handle('list-files', async (_event, { directory }) => {
  if (!directory || typeof directory !== 'string') {
    throw new Error('Invalid directory')
  }
  return getAllFiles(directory)
})

// IPC handler to create a folder
ipcMain.handle('create-folder', async (_event, { folderPath }) => {
  return await createFolder(folderPath)
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

// IPC handler to reveal file in OS file explorer
ipcMain.handle('reveal-in-file-explorer', async (_event, { filePath }) => {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Invalid file path')
  }
  shell.showItemInFolder(filePath)
})

// IPC handler to rename file or folder
ipcMain.handle('rename-file-or-folder', async (_event, { oldPath, newName }) => {
  return await renameFileOrFolder(oldPath, newName)
})

// IPC handler to delete file or folder
ipcMain.handle('delete-file-or-folder', async (_event, { targetPath }) => {
  return await deleteFileOrFolder(targetPath)
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

app.on('ready', async () => {
  // Load preferences on startup
  await preferencesManager.load()

  const iconPath = path.resolve(__dirname, '../../assets/icon.ico')
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

  // In development, use Vite dev server; in production, load built files
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => (mainWindow = null))

  // Register focused-window shortcuts
  setupWindowShortcuts(mainWindow)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
