import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { wait } from './utils'

const FILE_BUSY_RETRY_ATTEMPTS = 4
const FILE_BUSY_RETRY_BASE_DELAY_MS = 120
const RETRIABLE_FILE_BUSY_CODES = new Set(['EBUSY', 'EMFILE', 'ENFILE', 'EAGAIN'])
const MAYBE_RETRIABLE_FILE_BUSY_CODES = new Set(['EPERM', 'EACCES'])

const isRetriableFileBusyError = (error: unknown): error is NodeJS.ErrnoException => {
  if (!error || typeof error !== 'object') return false

  const errno = error as NodeJS.ErrnoException
  if (errno.code && RETRIABLE_FILE_BUSY_CODES.has(errno.code)) {
    return true
  }

  const message = typeof errno.message === 'string' ? errno.message.toLowerCase() : ''
  const hasBusyIndicator =
    message.includes('resource busy') ||
    message.includes('used by another process') ||
    message.includes('in use') ||
    message.includes('locked')

  if (errno.code && MAYBE_RETRIABLE_FILE_BUSY_CODES.has(errno.code)) {
    return hasBusyIndicator
  }

  return hasBusyIndicator
}

const createBusyRetryError = (operationName: string, cause: NodeJS.ErrnoException): NodeJS.ErrnoException => {
  const retryError = new Error(
    `${operationName} failed because the file is busy after ${FILE_BUSY_RETRY_ATTEMPTS} attempts. Close apps that may be using it and try again.`,
  ) as NodeJS.ErrnoException
  retryError.code = 'EBUSY'
  retryError.cause = cause
  return retryError
}

const withFileBusyRetry = async <T>(operationName: string, operation: () => Promise<T>): Promise<T> => {
  let lastBusyError: NodeJS.ErrnoException | null = null

  for (let attempt = 1; attempt <= FILE_BUSY_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (!isRetriableFileBusyError(error)) {
        throw error
      }

      lastBusyError = error
      if (attempt >= FILE_BUSY_RETRY_ATTEMPTS) {
        break
      }

      await wait(FILE_BUSY_RETRY_BASE_DELAY_MS * attempt)
    }
  }

  throw createBusyRetryError(operationName, lastBusyError ?? ({ code: 'EBUSY' } as NodeJS.ErrnoException))
}

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

  const comparablePath = process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath
  const comparableBase = process.platform === 'win32' ? resolvedBase.toLowerCase() : resolvedBase
  const relativePath = path.relative(comparableBase, comparablePath)

  // Treat base itself and descendants as valid, and reject traversal outside the base.
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

const isAbsolutePath = (value: unknown): value is string => {
  return typeof value === 'string' && path.isAbsolute(value) && !/\x00/.test(value)
}

