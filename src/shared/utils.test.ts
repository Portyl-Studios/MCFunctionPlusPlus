import { describe, it, expect } from 'vitest'
import {
  isDottedNumericVersion,
  compareDottedVersions,
  incrementPatchVersion,
  resetPatchOnMajorMinorIncrement,
} from './utils'

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

describe('incrementPatchVersion', () => {
  it('bumps the patch segment preserving zero-pad width', () => {
    expect(incrementPatchVersion('1.00.00')).toBe('1.00.01')
    expect(incrementPatchVersion('1.00.09')).toBe('1.00.10')
    expect(incrementPatchVersion('2.13.04')).toBe('2.13.05')
  })

  it('grows the patch width when the number needs more digits', () => {
    expect(incrementPatchVersion('1.00.99')).toBe('1.00.100')
    expect(incrementPatchVersion('1.0.9')).toBe('1.0.10')
  })

  it('returns the input unchanged when malformed', () => {
    expect(incrementPatchVersion('1.0')).toBe('1.0')
    expect(incrementPatchVersion('1.x.0')).toBe('1.x.0')
    expect(incrementPatchVersion('')).toBe('')
    expect(incrementPatchVersion('beta')).toBe('beta')
  })
})

describe('resetPatchOnMajorMinorIncrement', () => {
  it('resets patch to 0 when minor is bumped', () => {
    expect(resetPatchOnMajorMinorIncrement('1.00.07', '1.01.07')).toBe('1.01.00')
  })

  it('resets patch to 0 when major is bumped', () => {
    expect(resetPatchOnMajorMinorIncrement('1.05.03', '2.05.03')).toBe('2.05.00')
  })

  it('preserves the patch when only the patch changes', () => {
    expect(resetPatchOnMajorMinorIncrement('1.00.00', '1.00.05')).toBe('1.00.05')
  })

  it('does not reset when major/minor decrease or stay equal', () => {
    expect(resetPatchOnMajorMinorIncrement('1.02.04', '1.02.04')).toBe('1.02.04')
    expect(resetPatchOnMajorMinorIncrement('2.00.04', '1.09.04')).toBe('1.09.04')
  })

  it('returns next unchanged when either version is malformed', () => {
    expect(resetPatchOnMajorMinorIncrement('1.0', '2.0.0')).toBe('2.0.0')
    expect(resetPatchOnMajorMinorIncrement('1.0.0', 'bad')).toBe('bad')
  })
})
