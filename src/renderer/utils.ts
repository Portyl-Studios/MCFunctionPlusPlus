/**
 * Extracts the directory path from a file path
 * @param filePath - Full file path (can use / or \\ as separator)
 * @returns Directory path without the filename
 */
export const getDirFromPath = (filePath: string): string => {
  const lastSlash = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'))
  if (lastSlash === -1) return filePath
  return filePath.slice(0, lastSlash)
}

/**
 * Converts absolute paths to relative paths based on a base directory
 * @param baseDir - The base directory to calculate relative paths from
 * @param rawPaths - Array of absolute file paths
 * @returns Array of relative paths
 */
export const toRelativePaths = (baseDir: string, rawPaths: string[]): string[] => {
  const base = baseDir.replace(/\\/g, '/').replace(/\/+$/, '')
  return rawPaths.map((rawPath) => {
    const normalized = rawPath.replace(/\\/g, '/')
    const baseWithSlash = `${base}/`

    if (normalized.toLowerCase().startsWith(baseWithSlash.toLowerCase())) {
      return normalized.slice(baseWithSlash.length)
    }

    return normalized
  })
}

/**
 * Creates a unique file key from datapack directory and relative path
 * Format: "datapackDir|relativePath"
 */
export const createFileKey = (datapackDir: string, relativePath: string): string => {
  return `${datapackDir}|${relativePath}`
}

/**
 * Parses a file key into its component parts
 * @param fileKey - File key in format "datapackDir|relativePath"
 * @returns Object with datapackDir and relativePath
 */
export const parseFileKey = (fileKey: string): { datapackDir: string; relativePath: string } => {
  const separatorIndex = fileKey.indexOf('|')
  if (separatorIndex === -1) {
    return { datapackDir: fileKey, relativePath: '' }
  }

  const datapackDir = fileKey.slice(0, separatorIndex)
  const relativePath = fileKey.slice(separatorIndex + 1)
  return { datapackDir, relativePath }
}
