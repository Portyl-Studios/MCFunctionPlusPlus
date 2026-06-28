import { promises as fs } from 'fs'
import path from 'path'
import { preferencesManager } from './preferences'
import { DEFAULT_EXPORT_FILENAME_TEMPLATE } from '../shared/export-utils'

const FALLBACK_MINECRAFT_VERSION = '26.1.2'

const DATAPACK_VERSION = 1
const DATAPACK_EXTENSION = '.mpp-datapack'

export interface DatapackExportSettings {
  // Absolute output folder. Blank/undefined means the default (~/dist).
  outputDir?: string
  // Filename template with %TOKEN% placeholders (see shared/export-utils).
  fileNameTemplate?: string
  // When true, the patch component of packVersion is bumped on each export.
  autoIncrementVersion?: boolean
  // Extra exclude globs applied within the export allowlist.
  excludeGlobs?: string[]
  // Bookkeeping written after a successful export.
  lastExportedAt?: string
  lastExportPath?: string
}

export interface DatapackMetadata {
  version: number
  lastOpened: string
  name: string
  packVersion: string
  minecraftVersion?: string
  id: string
  author?: string
  description?: string
  packFormatVersionMin?: number
  packFormatVersionMax?: number
  tags?: string[]
  export?: DatapackExportSettings
}

export const createDefaultExportSettings = (): DatapackExportSettings => ({
  outputDir: '',
  fileNameTemplate: DEFAULT_EXPORT_FILENAME_TEMPLATE,
  autoIncrementVersion: true,
  excludeGlobs: [],
})

const sanitizeExportSettings = (
  rawValue: unknown,
  defaults: DatapackExportSettings,
): DatapackExportSettings => {
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    return { ...defaults }
  }

  const value = rawValue as Record<string, unknown>

  return {
    outputDir: typeof value.outputDir === 'string'
      ? value.outputDir
      : defaults.outputDir,
    fileNameTemplate: typeof value.fileNameTemplate === 'string' && value.fileNameTemplate.trim().length > 0
      ? value.fileNameTemplate
      : defaults.fileNameTemplate,
    autoIncrementVersion: typeof value.autoIncrementVersion === 'boolean'
      ? value.autoIncrementVersion
      : defaults.autoIncrementVersion,
    excludeGlobs: Array.isArray(value.excludeGlobs)
      ? value.excludeGlobs.filter((entry): entry is string => typeof entry === 'string')
      : defaults.excludeGlobs,
    lastExportedAt: typeof value.lastExportedAt === 'string'
      ? value.lastExportedAt
      : defaults.lastExportedAt,
    lastExportPath: typeof value.lastExportPath === 'string'
      ? value.lastExportPath
      : defaults.lastExportPath,
  }
}

export const getDatapackMetadataPath = (datapackDir: string): string => {
  return path.join(datapackDir, DATAPACK_EXTENSION)
}

const getPreferredMinecraftDefaultVersion = async (): Promise<string> => {
  const minecraftPrefs = await preferencesManager.get('minecraft')
  const preferredVersion = typeof minecraftPrefs?.defaultVersion === 'string'
    ? minecraftPrefs.defaultVersion.trim()
    : ''

  return preferredVersion || FALLBACK_MINECRAFT_VERSION
}

const getDefaultMetadataForDirectory = async (datapackDir: string, preferredId?: string): Promise<DatapackMetadata> => {
  const datapackName = path.basename(datapackDir)
  const sanitizedFallbackId = datapackName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 2).toUpperCase() || 'DP'
  const datapackId = typeof preferredId === 'string' && preferredId.trim().length > 0
    ? preferredId.trim()
    : sanitizedFallbackId
  const preferredMinecraftVersion = await getPreferredMinecraftDefaultVersion()

  return createDefaultDatapackMetadata(datapackName, datapackId, preferredMinecraftVersion)
}

