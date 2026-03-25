import { describe, expect, it } from 'vitest'

import {
  getQuotedRanges,
  getRootCommandTokens,
  isInQuotedRange,
  tokenizeCommandWithRanges,
} from '../../../src/renderer/mcfunction-language/parse-utils'

describe('parse-utils', () => {
  it('tokenizes command while preserving quoted spaces', () => {
    const tokens = tokenizeCommandWithRanges('say "hello world"')
    expect(tokens.map((token) => token.value)).toEqual(['say', '"hello world"'])
  })

  it('keeps bracket expressions as one token even with internal spaces', () => {
    const tokens = tokenizeCommandWithRanges('execute if entity @a[tag = test] run say hi')
    expect(tokens.map((token) => token.value)).toEqual([
      'execute',
      'if',
      'entity',
      '@a[tag = test]',
      'run',
      'say',
      'hi',
    ])
  })

  it('reduces execute run chain to root command tokens', () => {
    const tokens = tokenizeCommandWithRanges('execute as @s run execute if entity @a run say hi')
    const rootTokens = getRootCommandTokens(tokens)
    expect(rootTokens.map((token) => token.value)).toEqual(['say', 'hi'])
  })

  it('returns quoted ranges and index membership correctly', () => {
    const line = 'tellraw @a "hello world"'
    const ranges = getQuotedRanges(line)

    expect(ranges).toHaveLength(1)
    expect(line.slice(ranges[0].start, ranges[0].end)).toBe('"hello world"')
    expect(isInQuotedRange(line.indexOf('hello'), ranges)).toBe(true)
    expect(isInQuotedRange(line.indexOf('@a'), ranges)).toBe(false)
  })
})
