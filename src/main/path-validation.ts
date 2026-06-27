import path from 'path'

// Path / filename validation helpers used to enforce the file-operation
// allowlist boundary. Extracted from fileops.ts so they can be unit tested
// in isolation. Behavior must remain identical to the original definitions.

const RESERVED_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

export const isInvalidFilename = (filename: string): boolean => {
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
  if (RESERVED_DEVICE_NAME.test(trimmed)) return true

  return false
}

export const isInvalidPathSegment = (segment: string): boolean => {
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
  if (RESERVED_DEVICE_NAME.test(trimmed)) return true

  return false
}

export const isInvalidDirectory = (directory: string): boolean => {
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

export const isValidFileAccess = (filePath: string, baseDirectory: string): boolean => {
  const normalized = path.normalize(filePath)
  const resolvedPath = path.resolve(normalized)
  const resolvedBase = path.resolve(baseDirectory)

  const comparablePath = process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath
  const comparableBase = process.platform === 'win32' ? resolvedBase.toLowerCase() : resolvedBase
  const relativePath = path.relative(comparableBase, comparablePath)

  // Treat base itself and descendants as valid, and reject traversal outside the base.
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

export const isAbsolutePath = (value: unknown): value is string => {
  return typeof value === 'string' && path.isAbsolute(value) && !/\x00/.test(value)
}

export const isPathWithinRoot = (targetPath: string, rootPath: string): boolean => {
  const resolvedPath = path.resolve(targetPath)
  const resolvedRoot = path.resolve(rootPath)
  const comparablePath = process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath
  const comparableRoot = process.platform === 'win32' ? resolvedRoot.toLowerCase() : resolvedRoot
  const relativePath = path.relative(comparableRoot, comparablePath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

export const assertPathAllowedForFileOperation = (
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
