import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createDefaultDatapackMetadata,
  getDatapackMetadataPath,
  parseDatapackMetadata,
  updateDatapackLastOpened,
  writeDatapackMetadata,
} from '../../src/main/datapack-parser'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directoryPath) =>
      rm(directoryPath, { recursive: true, force: true }),
    ),
  )
})

describe('datapack-parser', () => {
  it('builds datapack metadata path with extension', () => {
    const result = getDatapackMetadataPath('C:/workspace/datapack')
    expect(result).toBe(path.join('C:/workspace/datapack', '.mpp-datapack'))
  })

  it('creates default metadata with expected baseline fields', () => {
    const metadata = createDefaultDatapackMetadata('Pack Name', 'pack.id')
    expect(metadata.version).toBe(1)
    expect(metadata.name).toBe('Pack Name')
    expect(metadata.id).toBe('pack.id')
    expect(metadata.isDisabled).toBe(false)
    expect(metadata.tags).toEqual([])
  })

  it('updates last opened timestamp', () => {
    const metadata = {
      ...createDefaultDatapackMetadata('Pack Name', 'pack.id'),
      lastOpened: '2000-01-01T00:00:00.000Z',
    }
    const originalTimestamp = metadata.lastOpened
    const updated = updateDatapackLastOpened(metadata)

    expect(updated.lastOpened).not.toBe(originalTimestamp)
    expect(Number.isNaN(Date.parse(updated.lastOpened))).toBe(false)
    expect(updated.id).toBe(metadata.id)
    expect(updated.name).toBe(metadata.name)
  })

  it('writes and parses datapack metadata', async () => {
    const directoryPath = await mkdtemp(path.join(tmpdir(), 'mcpp-datapack-test-'))
    temporaryDirectories.push(directoryPath)

    const metadata = createDefaultDatapackMetadata('Example Pack', 'example.pack')
    metadata.author = 'tester'

    await writeDatapackMetadata(directoryPath, metadata)

    const parsed = await parseDatapackMetadata(directoryPath)
    expect(parsed).not.toBeNull()
    expect(parsed?.id).toBe('example.pack')
    expect(parsed?.author).toBe('tester')
  })

  it('returns null for missing metadata file', async () => {
    const parsed = await parseDatapackMetadata('C:/missing/path')
    expect(parsed).toBeNull()
  })
})
