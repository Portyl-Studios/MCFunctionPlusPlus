import { describe, it, expect } from 'vitest'
import { isDottedNumericVersion, compareDottedVersions } from './utils'

describe('isDottedNumericVersion', () => {
  it.each([
    ['1.21', true],
    [' 1.21 ', true],
    ['1', true],
    ['26.1.2', true],
    ['1.21-pre1', false],
    ['', false],
    ['v1.2', false],
    ['1..2', false],
    ['1.', false],
    ['.1', false],
    ['abc', false],
  ])('%j -> %s', (input, expected) => {
    expect(isDottedNumericVersion(input)).toBe(expected)
  })
})

describe('compareDottedVersions', () => {
  it('orders by numeric segment value, not lexically', () => {
    expect(compareDottedVersions('1.21', '1.9')).toBe(1)
    expect(compareDottedVersions('1.9', '1.21')).toBe(-1)
  })

  it('treats missing trailing segments as zero', () => {
    expect(compareDottedVersions('1.21', '1.21.0')).toBe(0)
    expect(compareDottedVersions('1.2.0.0', '1.2')).toBe(0)
  })

  it('returns -1 / 0 / 1 for less / equal / greater', () => {
    expect(compareDottedVersions('1.0', '2.0')).toBe(-1)
    expect(compareDottedVersions('1.0', '1.0')).toBe(0)
    expect(compareDottedVersions('2.0', '1.9')).toBe(1)
  })

  it('coerces non-numeric segments to zero', () => {
    expect(compareDottedVersions('abc', '0')).toBe(0)
    expect(compareDottedVersions('1.x', '1.0')).toBe(0)
  })
})
