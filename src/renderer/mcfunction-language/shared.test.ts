import { describe, it, expect, beforeEach } from 'vitest'
import {
  mcfunctionStore,
  rebuildCommandIndexes,
  normalizeCommandToken,
  resolveRedirectNode,
  getEffectiveChildren,
  tokenizeCommand,
  getParserTokenCount,
  resolveNodeForTokens,
  type CommandSchemaRoot,
} from './shared'

const SCHEMA: CommandSchemaRoot = {
  type: 'root',
  children: {
    say: {
      type: 'literal',
      children: {
        message: { type: 'argument', parser: 'minecraft:message', executable: true },
      },
    },
    teleport: {
      type: 'literal',
      children: {
        location: { type: 'argument', parser: 'minecraft:vec3', executable: true },
      },
    },
    tp: { type: 'literal', redirect: ['teleport'] },
  },
}

beforeEach(() => {
  mcfunctionStore.commandSchema = SCHEMA
  rebuildCommandIndexes()
})

describe('normalizeCommandToken', () => {
  it('strips a single leading slash', () => {
    expect(normalizeCommandToken('/say')).toBe('say')
    expect(normalizeCommandToken('say')).toBe('say')
  })
})

describe('rebuildCommandIndexes', () => {
  it('rebuilds the root command name set from the schema', () => {
    expect([...mcfunctionStore.rootCommandNames].sort()).toEqual(['say', 'teleport', 'tp'])
  })
})

describe('resolveRedirectNode', () => {
  it('follows a redirect to the target node', () => {
    const tp = SCHEMA.children!.tp
    const resolved = resolveRedirectNode(tp)
    expect(resolved).toBe(SCHEMA.children!.teleport)
  })

  it('returns the node unchanged when there is no redirect', () => {
    const say = SCHEMA.children!.say
    expect(resolveRedirectNode(say)).toBe(say)
  })
})

describe('getEffectiveChildren', () => {
  it('returns the redirect target children', () => {
    expect(Object.keys(getEffectiveChildren(SCHEMA.children!.tp))).toEqual(['location'])
  })
})

describe('tokenizeCommand', () => {
  it('keeps brace and bracket groups intact', () => {
    expect(tokenizeCommand('say {a: 1}')).toEqual(['say', '{a: 1}'])
    expect(tokenizeCommand('tp @e[type=cow, limit=1]')).toEqual(['tp', '@e[type=cow, limit=1]'])
  })

  it('preserves a leading slash on the command token', () => {
    expect(tokenizeCommand('/give @s stone')).toEqual(['/give', '@s', 'stone'])
  })

  it('keeps double-quoted strings (with whitespace) intact', () => {
    expect(tokenizeCommand('say "hello world"')).toEqual(['say', '"hello world"'])
  })

  it('keeps single-quoted strings intact', () => {
    expect(tokenizeCommand("tellraw @a 'a b c'")).toEqual(['tellraw', '@a', "'a b c'"])
  })

  it('treats an escaped space as part of the token', () => {
    expect(tokenizeCommand('say a\\ b')).toEqual(['say', 'a\\ b'])
  })

  it('keeps an escaped quote from opening a quoted run', () => {
    expect(tokenizeCommand('say a\\"b c')).toEqual(['say', 'a\\"b', 'c'])
  })

  it('returns an empty list for whitespace-only input', () => {
    expect(tokenizeCommand('   ')).toEqual([])
  })
})

describe('getParserTokenCount', () => {
  it.each([
    ['minecraft:vec3', 3],
    ['minecraft:block_pos', 3],
    ['minecraft:column_pos', 2],
    ['minecraft:vec2', 2],
    ['minecraft:rotation', 2],
    ['minecraft:message', 1],
    ['unknown:parser', 1],
  ])('%s -> %d', (parser, count) => {
    expect(getParserTokenCount(parser)).toBe(count)
  })
})

describe('resolveNodeForTokens', () => {
  it('resolves a literal followed by an argument', () => {
    const node = resolveNodeForTokens(['say', 'hello'])
    expect(node).toBe(SCHEMA.children!.say.children!.message)
  })

  it('normalizes a leading slash on the first token', () => {
    expect(resolveNodeForTokens(['/say'])).toBe(SCHEMA.children!.say)
  })

  it('consumes multiple tokens for a multi-token parser', () => {
    const node = resolveNodeForTokens(['teleport', '0', '64', '0'])
    expect(node).toBe(SCHEMA.children!.teleport.children!.location)
  })

  it('follows redirects when resolving (tp -> teleport)', () => {
    const node = resolveNodeForTokens(['tp', '0', '64', '0'])
    expect(node).toBe(SCHEMA.children!.teleport.children!.location)
  })

  it('returns undefined for an unknown command', () => {
    expect(resolveNodeForTokens(['definitely-not-a-command'])).toBeUndefined()
  })

  it('returns undefined when the first token is empty', () => {
    expect(resolveNodeForTokens([''])).toBeUndefined()
  })
})

describe('getEffectiveChildren edge cases', () => {
  it('returns an empty object for an undefined node', () => {
    expect(getEffectiveChildren(undefined)).toEqual({})
  })
})
