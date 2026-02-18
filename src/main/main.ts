import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { getAllFiles, registerPickFolderHandler } from './folderops'
import { registerWindowControlHandlers } from './window'
import { readFile, writeFile, readFileFromDirectory } from './fileops'
import { registerWorkspaceHandlers } from './workspace'

// Replicating __dirname using ES Modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const __resourcepath = app.isPackaged
  ? path.join(process.resourcesPath, 'resources')
  : path.join(__dirname, '../../resources')
const __userDataPath = app.getPath('userData')

let mainWindow: BrowserWindow | null = null

registerPickFolderHandler(() => mainWindow)
registerWindowControlHandlers(() => mainWindow)
registerWorkspaceHandlers(() => mainWindow)


// IPC handler to write a file after validation
ipcMain.handle('write-file', async (_event, { directory, filename, contents }) => {
  return await writeFile(directory, filename, contents)
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

app.on('ready', () => {
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
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
