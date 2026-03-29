import { promises as fs } from 'fs'
import path from 'path'

const DATAPACK_VERSION = 1
const DATAPACK_EXTENSION = '.mpp-datapack'

export interface DatapackMetadata {
  version: number
  lastOpened: string
  name: string
  packVersion: string
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

const getDefaultMetadataForDirectory = (datapackDir: string, preferredId?: string): DatapackMetadata => {
  const datapackName = path.basename(datapackDir)
  const sanitizedFallbackId = datapackName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 2).toUpperCase() || 'DP'
  const datapackId = typeof preferredId === 'string' && preferredId.trim().length > 0
    ? preferredId.trim()
    : sanitizedFallbackId

  return createDefaultDatapackMetadata(datapackName, datapackId)
}

const stripUnknownMetadataFields = (rawMetadata: unknown, defaults: DatapackMetadata): DatapackMetadata => {
  if (!rawMetadata || typeof rawMetadata !== 'object' || Array.isArray(rawMetadata)) {
    return defaults
  }

  const allowedKeys = new Set(Object.keys(defaults))
  const knownEntries = Object.entries(rawMetadata).filter(([key]) => allowedKeys.has(key))

  return {
    ...defaults,
    ...(Object.fromEntries(knownEntries) as Partial<DatapackMetadata>),
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

    const defaults = getDefaultMetadataForDirectory(
      datapackDir,
      typeof preferredId === 'string' ? preferredId : undefined,
    )
    const sanitized = stripUnknownMetadataFields(parsed, defaults)

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
    const defaults = getDefaultMetadataForDirectory(datapackDir, data.id)
    const sanitizedData = stripUnknownMetadataFields(data, defaults)
    const content = JSON.stringify(sanitizedData, null, 2)
    await fs.writeFile(filePath, content, 'utf-8')
  } catch (error) {
    throw new Error(`Failed to write datapack metadata: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

export const createDefaultDatapackMetadata = (
  datapackName: string,
  datapackId: string
): DatapackMetadata => {
  return {
    version: DATAPACK_VERSION,
    lastOpened: new Date().toISOString(),
    name: datapackName,
    packVersion: '1.00.00',
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
