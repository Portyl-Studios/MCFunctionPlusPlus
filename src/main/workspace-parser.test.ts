import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import { promises as fs } from 'fs'

// Mock the fs promises API so the read/write wrappers can be exercised
// without touching the real filesystem.
vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}))

import {
  getWorkspaceFilePath,
  toRelativeWorkspaceDatapackPath,
  toAbsoluteWorkspaceDatapackPath,
  normalizeWorkspaceData,
  createDefaultWorkspace,
  addDatapackPath,
  removeDatapackPath,
  setDatapackPaths,
  getDatapackPaths,
  parseWorkspaceFile,
  writeWorkspaceFile,
} from './workspace-parser'

const mockReadFile = vi.mocked(fs.readFile)
const mockWriteFile = vi.mocked(fs.writeFile)

describe('getWorkspaceFilePath', () => {
  it('appends the workspace extension to the name', () => {
    expect(getWorkspaceFilePath('/ws', 'demo')).toBe(path.join('/ws', 'demo.mpp-workspace'))
  })
})

describe('toRelativeWorkspaceDatapackPath', () => {
  it('strips the metadata filename and relativizes against the workspace dir', () => {
    expect(toRelativeWorkspaceDatapackPath('/ws', '/ws/packs/mine/.mpp-datapack')).toBe('packs/mine')
  })

  it('handles a directory path with no metadata filename', () => {
    expect(toRelativeWorkspaceDatapackPath('/ws', '/ws/packs/mine')).toBe('packs/mine')
  })

  it('returns "." when the datapack is the workspace dir itself', () => {
    expect(toRelativeWorkspaceDatapackPath('/ws', '/ws/.mpp-datapack')).toBe('.')
  })

  it('returns empty string for blank input', () => {
    expect(toRelativeWorkspaceDatapackPath('/ws', '   ')).toBe('')
  })
})

describe('toAbsoluteWorkspaceDatapackPath', () => {
  it('joins the stored relative path with the metadata filename', () => {
    // Mirror the implementation's path.resolve so the expectation is drive-correct
    // on Windows (where path.resolve prepends the cwd drive letter, e.g. E:\ws\...).
    expect(toAbsoluteWorkspaceDatapackPath('/ws', 'packs/mine')).toBe(
      path.join(path.resolve('/ws', 'packs/mine'), '.mpp-datapack'),
    )
  })

  it('round-trips with toRelativeWorkspaceDatapackPath', () => {
    const abs = toAbsoluteWorkspaceDatapackPath('/ws', 'packs/mine')
    expect(toRelativeWorkspaceDatapackPath('/ws', abs)).toBe('packs/mine')
  })

  it('returns empty string for blank input', () => {
    expect(toAbsoluteWorkspaceDatapackPath('/ws', '')).toBe('')
  })
})

describe('normalizeWorkspaceData', () => {
  it('returns defaults for a non-record value', () => {
    const result = normalizeWorkspaceData(null)
    expect(result.version).toBe(1)
    expect(result.datapacks).toEqual([])
    expect(result.preferences).toEqual({})
  })

  it('filters non-string datapack entries and dedupes', () => {
    const result = normalizeWorkspaceData({
      version: 2,
      datapacks: ['a', 'a', 'b', 5, null, '  c  '],
    })
    expect(result.version).toBe(2)
    expect(result.datapacks).toEqual(['a', 'b', 'c'])
  })

  it('falls back to default version when version is not a finite number', () => {
    expect(normalizeWorkspaceData({ version: 'x' }).version).toBe(1)
    expect(normalizeWorkspaceData({ version: Number.NaN }).version).toBe(1)
  })

  it('ignores a non-record preferences value', () => {
    expect(normalizeWorkspaceData({ preferences: [1, 2] }).preferences).toEqual({})
  })
})

describe('datapack path mutators', () => {
  it('addDatapackPath appends only unique paths', () => {
    const data = createDefaultWorkspace()
    addDatapackPath(data, '/a')
    addDatapackPath(data, '/a')
    addDatapackPath(data, '/b')
    expect(getDatapackPaths(data)).toEqual(['/a', '/b'])
  })

  it('removeDatapackPath drops the matching path', () => {
    const data = createDefaultWorkspace()
    setDatapackPaths(data, ['/a', '/b', '/c'])
    removeDatapackPath(data, '/b')
    expect(getDatapackPaths(data)).toEqual(['/a', '/c'])
  })

  it('setDatapackPaths normalizes separators and dedupes', () => {
    const data = createDefaultWorkspace()
    setDatapackPaths(data, ['a\\b', 'a/b', '  c  ', ''])
    expect(getDatapackPaths(data)).toEqual(['a/b', 'c'])
  })

  it('getDatapackPaths returns an empty array when unset', () => {
    expect(getDatapackPaths({ version: 1 })).toEqual([])
  })
})

describe('createDefaultWorkspace', () => {
  it('produces a versioned, empty workspace with an ISO timestamp', () => {
    const ws = createDefaultWorkspace()
    expect(ws.version).toBe(1)
    expect(ws.datapacks).toEqual([])
    expect(() => new Date(ws.lastOpened as string).toISOString()).not.toThrow()
  })
})

describe('parseWorkspaceFile (fs wrapper)', () => {
  beforeEach(() => {
    mockReadFile.mockReset()
    mockWriteFile.mockReset()
  })

  it('returns null when the workspace file cannot be read', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'))
    expect(await parseWorkspaceFile('/ws', 'demo')).toBeNull()
  })

  it('returns null for invalid JSON', async () => {
    mockReadFile.mockResolvedValue('{ not json')
    expect(await parseWorkspaceFile('/ws', 'demo')).toBeNull()
  })

  it('normalizes the parsed workspace data', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({ version: 1, datapacks: ['a/b', 'a/b', 42], extraneous: true }),
    )

    const result = await parseWorkspaceFile('/ws', 'demo')

    expect(result?.version).toBe(1)
    expect(result?.datapacks).toEqual(['a/b'])
    expect(mockReadFile).toHaveBeenCalledWith(
      path.join('/ws', 'demo.mpp-workspace'),
      'utf-8',
    )
  })
})

describe('writeWorkspaceFile (fs wrapper)', () => {
  beforeEach(() => {
    mockReadFile.mockReset()
    mockWriteFile.mockReset()
  })

  it('writes normalized data with datapacks relativized against the workspace dir', async () => {
    mockWriteFile.mockResolvedValue(undefined)

    await writeWorkspaceFile('/ws', 'demo', {
      version: 1,
      datapacks: [toAbsoluteWorkspaceDatapackPath('/ws', 'packs/mine')],
    })

    expect(mockWriteFile).toHaveBeenCalledWith(
      path.join('/ws', 'demo.mpp-workspace'),
      expect.any(String),
      'utf-8',
    )
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    expect(written.datapacks).toEqual(['packs/mine'])
  })

  it('wraps a write failure in a descriptive error', async () => {
    mockWriteFile.mockRejectedValue(new Error('disk full'))

    await expect(writeWorkspaceFile('/ws', 'demo', { version: 1 })).rejects.toThrow(
      'Failed to write workspace file: disk full',
    )
  })
})
