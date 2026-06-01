import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { spawn } from 'child_process'
import fs, { promises as fsPromises } from 'fs'
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

export type JavaExecutableValidationResult = {
  valid: boolean
  output: string
  versionText: string | null
}

const parseJavaVersionText = (rawOutput: string): string | null => {
  const versionQuotedMatch = rawOutput.match(/version\s+"([^"]+)"/i)
  if (versionQuotedMatch?.[1]) {
    return versionQuotedMatch[1]
  }

  const genericMatch = rawOutput.match(/\b(?:openjdk|java)\s+(\d+(?:\.\d+)*)/i)
  return genericMatch?.[1] ?? null
}

const KNOWN_JAVA_VENDOR_KEYWORDS = [
  'oracle',
  'openjdk',
  'adoptopenjdk',
  'temurin',
  'azul',
  'amazon',
  'microsoft',
  'red hat',
  'redhat',
  'bellsoft',
  'eclipse',
]

const runAuthenticodeCheck = async (executablePath: string): Promise<{ status: string; subject: string }> => {
  if (process.platform !== 'win32') {
    return { status: 'UnsupportedPlatform', subject: '' }
  }

  const escaped = executablePath.replace(/'/g, "''")
  const script = `try { $s = Get-AuthenticodeSignature -FilePath '${escaped}'; $status = $s.Status.ToString(); $sub = if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { '' }; Write-Output $status; Write-Output $sub } catch { Write-Output 'Error'; Write-Output $_.Exception.Message }`

  return await new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (c) => { out += c.toString() })
    child.stderr.on('data', (c) => { out += c.toString() })
    child.on('error', () => resolve({ status: 'Error', subject: '' }))
    child.on('close', () => {
      const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      const status = lines[0] ?? 'Unknown'
      const subject = lines[1] ?? ''
      resolve({ status, subject })
    })
  })
}

  const resolveExecutablePath = async (cmd: string): Promise<string | null> => {
    if (!cmd) return null
    if (path.isAbsolute(cmd)) return cmd

    if (process.platform === 'win32') {
      return await new Promise((resolve) => {
        const child = spawn('where', [cmd], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
        let out = ''
        child.stdout.on('data', (c) => { out += c.toString() })
        child.stderr.on('data', (c) => { out += c.toString() })
        child.on('error', () => resolve(null))
        child.on('close', () => {
          const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
          resolve(lines[0] ?? null)
        })
      })
    }

    return await new Promise((resolve) => {
      const child = spawn('which', [cmd], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      child.stdout.on('data', (c) => { out += c.toString() })
      child.stderr.on('data', (c) => { out += c.toString() })
      child.on('error', () => resolve(null))
      child.on('close', () => {
        const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
        resolve(lines[0] ?? null)
      })
    })
  }

const getJavaBrowseDefaultPath = (): string => {
  const rootsToCheck = [
    'C:\\',
    path.parse(process.cwd()).root,
    path.parse(path.resolve('.')).root,
  ].filter((root, index, roots) => Boolean(root) && roots.indexOf(root) === index)

  for (const driveRoot of rootsToCheck) {
    const javaFolder = path.join(driveRoot, 'Program Files', 'Java')
    if (fs.existsSync(javaFolder)) {
      return javaFolder
    }

    const programFilesFolder = path.join(driveRoot, 'Program Files')
    if (fs.existsSync(programFilesFolder)) {
      return programFilesFolder
    }

    if (fs.existsSync(driveRoot)) {
      return driveRoot
    }
  }

  return rootsToCheck[0] ?? 'C:\\'
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

export const registerPickJavaExecutableHandler = (
  getMainWindow: () => BrowserWindow | null,
) => {
  ipcMain.handle('pick-java-executable', async () => {
    const mainWindow = getMainWindow()
    if (!mainWindow) throw new Error('No main window')

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      defaultPath: getJavaBrowseDefaultPath(),
      filters: [
        { name: 'Java Executable', extensions: ['exe'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })
}

export const registerValidateJavaExecutableHandler = () => {
  ipcMain.handle('validate-java-executable', async (_event, javaExecutable: unknown) => {
    if (typeof javaExecutable !== 'string' || !javaExecutable.trim()) {
      return {
        valid: false,
        output: 'Java executable path is empty',
        versionText: null,
      } satisfies JavaExecutableValidationResult
    }
    const executablePath = javaExecutable.trim()

    // Resolve the actual executable path (handles when `java` is a PATH command)
    const resolved = await resolveExecutablePath(executablePath)
    const executableForSig = resolved ?? executablePath

    // Validate authenticode signature and publisher on Windows when possible
    const sig = await runAuthenticodeCheck(executableForSig)

    // If platform doesn't support signature verification, continue to run version check.
    if (sig.status === 'UnsupportedPlatform') {
      // fallthrough to version check
    } else {
      if (sig.status !== 'Valid') {
        return { valid: false, output: `Signature status: ${sig.status}`, versionText: null }
      }

      const subjectLower = (sig.subject || '').toLowerCase()
      const matchedVendor = KNOWN_JAVA_VENDOR_KEYWORDS.find((k) => subjectLower.includes(k))
      if (!matchedVendor) {
        return { valid: false, output: `Unrecognized publisher: ${sig.subject || '<none>'}`, versionText: null }
      }
    }

    // Run java -version after signature checks
    return await new Promise<JavaExecutableValidationResult>((resolve) => {
      const child = spawn(executablePath, ['-version'], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let output = ''

      child.stdout.on('data', (chunk) => {
        output += chunk.toString()
      })

      child.stderr.on('data', (chunk) => {
        output += chunk.toString()
      })

      child.on('error', (error) => {
        const message = error instanceof Error ? error.message : String(error)
        resolve({
          valid: false,
          output: message,
          versionText: null,
        })
      })

      child.on('close', (exitCode) => {
        const trimmedOutput = output.trim()
        const versionText = parseJavaVersionText(trimmedOutput)
        resolve({
          valid: exitCode === 0,
          output: trimmedOutput,
          versionText,
        })
      })
    })
  })
}

export const getAllFiles = async (rootDir: string): Promise<string[]> => {
  const results: string[] = []
  const entries = await withFileBusyRetry('List files', () => fsPromises.readdir(rootDir, { withFileTypes: true }))

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
    const stats = await withFileBusyRetry('Inspect file', () => fsPromises.stat(filePath))
    if (!stats.isFile()) {
      throw new Error('Path is not a file')
    }

    // Limit file size to 10MB to prevent memory issues
    if (stats.size > 10 * 1024 * 1024) {
      throw new Error('File is too large')
    }

    const contents = await withFileBusyRetry('Read file', () => fsPromises.readFile(filePath, 'utf-8'))
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
    const stats = await withFileBusyRetry('Inspect directory', () => fsPromises.stat(directory))
    if (!stats.isDirectory()) {
      throw new Error('Path is not a directory')
    }

    const targetPath = path.join(directory, filename)

    // Ensure the target file is within the base directory
    if (!isValidFileAccess(targetPath, directory)) {
      throw new Error('Access denied')
    }

    await withFileBusyRetry('Write file', () => fsPromises.writeFile(targetPath, contents, 'utf-8'))
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
    const stats = await withFileBusyRetry('Inspect directory', () => fsPromises.stat(directory))
    if (!stats.isDirectory()) {
      throw new Error('Base path is not a directory')
    }

    const targetPath = path.join(directory, normalizedRelativePath)

    // Ensure the target file is within the base directory
    if (!isValidFileAccess(targetPath, directory)) {
      throw new Error('Access denied')
    }

    await withFileBusyRetry('Write file', () => fsPromises.writeFile(targetPath, contents, 'utf-8'))
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
    const stats = await withFileBusyRetry('Inspect directory', () => fsPromises.stat(directory))
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
    await withFileBusyRetry('Create folder', () => fsPromises.mkdir(folderPath, { recursive: true }))
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
    const stats = await withFileBusyRetry('Inspect datapack folder', () => fsPromises.stat(folderPath))
    if (!stats.isDirectory()) {
      throw new Error('Path is not a directory')
    }

    // Accept either enabled or disabled datapack metadata file in the root directory.
    const packMcmetaPath = path.join(folderPath, 'pack.mcmeta')
    const packMcmetaDisabledPath = path.join(folderPath, 'pack.mcmeta.disabled')

    try {
      const packMcmetaStats = await withFileBusyRetry('Inspect pack.mcmeta', () => fsPromises.stat(packMcmetaPath))
      if (packMcmetaStats.isFile()) return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EBUSY') {
        throw error
      }
    }

    try {
      const packMcmetaDisabledStats = await withFileBusyRetry('Inspect pack.mcmeta.disabled', () => fsPromises.stat(packMcmetaDisabledPath))
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

  const normalizedTarget = newName.replace(/\\/g, '/').trim()
  if (!normalizedTarget) {
    throw new Error('New name cannot be empty')
  }

  // Disallow absolute targets and parent traversal; renames must stay within source parent.
  if (path.isAbsolute(normalizedTarget)) {
    throw new Error('New name must be relative, not absolute')
  }

  const targetSegments = normalizedTarget
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)

  if (targetSegments.length === 0) {
    throw new Error('New name cannot be empty')
  }

  for (const segment of targetSegments) {
    if (segment === '.' || segment === '..') {
      throw new Error('New name cannot contain . or .. path segments')
    }

    if (isInvalidPathSegment(segment)) {
      throw new Error(`Invalid path segment: "${segment}"`)
    }
  }

  try {
    // Check if source exists
    await withFileBusyRetry('Inspect source path', () => fsPromises.stat(oldPath))
    
    // Construct new path in the same directory
    const directory = path.dirname(oldPath)
    const newPath = path.resolve(directory, ...targetSegments)

    if (!isValidFileAccess(newPath, directory)) {
      throw new Error('New name resolves outside the current folder')
    }

    await withFileBusyRetry('Create target parent directories', () => fsPromises.mkdir(path.dirname(newPath), { recursive: true }))

    // Check if target already exists
    try {
      await withFileBusyRetry('Inspect target path', () => fsPromises.stat(newPath))
      throw new Error('A file or folder with that name already exists')
    } catch (error) {
      // ENOENT is expected - target should not exist
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }

    // Rename the file or folder
    await withFileBusyRetry('Rename file or folder', () => fsPromises.rename(oldPath, newPath))
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
    const stats = await withFileBusyRetry('Inspect target path', () => fsPromises.stat(targetPath))
    
    if (stats.isDirectory()) {
      // Remove directory and all contents recursively
      await withFileBusyRetry('Delete folder', () => fsPromises.rm(targetPath, { recursive: true, force: true }))
    } else {
      // Remove file
      await withFileBusyRetry('Delete file', () => fsPromises.unlink(targetPath))
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