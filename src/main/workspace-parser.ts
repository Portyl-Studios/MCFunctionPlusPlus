import { promises as fs } from 'fs'
import path from 'path'

const WORKSPACE_VERSION = 1
const WORKSPACE_EXTENSION = '.mpp-workspace'
const DATAPACK_METADATA_FILENAME = '.mpp-datapack'

export interface WorkspaceData {
  version: number
  lastOpened?: string
  preferences?: Record<string, unknown>
  datapacks?: string[]
}

export const getWorkspaceFilePath = (directory: string, name: string): string => {
  return path.join(directory, `${name}${WORKSPACE_EXTENSION}`)
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const normalizeWorkspacePathSlashes = (value: string): string => {
  return value.replace(/\\/g, '/')
}

const stripMetadataFilename = (datapackPathOrMetadataPath: string): string => {
  const normalized = normalizeWorkspacePathSlashes(datapackPathOrMetadataPath).replace(/\/+$/, '')
  if (!normalized) return ''

  const lowerNormalized = normalized.toLowerCase()
  const metadataSuffix = `/${DATAPACK_METADATA_FILENAME}`
  if (lowerNormalized.endsWith(metadataSuffix)) {
    return normalized.slice(0, normalized.length - metadataSuffix.length)
  }

  if (lowerNormalized === DATAPACK_METADATA_FILENAME) {
    return ''
  }

  return normalized
}

export const toRelativeWorkspaceDatapackPath = (workspaceDir: string, datapackPathOrMetadataPath: string): string => {
  const trimmed = datapackPathOrMetadataPath.trim()
  if (!trimmed) return ''

  const withoutMetadata = stripMetadataFilename(trimmed)
  if (!withoutMetadata) return ''

  const absolutePath = path.isAbsolute(withoutMetadata)
    ? path.normalize(withoutMetadata)
    : path.resolve(workspaceDir, withoutMetadata)
  const relativePath = path.relative(workspaceDir, absolutePath)
  const normalizedRelative = normalizeWorkspacePathSlashes(relativePath)

  return normalizedRelative.length > 0 ? normalizedRelative : '.'
}

export const toAbsoluteWorkspaceDatapackPath = (workspaceDir: string, storedPath: string): string => {
  const trimmed = storedPath.trim()
  if (!trimmed) return ''

  const absoluteDatapackDir = path.resolve(workspaceDir, trimmed)
  return path.normalize(path.join(absoluteDatapackDir, DATAPACK_METADATA_FILENAME))
}

const normalizeAndDedupeDatapackPaths = (paths: string[]): string[] => {
  return paths
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => normalizeWorkspacePathSlashes(entry.trim()))
    .filter((entry) => entry.length > 0)
    .filter((entry, index, list) => list.indexOf(entry) === index)
}

export const normalizeWorkspaceData = (value: unknown): WorkspaceData => {
  const defaults = createDefaultWorkspace()

  if (!isRecord(value)) {
    return defaults
  }

  const normalizedVersion = typeof value.version === 'number' && Number.isFinite(value.version)
    ? value.version
    : WORKSPACE_VERSION

  const normalizedLastOpened = typeof value.lastOpened === 'string' && value.lastOpened.trim().length > 0
    ? value.lastOpened
    : defaults.lastOpened

  const normalizedPreferences = isRecord(value.preferences)
    ? { ...value.preferences }
    : defaults.preferences

  const rawDatapacks: unknown[] = Array.isArray(value.datapacks)
    ? value.datapacks
    : (defaults.datapacks ?? [])

  return {
    version: normalizedVersion,
    lastOpened: normalizedLastOpened,
    preferences: normalizedPreferences,
    datapacks: normalizeAndDedupeDatapackPaths(
      rawDatapacks.filter((entry): entry is string => typeof entry === 'string')
    )
  }
}

export const parseWorkspaceFile = async (directory: string, name: string): Promise<WorkspaceData | null> => {
  try {
    const filePath = getWorkspaceFilePath(directory, name)
    const content = await fs.readFile(filePath, 'utf-8')
    const parsed = JSON.parse(content) as unknown
    return normalizeWorkspaceData(parsed)
  } catch (error) {
    // File doesn't exist or is invalid JSON
    return null
  }
}

export const writeWorkspaceFile = async (
  directory: string,
  name: string,
  data: WorkspaceData
): Promise<void> => {
  try {
    const filePath = getWorkspaceFilePath(directory, name)
    const normalizedInput = normalizeWorkspaceData(data)
    const relativeDatapacks = (normalizedInput.datapacks ?? [])
      .map((metadataPath) => toRelativeWorkspaceDatapackPath(directory, metadataPath))
    const normalizedData: WorkspaceData = {
      ...normalizedInput,
      datapacks: normalizeAndDedupeDatapackPaths(relativeDatapacks)
    }
    const content = JSON.stringify(normalizedData, null, 2)
    await fs.writeFile(filePath, content, 'utf-8')
  } catch (error) {
    throw new Error(`Failed to write workspace file: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

export const createDefaultWorkspace = (): WorkspaceData => {
  return {
    version: WORKSPACE_VERSION,
    lastOpened: new Date().toISOString(),
    preferences: {},
    datapacks: []
  }
}

export const addDatapackPath = (data: WorkspaceData, metadataPath: string): WorkspaceData => {
  if (!data.datapacks) {
    data.datapacks = []
  }
  if (!data.datapacks.includes(metadataPath)) {
    data.datapacks.push(metadataPath)
  }
  return data
}

export const removeDatapackPath = (data: WorkspaceData, metadataPath: string): WorkspaceData => {
  if (data.datapacks) {
    data.datapacks = data.datapacks.filter((path) => path !== metadataPath)
  }
  return data
}

export const setDatapackPaths = (data: WorkspaceData, metadataPaths: string[]): WorkspaceData => {
  const uniqueOrderedPaths = normalizeAndDedupeDatapackPaths(metadataPaths)

  data.datapacks = uniqueOrderedPaths
  return data
}

export const getDatapackPaths = (data: WorkspaceData): string[] => {
  return data.datapacks ?? []
}