const sanitizeDatapackMetadata = (rawMetadata: unknown, defaults: DatapackMetadata): DatapackMetadata => {
  if (!rawMetadata || typeof rawMetadata !== 'object' || Array.isArray(rawMetadata)) {
    return defaults
  }

  const value = rawMetadata as Record<string, unknown>

  return {
    version: typeof value.version === 'number' && Number.isFinite(value.version)
      ? value.version
      : defaults.version,
    lastOpened: typeof value.lastOpened === 'string'
      ? value.lastOpened
      : defaults.lastOpened,
    name: typeof value.name === 'string'
      ? value.name
      : defaults.name,
    packVersion: typeof value.packVersion === 'string'
      ? value.packVersion
      : defaults.packVersion,
    minecraftVersion: typeof value.minecraftVersion === 'string'
      ? value.minecraftVersion
      : defaults.minecraftVersion,
    id: typeof value.id === 'string'
      ? value.id
      : defaults.id,
    author: typeof value.author === 'string'
      ? value.author
      : defaults.author,
    description: typeof value.description === 'string'
      ? value.description
      : defaults.description,
    packFormatVersionMin: typeof value.packFormatVersionMin === 'number' && Number.isFinite(value.packFormatVersionMin)
      ? value.packFormatVersionMin
      : defaults.packFormatVersionMin,
    packFormatVersionMax: typeof value.packFormatVersionMax === 'number' && Number.isFinite(value.packFormatVersionMax)
      ? value.packFormatVersionMax
      : defaults.packFormatVersionMax,
    tags: Array.isArray(value.tags)
      ? value.tags.filter((tag): tag is string => typeof tag === 'string')
      : defaults.tags,
    export: sanitizeExportSettings(value.export, defaults.export ?? createDefaultExportSettings()),
  }
}

export const parseDatapackMetadata = async (datapackDir: string): Promise<DatapackMetadata | null> => {
  try {
    const filePath = getDatapackMetadataPath(datapackDir)
    const content = await fs.readFile(filePath, 'utf-8')
    const parsed = JSON.parse(content)

    const preferredId = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as { id?: unknown }).id
      : undefined

    const defaults = await getDefaultMetadataForDirectory(
      datapackDir,
      typeof preferredId === 'string' ? preferredId : undefined,
    )
    const sanitized = sanitizeDatapackMetadata(parsed, defaults)

    if (JSON.stringify(parsed) !== JSON.stringify(sanitized)) {
      await fs.writeFile(filePath, JSON.stringify(sanitized, null, 2), 'utf-8')
    }

    return sanitized
  } catch (error) {
    // File doesn't exist or is invalid JSON
    return null
  }
}

export const writeDatapackMetadata = async (
  datapackDir: string,
  data: DatapackMetadata
): Promise<void> => {
  try {
    const filePath = getDatapackMetadataPath(datapackDir)
    const defaults = await getDefaultMetadataForDirectory(datapackDir, data.id)
    const sanitizedData = sanitizeDatapackMetadata(data, defaults)
    const content = JSON.stringify(sanitizedData, null, 2)
    await fs.writeFile(filePath, content, 'utf-8')
  } catch (error) {
    throw new Error(`Failed to write datapack metadata: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

export const createDefaultDatapackMetadata = (
  datapackName: string,
  datapackId: string,
  preferredMinecraftVersion?: string,
): DatapackMetadata => {
  const normalizedMinecraftVersion = preferredMinecraftVersion?.trim()

  return {
    version: DATAPACK_VERSION,
    lastOpened: new Date().toISOString(),
    name: datapackName,
    packVersion: '1.00.00',
    minecraftVersion: normalizedMinecraftVersion || FALLBACK_MINECRAFT_VERSION,
    id: datapackId,
    author: 'unknown',
    description: 'made by unknown',
    packFormatVersionMin: 12,
    packFormatVersionMax: 12,
    tags: [],
    export: createDefaultExportSettings(),
  }
}

export const updateDatapackLastOpened = (data: DatapackMetadata): DatapackMetadata => {
  return {
    ...data,
    lastOpened: new Date().toISOString()
  }
}
