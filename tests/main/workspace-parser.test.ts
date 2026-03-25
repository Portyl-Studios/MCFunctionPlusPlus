import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  addDatapackPath,
  createDefaultWorkspace,
  getDatapackPaths,
  getWorkspaceFilePath,
  parseWorkspaceFile,
  removeDatapackPath,
  writeWorkspaceFile,
} from '../../src/main/workspace-parser'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directoryPath) =>
      rm(directoryPath, { recursive: true, force: true }),
    ),
  )
})

describe('workspace-parser', () => {
  it('builds workspace file path with extension', () => {
    const result = getWorkspaceFilePath('C:/workspace', 'project')
    expect(result).toBe(path.join('C:/workspace', 'project.mpp-workspace'))
  })

  it('creates and mutates default workspace datapack list safely', () => {
    const workspace = createDefaultWorkspace()
    expect(workspace.version).toBe(1)
    expect(getDatapackPaths(workspace)).toEqual([])

    addDatapackPath(workspace, '/tmp/a/.mpp-datapack')
    addDatapackPath(workspace, '/tmp/a/.mpp-datapack')
    addDatapackPath(workspace, '/tmp/b/.mpp-datapack')

    expect(getDatapackPaths(workspace)).toEqual(['/tmp/a/.mpp-datapack', '/tmp/b/.mpp-datapack'])

    removeDatapackPath(workspace, '/tmp/a/.mpp-datapack')
    expect(getDatapackPaths(workspace)).toEqual(['/tmp/b/.mpp-datapack'])
  })

  it('writes and parses workspace metadata', async () => {
    const directoryPath = await mkdtemp(path.join(tmpdir(), 'mcpp-workspace-test-'))
    temporaryDirectories.push(directoryPath)

    const workspaceName = 'example-workspace'
    const workspaceData = createDefaultWorkspace()
    workspaceData.preferences = { theme: 'dark' }
    workspaceData.datapacks = ['C:/pack/.mpp-datapack']

    await writeWorkspaceFile(directoryPath, workspaceName, workspaceData)

    const parsed = await parseWorkspaceFile(directoryPath, workspaceName)
    expect(parsed).not.toBeNull()
    expect(parsed?.version).toBe(1)
    expect(parsed?.preferences).toEqual({ theme: 'dark' })
    expect(parsed?.datapacks).toEqual(['C:/pack/.mpp-datapack'])
  })

  it('returns null for missing workspace file', async () => {
    const parsed = await parseWorkspaceFile('C:/missing/path', 'unknown')
    expect(parsed).toBeNull()
  })
})
