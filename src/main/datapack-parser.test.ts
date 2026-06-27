import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import { promises as fs } from 'fs'

// datapack-parser imports ./preferences, which imports electron's `app`.
// Mock it so these pure-function tests don't drag in the Electron runtime.
vi.mock('./preferences', () => ({
  preferencesManager: { get: vi.fn(async () => ({})) },
}))

// Mock the fs promises API so the read/write wrappers can be exercised
// without touching the real filesystem.
vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}))

import {
  getDatapackMetadataPath,
  createDefaultDatapackMetadata,
  updateDatapackLastOpened,
  parseDatapackMetadata,
  writeDatapackMetadata,
  type DatapackMetadata,
} from './datapack-parser'

const mockReadFile = vi.mocked(fs.readFile)
const mockWriteFile = vi.mocked(fs.writeFile)

describe('getDatapackMetadataPath', () => {
  it('appends the metadata filename to the directory', () => {
    expect(getDatapackMetadataPath('/dp')).toBe(path.join('/dp', '.mpp-datapack'))
  })
})

describe('createDefaultDatapackMetadata', () => {
  it('fills sensible defaults', () => {
    const meta = createDefaultDatapackMetadata('My Pack', 'MP', '26.1.2')
    expect(meta).toMatchObject({
      version: 1,
      name: 'My Pack',
      id: 'MP',
      packVersion: '1.00.00',
      minecraftVersion: '26.1.2',
      author: 'unknown',
      packFormatVersionMin: 12,
      packFormatVersionMax: 12,
      tags: [],
    })
    expect(() => new Date(meta.lastOpened).toISOString()).not.toThrow()
  })

  it('falls back to the bundled minecraft version when none is given', () => {
    expect(createDefaultDatapackMetadata('p', 'id').minecraftVersion).toBe('26.1.2')
    expect(createDefaultDatapackMetadata('p', 'id', '   ').minecraftVersion).toBe('26.1.2')
  })
})

describe('updateDatapackLastOpened', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('returns a new object with a refreshed timestamp, preserving other fields', () => {
    const base: DatapackMetadata = {
      ...createDefaultDatapackMetadata('p', 'id', '26.1.2'),
      lastOpened: '2000-01-01T00:00:00.000Z',
    }
    vi.setSystemTime(new Date('2026-06-27T12:00:00.000Z'))

    const updated = updateDatapackLastOpened(base)

    expect(updated).not.toBe(base)
    expect(updated.lastOpened).toBe('2026-06-27T12:00:00.000Z')
    expect(updated.name).toBe('p')
    expect(updated.id).toBe('id')
  })
})

describe('parseDatapackMetadata (fs wrapper)', () => {
  beforeEach(() => {
    mockReadFile.mockReset()
    mockWriteFile.mockReset()
    mockWriteFile.mockResolvedValue(undefined)
  })

  it('returns null when the metadata file cannot be read', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'))
    expect(await parseDatapackMetadata('/dp')).toBeNull()
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('returns null for invalid JSON', async () => {
    mockReadFile.mockResolvedValue('{ not json')
    expect(await parseDatapackMetadata('/dp')).toBeNull()
  })

  it('sanitizes invalid fields and rewrites the file when the result differs', async () => {
    // version is the wrong type, so sanitize coerces it back to the default (1)
    mockReadFile.mockResolvedValue(JSON.stringify({ name: 'Pack', id: 'PX', version: 'bad' }))

    const result = await parseDatapackMetadata('/dp')

    expect(result?.name).toBe('Pack')
    expect(result?.id).toBe('PX')
    expect(result?.version).toBe(1)
    expect(mockWriteFile).toHaveBeenCalledTimes(1)
    expect(mockWriteFile).toHaveBeenCalledWith(
      path.join('/dp', '.mpp-datapack'),
      expect.any(String),
      'utf-8',
    )
  })

  it('does not rewrite when the stored metadata is already canonical', async () => {
    // Keys in the exact order sanitizeDatapackMetadata emits them, all valid,
    // so JSON.stringify(parsed) === JSON.stringify(sanitized).
    const canonical = {
      version: 1,
      lastOpened: '2020-01-01T00:00:00.000Z',
      name: 'dp',
      packVersion: '1.00.00',
      minecraftVersion: '26.1.2',
      id: 'DP',
      author: 'unknown',
      description: 'desc',
      packFormatVersionMin: 12,
      packFormatVersionMax: 12,
      tags: [],
    }
    mockReadFile.mockResolvedValue(JSON.stringify(canonical))

    const result = await parseDatapackMetadata('/dp')

    expect(result).toEqual(canonical)
    expect(mockWriteFile).not.toHaveBeenCalled()
  })
})

describe('writeDatapackMetadata (fs wrapper)', () => {
  beforeEach(() => {
    mockReadFile.mockReset()
    mockWriteFile.mockReset()
  })

  it('writes sanitized metadata to the datapack file', async () => {
    mockWriteFile.mockResolvedValue(undefined)
    const meta = createDefaultDatapackMetadata('Pack', 'PK', '26.1.2')

    await writeDatapackMetadata('/dp', meta)

    expect(mockWriteFile).toHaveBeenCalledWith(
      path.join('/dp', '.mpp-datapack'),
      expect.any(String),
      'utf-8',
    )
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    expect(written.name).toBe('Pack')
    expect(written.id).toBe('PK')
  })

  it('wraps a write failure in a descriptive error', async () => {
    mockWriteFile.mockRejectedValue(new Error('disk full'))
    const meta = createDefaultDatapackMetadata('Pack', 'PK', '26.1.2')

    await expect(writeDatapackMetadata('/dp', meta)).rejects.toThrow(
      'Failed to write datapack metadata: disk full',
    )
  })
})
