import { app, BrowserWindow, ipcMain } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// Replicating __dirname using ES Modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow: BrowserWindow | null = null


// Helper functions for validation
const isInvalidFilename = (filename: string): boolean => {
  const trimmed = filename.trim()

  if (!trimmed) return true
  if (trimmed === '.' || trimmed === '..') return true

  // Invalid characters for Windows filenames.
  if (/[<>:"/\\|?*]/.test(trimmed)) return true

  // Control characters are not allowed.
  if (/^[\x00-\x1F]/.test(trimmed) || /[\x00-\x1F]/.test(trimmed)) return true

  // No trailing spaces or periods.
  if (/[\.\s]$/.test(trimmed)) return true

  // Reserved device names (case-insensitive), even with extensions.
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
  if (reserved.test(trimmed)) return true

  return false
}

const isInvalidPathSegment = (segment: string): boolean => {
  const trimmed = segment.trim()

  if (!trimmed) return true
  if (trimmed === '.' || trimmed === '..') return true

  // Invalid characters for Windows path segments.
  if (/[<>:"/\\|?*]/.test(trimmed)) return true

  // Control characters are not allowed.
  if (/^[\x00-\x1F]/.test(trimmed) || /[\x00-\x1F]/.test(trimmed)) return true

  // No trailing spaces or periods.
  if (/[\.\s]$/.test(trimmed)) return true

  // Reserved device names (case-insensitive), even with extensions.
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
  if (reserved.test(trimmed)) return true

  return false
}

const isInvalidDirectory = (directory: string): boolean => {
  const trimmed = directory.trim()
  if (!trimmed) return true

  // Require absolute paths to avoid traversal or relative escapes.
  if (!path.isAbsolute(trimmed)) return true

  // Disallow null bytes.
  if (/\x00/.test(trimmed)) return true

  // Validate each path segment.
  const segments = trimmed.split(path.sep).filter(Boolean)
  for (const segment of segments) {
    if (isInvalidPathSegment(segment)) return true
  }

  return false
}


// IPC handler to write a file after validation
ipcMain.handle('write-file', async (_event, { directory, filename, contents }) => {
  // Check for invalid filename
  if (isInvalidFilename(filename)) {
    throw new Error('Invalid filename')
  }

  // Check for invalid directories
  if (isInvalidDirectory(directory)) {
    throw new Error('Invalid directory')
  }

  const stats = await fs.stat(directory)
  if (!stats.isDirectory()) {
    throw new Error('Invalid directory')
  }

  const targetPath = path.join(directory, filename)
  await fs.writeFile(targetPath, contents, 'utf-8')
  return targetPath
})

app.on('ready', () => {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, '../main/preload.js'),
      contextIsolation: true,
      nodeIntegration: false, // Disable node integration for security
      sandbox: true, // Enable the sandbox for added security
      webSecurity: true,
    },
  })

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))

  mainWindow.on('closed', () => (mainWindow = null))
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
