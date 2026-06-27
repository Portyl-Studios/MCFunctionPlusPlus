import { describe, it, expect } from 'vitest'
import {
  normalizePathSeparators,
  trimLeadingSlashes,
  trimPathSlashes,
  getPathSegments,
  getPathLeafName,
  getDirFromPath,
  toRelativePaths,
  createFileKey,
  parseFileKey,
} from './utils'

describe('normalizePathSeparators', () => {
  it('converts backslashes to forward slashes', () => {
    expect(normalizePathSeparators('a\\b\\c')).toBe('a/b/c')
    expect(normalizePathSeparators('a/b')).toBe('a/b')
  })
})

describe('trimLeadingSlashes', () => {
  it('removes only leading slashes', () => {
    expect(trimLeadingSlashes('///a/b/')).toBe('a/b/')
    expect(trimLeadingSlashes('a')).toBe('a')
  })
})

describe('trimPathSlashes', () => {
  it('removes leading and trailing slashes', () => {
    expect(trimPathSlashes('/a/b/')).toBe('a/b')
    expect(trimPathSlashes('///a///')).toBe('a')
  })
})

describe('getPathSegments', () => {
  it('splits on either separator and drops empties', () => {
    expect(getPathSegments('a\\b//c')).toEqual(['a', 'b', 'c'])
    expect(getPathSegments('')).toEqual([])
  })
})

describe('getPathLeafName', () => {
  it('returns the last segment', () => {
    expect(getPathLeafName('a/b/c.txt')).toBe('c.txt')
    expect(getPathLeafName('a\\b')).toBe('b')
  })

  it('returns empty string for empty input', () => {
    expect(getPathLeafName('')).toBe('')
  })
})

describe('getDirFromPath', () => {
  it('strips the filename from the path', () => {
    expect(getDirFromPath('a/b/c.txt')).toBe('a/b')
    expect(getDirFromPath('a\\b\\c.txt')).toBe('a\\b')
  })

  it('returns the input when there is no separator', () => {
    expect(getDirFromPath('file.txt')).toBe('file.txt')
  })
})

describe('toRelativePaths', () => {
  it('strips the base dir prefix (case-insensitive)', () => {
    expect(toRelativePaths('C:/root', ['C:/root/sub/f.txt'])).toEqual(['sub/f.txt'])
    expect(toRelativePaths('C:/Root', ['c:/root/a.txt'])).toEqual(['a.txt'])
  })

  it('normalizes separators and tolerates a trailing slash on base', () => {
    expect(toRelativePaths('C:/root/', ['C:\\root\\a\\b.txt'])).toEqual(['a/b.txt'])
  })

  it('returns the normalized path when it is outside the base', () => {
    expect(toRelativePaths('C:/root', ['D:/other/x.txt'])).toEqual(['D:/other/x.txt'])
  })
})

describe('createFileKey / parseFileKey', () => {
  it('round-trips a datapack dir and relative path', () => {
    const key = createFileKey('C:/dp', 'data/fn/x.mcfunction')
    expect(key).toBe('C:/dp|data/fn/x.mcfunction')
    expect(parseFileKey(key)).toEqual({ datapackDir: 'C:/dp', relativePath: 'data/fn/x.mcfunction' })
  })

  it('splits only on the first separator', () => {
    expect(parseFileKey('a|b|c')).toEqual({ datapackDir: 'a', relativePath: 'b|c' })
  })

  it('treats a key with no separator as a bare dir', () => {
    expect(parseFileKey('justdir')).toEqual({ datapackDir: 'justdir', relativePath: '' })
  })
})
