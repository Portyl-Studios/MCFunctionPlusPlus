import { describe, it, expect } from 'vitest'
import {
  tokenizeCommandWithRanges,
  getRootCommandTokens,
  getQuotedRanges,
  isInQuotedRange,
  collectEntityTagsFromNbt,
} from './parse-utils'

const values = (input: string) => tokenizeCommandWithRanges(input).map((t) => t.value)

describe('tokenizeCommandWithRanges', () => {
  it('splits on whitespace with correct ranges', () => {
    expect(tokenizeCommandWithRanges('say hi')).toEqual([
      { value: 'say', start: 0, end: 3 },
      { value: 'hi', start: 4, end: 6 },
    ])
  })

  it('keeps brace and bracket groups as a single token', () => {
    expect(values('data merge block ~ ~ ~ {a: 1, b: 2}')).toEqual([
      'data', 'merge', 'block', '~', '~', '~', '{a: 1, b: 2}',
    ])
    expect(values('tp @e[type=cow, limit=1]')).toEqual(['tp', '@e[type=cow, limit=1]'])
  })

  it('does not split inside quoted strings', () => {
    expect(values('say "hello world"')).toEqual(['say', '"hello world"'])
  })

  it('ignores escaped quotes', () => {
    expect(values('say "a\\" b"')).toEqual(['say', '"a\\" b"'])
  })

  it('returns no tokens for blank input', () => {
    expect(tokenizeCommandWithRanges('   ')).toEqual([])
  })
})

describe('getRootCommandTokens', () => {
  it('unwraps execute ... run to the inner command', () => {
    const tokens = tokenizeCommandWithRanges('execute as @a at @s run say hi')
    expect(getRootCommandTokens(tokens).map((t) => t.value)).toEqual(['say', 'hi'])
  })

  it('strips a leading run token', () => {
    const tokens = tokenizeCommandWithRanges('run say hi')
    expect(getRootCommandTokens(tokens).map((t) => t.value)).toEqual(['say', 'hi'])
  })

  it('returns the tokens unchanged for a plain command', () => {
    const tokens = tokenizeCommandWithRanges('give @s stone')
    expect(getRootCommandTokens(tokens).map((t) => t.value)).toEqual(['give', '@s', 'stone'])
  })

  it('returns an empty list unchanged', () => {
    expect(getRootCommandTokens([])).toEqual([])
  })
})

describe('getQuotedRanges / isInQuotedRange', () => {
  it('finds the range covering a quoted string', () => {
    const text = 'say "hello world"'
    const ranges = getQuotedRanges(text)
    expect(ranges).toEqual([{ start: 4, end: 17 }])
    expect(isInQuotedRange(5, ranges)).toBe(true)
    expect(isInQuotedRange(1, ranges)).toBe(false)
    expect(isInQuotedRange(17, ranges)).toBe(false)
  })

  it('treats an unterminated quote as running to end of line', () => {
    expect(getQuotedRanges('say "oops')).toEqual([{ start: 4, end: 9 }])
  })

  it('ignores escaped quotes', () => {
    expect(getQuotedRanges('a \\" b')).toEqual([])
  })
})

describe('collectEntityTagsFromNbt', () => {
  it('extracts and unquotes tag names', () => {
    expect(collectEntityTagsFromNbt('Tags:["alpha","beta"]')).toEqual(['alpha', 'beta'])
  })

  it('deduplicates tags across multiple Tags lists', () => {
    expect(collectEntityTagsFromNbt('{Tags:["a"]} ... {Tags:["a","b"]}')).toEqual(['a', 'b'])
  })

  it('is case-insensitive on the Tags key and tolerant of spacing', () => {
    expect(collectEntityTagsFromNbt('tags : [ "x" , "y" ]')).toEqual(['x', 'y'])
  })

  it('returns an empty array when there are no tags', () => {
    expect(collectEntityTagsFromNbt('say hello')).toEqual([])
  })
})