const isPathWithinRoot = (targetPath: string, rootPath: string): boolean => {
  const resolvedPath = path.resolve(targetPath)
  const resolvedRoot = path.resolve(rootPath)
  const comparablePath = process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath
  const comparableRoot = process.platform === 'win32' ? resolvedRoot.toLowerCase() : resolvedRoot
  const relativePath = path.relative(comparableRoot, comparablePath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

const assertPathAllowedForFileOperation = (
  targetPath: unknown,
  actionName: string,
  allowedRoots: string[] | undefined,
): string => {
  if (!isAbsolutePath(targetPath)) {
    throw new Error(`Invalid path for ${actionName}`)
  }

  // Deny by default when allowed roots are unavailable.
  if (!allowedRoots || allowedRoots.length === 0) {
    throw new Error(`${actionName} is unavailable until workspace or datapack context is loaded`)
  }

  const isAllowed = allowedRoots.some((root) => isPathWithinRoot(targetPath, root))
  if (!isAllowed) {
    throw new Error(`${actionName} is only allowed within active workspace or datapack directories`)
  }

  return targetPath
}

type FileOperationHandlerOptions = {
  getAllowedRoots?: () => string[]
}

// File operations
export const registerPickDatapackMetadataFileHandler = (
  getMainWindow: () => BrowserWindow | null,
) => {
  ipcMain.handle('pick-datapack-metadata-file', async () => {
    const mainWindow = getMainWindow()
    if (!mainWindow) throw new Error('No main window')

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Datapack Metadata Files', extensions: ['mpp-datapack', 'mcmeta', 'disabled'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })
}

export const getAllFiles = async (rootDir: string): Promise<string[]> => {
  const results: string[] = []
  const entries = await withFileBusyRetry('List files', () => fs.readdir(rootDir, { withFileTypes: true }))

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
    const stats = await withFileBusyRetry('Inspect file', () => fs.stat(filePath))
    if (!stats.isFile()) {
      throw new Error('Path is not a file')
    }

    // Limit file size to 10MB to prevent memory issues
    if (stats.size > 10 * 1024 * 1024) {
      throw new Error('File is too large')
    }

    const contents = await withFileBusyRetry('Read file', () => fs.readFile(filePath, 'utf-8'))
    return contents
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('File not found')
    }
    throw error
  }
}

// Writes a file directly inside a base directory using a single filename.
// This is intended for create/new-file style flows where path separators are not allowed.
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
    const stats = await withFileBusyRetry('Inspect directory', () => fs.stat(directory))
    if (!stats.isDirectory()) {
      throw new Error('Path is not a directory')
    }

    const targetPath = path.join(directory, filename)

    // Ensure the target file is within the base directory
    if (!isValidFileAccess(targetPath, directory)) {
      throw new Error('Access denied')
    }

    await withFileBusyRetry('Write file', () => fs.writeFile(targetPath, contents, 'utf-8'))
    return targetPath
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('Directory not found')
    }
    throw error
  }
}

// Writes a file inside a base directory using a relative path.
// This is intended for save/update flows where nested paths like "folder/file.ext" are allowed.
export async function writeFileFromDirectory(directory: string, filePath: string, contents: string): Promise<string> {
  // Validate directory
  if (!directory || typeof directory !== 'string') {
    throw new Error('Invalid directory')
  }

  if (isInvalidDirectory(directory)) {
    throw new Error('Invalid directory')
  }

  // Validate relative file path
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Invalid file path')
  }

  if (contents === null || contents === undefined) {
    throw new Error('Invalid contents')
  }

  const normalizedRelativePath = filePath.replace(/\\/g, '/').replace(/^\/+/, '')
  const segments = normalizedRelativePath.split('/').filter(Boolean)
  if (segments.length === 0) {
    throw new Error('Invalid file path')
  }

  for (const segment of segments) {
    if (isInvalidPathSegment(segment)) {
      throw new Error('Invalid file path')
    }
  }

  try {
    const stats = await withFileBusyRetry('Inspect directory', () => fs.stat(directory))
    if (!stats.isDirectory()) {
      throw new Error('Base path is not a directory')
    }

    const targetPath = path.join(directory, normalizedRelativePath)

    // Ensure the target file is within the base directory
    if (!isValidFileAccess(targetPath, directory)) {
      throw new Error('Access denied')
    }

    await withFileBusyRetry('Write file', () => fs.writeFile(targetPath, contents, 'utf-8'))
    return targetPath
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('File path not found')
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
    const stats = await withFileBusyRetry('Inspect directory', () => fs.stat(directory))
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
    await withFileBusyRetry('Create folder', () => fs.mkdir(folderPath, { recursive: true }))
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
    const stats = await withFileBusyRetry('Inspect datapack folder', () => fs.stat(folderPath))
    if (!stats.isDirectory()) {
      throw new Error('Path is not a directory')
    }

    // Accept either enabled or disabled datapack metadata file in the root directory.
    const packMcmetaPath = path.join(folderPath, 'pack.mcmeta')
    const packMcmetaDisabledPath = path.join(folderPath, 'pack.mcmeta.disabled')

    try {
      const packMcmetaStats = await withFileBusyRetry('Inspect pack.mcmeta', () => fs.stat(packMcmetaPath))
      if (packMcmetaStats.isFile()) return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EBUSY') {
        throw error
      }
    }

    try {
      const packMcmetaDisabledStats = await withFileBusyRetry('Inspect pack.mcmeta.disabled', () => fs.stat(packMcmetaDisabledPath))
      return packMcmetaDisabledStats.isFile()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EBUSY') {
        throw error
      }
      return false
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EBUSY') {
      throw error
    }
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
    await withFileBusyRetry('Inspect source path', () => fs.stat(oldPath))
    
    // Construct new path in the same directory
    const directory = path.dirname(oldPath)
    const newPath = path.join(directory, newName)

    // Check if target already exists
    try {
      await withFileBusyRetry('Inspect target path', () => fs.stat(newPath))
      throw new Error('A file or folder with that name already exists')
    } catch (error) {
      // ENOENT is expected - target should not exist
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }

    // Rename the file or folder
    await withFileBusyRetry('Rename file or folder', () => fs.rename(oldPath, newPath))
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
    const stats = await withFileBusyRetry('Inspect target path', () => fs.stat(targetPath))
    
    if (stats.isDirectory()) {
      // Remove directory and all contents recursively
      await withFileBusyRetry('Delete folder', () => fs.rm(targetPath, { recursive: true, force: true }))
    } else {
      // Remove file
      await withFileBusyRetry('Delete file', () => fs.unlink(targetPath))
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('File or folder not found')
    }
    throw error
  }
}

