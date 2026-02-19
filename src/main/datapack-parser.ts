import { promises as fs } from 'fs'
import path from 'path'

const DATAPACK_VERSION = 1
const DATAPACK_EXTENSION = '.mpp-datapack'

export interface DatapackMetadata {
  version: number
  lastOpened: string
  isDisabled: boolean
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

export const parseDatapackMetadata = async (datapackDir: string): Promise<DatapackMetadata | null> => {
  try {
    const filePath = getDatapackMetadataPath(datapackDir)
    const content = await fs.readFile(filePath, 'utf-8')
    const parsed = JSON.parse(content) as DatapackMetadata
    return parsed
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
    const content = JSON.stringify(data, null, 2)
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
    isDisabled: false,
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
