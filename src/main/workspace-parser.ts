import { promises as fs } from 'fs'
import path from 'path'

const WORKSPACE_VERSION = 1
const WORKSPACE_EXTENSION = '.mpp-workspace'

export interface WorkspaceData {
  version: number
  lastOpened?: string
  preferences?: Record<string, unknown>
  datapacks?: string[]
}

export const getWorkspaceFilePath = (directory: string, name: string): string => {
  return path.join(directory, `${name}${WORKSPACE_EXTENSION}`)
}

export const parseWorkspaceFile = async (directory: string, name: string): Promise<WorkspaceData | null> => {
  try {
    const filePath = getWorkspaceFilePath(directory, name)
    const content = await fs.readFile(filePath, 'utf-8')
    const parsed = JSON.parse(content) as WorkspaceData
    return parsed
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
    const content = JSON.stringify(data, null, 2)
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
  const uniqueOrderedPaths = metadataPaths
    .filter((path): path is string => typeof path === 'string')
    .map((path) => path.trim())
    .filter((path) => path.length > 0)
    .filter((path, index, list) => list.indexOf(path) === index)

  data.datapacks = uniqueOrderedPaths
  return data
}

export const getDatapackPaths = (data: WorkspaceData): string[] => {
  return data.datapacks ?? []
}
