import { promises as fs } from 'fs'
import path from 'path'
import { preferencesManager } from './preferences'

const FALLBACK_MINECRAFT_VERSION = '26.1.2'

const DATAPACK_VERSION = 1
const DATAPACK_EXTENSION = '.mpp-datapack'

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
    tags: []
  }
}

export const updateDatapackLastOpened = (data: DatapackMetadata): DatapackMetadata => {
  return {
    ...data,
    lastOpened: new Date().toISOString()
  }
}