export const registerFileOperationHandlers = (options?: FileOperationHandlerOptions) => {
  const getAllowedRoots = options?.getAllowedRoots

  // IPC handler to write a file after validation
  ipcMain.handle('write-file', async (_event, { directory, filename, contents }) => {
    const safeDirectory = assertPathAllowedForFileOperation(directory, 'write-file', getAllowedRoots?.())
    return await writeFile(safeDirectory, filename, contents)
  })

  // IPC handler to save a file (similar to write-file but for existing files)
  ipcMain.handle('save-file', async (_event, { directory, relativePath, contents }) => {
    const safeDirectory = assertPathAllowedForFileOperation(directory, 'save-file', getAllowedRoots?.())
    return await writeFileFromDirectory(safeDirectory, relativePath, contents)
  })

  // IPC handler to read a file
  ipcMain.handle('read-file', async (_event, { directory, filePath }) => {
    const safeDirectory = assertPathAllowedForFileOperation(directory, 'read-file', getAllowedRoots?.())
    return await readFileFromDirectory(safeDirectory, filePath)
  })

  // IPC handler to read a file if it exists, returning null instead of throwing for not-found.
  ipcMain.handle('read-file-if-exists', async (_event, { directory, filePath }) => {
    const safeDirectory = assertPathAllowedForFileOperation(directory, 'read-file-if-exists', getAllowedRoots?.())
    try {
      return await readFileFromDirectory(safeDirectory, filePath)
    } catch (error) {
      const errno = error as NodeJS.ErrnoException
      if (errno.code === 'ENOENT') return null
      if (error instanceof Error && error.message === 'File not found') return null
      throw error
    }
  })

  // IPC handler to list files in a directory
  ipcMain.handle('list-files', async (_event, { directory }) => {
    const safeDirectory = assertPathAllowedForFileOperation(directory, 'list-files', getAllowedRoots?.())
    return getAllFiles(safeDirectory)
  })

  // IPC handler to create a folder
  ipcMain.handle('create-folder', async (_event, { folderPath }) => {
    const safeFolderPath = assertPathAllowedForFileOperation(folderPath, 'create-folder', getAllowedRoots?.())
    return await createFolder(safeFolderPath)
  })

  // IPC handler to reveal file in OS file explorer
  ipcMain.handle('reveal-in-file-explorer', async (_event, { filePath }) => {
    const safePath = assertPathAllowedForFileOperation(filePath, 'reveal-in-file-explorer', getAllowedRoots?.())
    shell.showItemInFolder(safePath)
  })

  // IPC handler to rename file or folder
  ipcMain.handle('rename-file-or-folder', async (_event, { oldPath, newName }) => {
    const safePath = assertPathAllowedForFileOperation(oldPath, 'rename-file-or-folder', getAllowedRoots?.())
    return await renameFileOrFolder(safePath, newName)
  })

  // IPC handler to delete file or folder
  ipcMain.handle('delete-file-or-folder', async (_event, { targetPath }) => {
    const safePath = assertPathAllowedForFileOperation(targetPath, 'delete-file-or-folder', getAllowedRoots?.())
    return await deleteFileOrFolder(safePath)
  })
}