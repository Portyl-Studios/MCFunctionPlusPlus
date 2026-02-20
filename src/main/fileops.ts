import { BrowserWindow, dialog, ipcMain } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'

// Validation helper functions
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

  const normalized = path.normalize(trimmed)

  // Validate each path segment, allowing Windows drive letters.
  const segments = normalized.split(path.sep).filter(Boolean)
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    const isDriveLetter = index === 0 && /^[A-Za-z]:$/.test(segment)

    if (isDriveLetter) continue
    if (isInvalidPathSegment(segment)) return true
  }

  return false
}

const isValidFileAccess = (filePath: string, baseDirectory: string): boolean => {
  const normalized = path.normalize(filePath)
  const resolvedPath = path.resolve(normalized)
  const resolvedBase = path.resolve(baseDirectory)

  // Ensure the file is within the base directory
  return resolvedPath.startsWith(resolvedBase)
}

// File operations
export const registerPickFolderHandler = (
  getMainWindow: () => BrowserWindow | null
) => {
  ipcMain.handle('pick-folder', async () => {
    const mainWindow = getMainWindow()
    if (!mainWindow) throw new Error('No main window')

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })
}

export const getAllFiles = async (rootDir: string): Promise<string[]> => {
  const results: string[] = []
  const entries = await fs.readdir(rootDir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name)

    if (entry.isDirectory()) {
      // Include the directory itself
      results.push(fullPath)
      const nested = await getAllFiles(fullPath)
      results.push(...nested)
    } else if (entry.isFile()) {
      results.push(fullPath)
    }
  }

  return results
}

export async function readFile(filePath: string): Promise<string> {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Invalid file path')
  }

  if (!path.isAbsolute(filePath)) {
    throw new Error('File path must be absolute')
  }

  if (/\x00/.test(filePath)) {
    throw new Error('Invalid file path')
  }

  try {
    const stats = await fs.stat(filePath)
    if (!stats.isFile()) {
      throw new Error('Path is not a file')
    }

    // Limit file size to 10MB to prevent memory issues
    if (stats.size > 10 * 1024 * 1024) {
      throw new Error('File is too large')
    }

    const contents = await fs.readFile(filePath, 'utf-8')
    return contents
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('File not found')
    }
    throw error
  }
}

export async function writeFile(directory: string, filename: string, contents: string): Promise<string> {
  // Validate inputs
  if (!directory || typeof directory !== 'string') {
    throw new Error('Invalid directory')
  }

  if (!filename || typeof filename !== 'string') {
    throw new Error('Invalid filename')
  }

  if (contents === null || contents === undefined) {
    throw new Error('Invalid contents')
  }

  if (isInvalidFilename(filename)) {
    throw new Error('Invalid filename')
  }

  if (isInvalidDirectory(directory)) {
    throw new Error('Invalid directory')
  }

  try {
    const stats = await fs.stat(directory)
    if (!stats.isDirectory()) {
      throw new Error('Path is not a directory')
    }

    const targetPath = path.join(directory, filename)

    // Ensure the target file is within the base directory
    if (!isValidFileAccess(targetPath, directory)) {
      throw new Error('Access denied')
    }

    await fs.writeFile(targetPath, contents, 'utf-8')
    return targetPath
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('Directory not found')
    }
    throw error
  }
}

export async function readFileFromDirectory(directory: string, filePath: string): Promise<string> {
  // Validate directory
  if (!directory || typeof directory !== 'string') {
    throw new Error('Invalid directory')
  }

  if (isInvalidDirectory(directory)) {
    throw new Error('Invalid directory')
  }

  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Invalid file path')
  }

  try {
    const stats = await fs.stat(directory)
    if (!stats.isDirectory()) {
      throw new Error('Base path is not a directory')
    }

    const targetPath = path.join(directory, filePath)

    // Ensure the target file is within the base directory
    if (!isValidFileAccess(targetPath, directory)) {
      throw new Error('Access denied')
    }

    return await readFile(targetPath)
  } catch (error) {
    throw error
  }
}

export async function createFolder(folderPath: string): Promise<string> {
  // Validate inputs
  if (!folderPath || typeof folderPath !== 'string') {
    throw new Error('Invalid folder path')
  }

  if (isInvalidDirectory(folderPath)) {
    throw new Error('Invalid folder path')
  }

  try {
    // Create the folder recursively (mkdir -p equivalent)
    await fs.mkdir(folderPath, { recursive: true })
    return folderPath
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('Folder already exists')
    }
    throw error
  }
}
export async function validateDatapackFolder(folderPath: string): Promise<boolean> {
  // Validate inputs
  if (!folderPath || typeof folderPath !== 'string') {
    throw new Error('Invalid folder path')
  }

  if (isInvalidDirectory(folderPath)) {
    throw new Error('Invalid folder path')
  }

  try {
    const stats = await fs.stat(folderPath)
    if (!stats.isDirectory()) {
      throw new Error('Path is not a directory')
    }

    // Check for pack.mcmeta in the root directory (not recursive)
    const packMcmetaPath = path.join(folderPath, 'pack.mcmeta')
    const packMcmetaStats = await fs.stat(packMcmetaPath)
    return packMcmetaStats.isFile()
  } catch {
    return false
  }
}

export async function renameFileOrFolder(oldPath: string, newName: string): Promise<string> {
  // Validate inputs
  if (!oldPath || typeof oldPath !== 'string') {
    throw new Error('Invalid path')
  }

  if (!newName || typeof newName !== 'string') {
    throw new Error('Invalid new name')
  }

  if (isInvalidDirectory(oldPath)) {
    throw new Error('Invalid path')
  }

  // Validate the new name doesn't contain path separators
  if (newName.includes('/') || newName.includes('\\')) {
    throw new Error('New name cannot contain path separators')
  }

  // Validate the new name as a filename
  if (isInvalidFilename(newName)) {
    throw new Error('Invalid new name')
  }

  try {
    // Check if source exists
    const stats = await fs.stat(oldPath)
    
    // Construct new path in the same directory
    const directory = path.dirname(oldPath)
    const newPath = path.join(directory, newName)

    // Check if target already exists
    try {
      await fs.stat(newPath)
      throw new Error('A file or folder with that name already exists')
    } catch (error) {
      // ENOENT is expected - target should not exist
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }

    // Rename the file or folder
    await fs.rename(oldPath, newPath)
    return newPath
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('File or folder not found')
    }
    throw error
  }
}

export async function deleteFileOrFolder(targetPath: string): Promise<void> {
  // Validate inputs
  if (!targetPath || typeof targetPath !== 'string') {
    throw new Error('Invalid path')
  }

  if (isInvalidDirectory(targetPath)) {
    throw new Error('Invalid path')
  }

  try {
    const stats = await fs.stat(targetPath)
    
    if (stats.isDirectory()) {
      // Remove directory and all contents recursively
      await fs.rm(targetPath, { recursive: true, force: true })
    } else {
      // Remove file
      await fs.unlink(targetPath)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('File or folder not found')
    }
    throw error
  }
}