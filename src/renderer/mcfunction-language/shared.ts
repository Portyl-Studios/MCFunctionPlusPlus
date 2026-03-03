import { json as jsonStreamParser } from "@codemirror/legacy-modes/mode/javascript"

export type McFunctionStreamState = {
  atLineStart: boolean
  atCommandStart: boolean
  isContinuedLine: boolean
  isInvalidLine: boolean

  squareBracketDepth: number
  parenDepth: number
  braceDepth: number
  apostropheDepth: number
  quotationDepth: number

  expectingBracketKey: boolean
  expectingBracketValue: boolean
  expectingQuotedBracketStringValue: boolean
  expectingQuotedBracketCommandValue: boolean
  inQuotedBracketStringValue: boolean
  inQuotedBracketCommandValue: boolean
  quotedBracketValueCanStartCommand: boolean

  nextExpected: "score_holder" | "objective" | null
}

export type CommandNode = {
  type?: string
  children?: Record<string, CommandNode>
  redirect?: string[]
  parser?: string
  properties?: Record<string, unknown>
  executable?: boolean
  suggestions?: {
    provider?: string
  }
}

export type CommandSchemaRoot = {
  type?: string
  children?: Record<string, CommandNode>
}

export const DEFAULT_COMMAND_SCHEMA_VERSION = "1.21.11"

export const mcfunctionStore = {
  commandSchema: { type: "root", children: {} } as CommandSchemaRoot,
  rootCommandNames: new Set<string>(),

  blockIds: [] as string[],
  itemIds: [] as string[],
  entityTypeIds: [] as string[],
  biomeIds: [] as string[],
  enchantmentIds: [] as string[],
  particleTypeIds: [] as string[],
  soundEventIds: [] as string[],
  gameEventIds: [] as string[],
  potionIds: [] as string[],
  dimensionIds: [] as string[],
}

export const createJsonState = () => (jsonStreamParser.startState ? jsonStreamParser.startState(2) : {})

export const createInitialStreamState = (): McFunctionStreamState => ({
  atLineStart: true,
  atCommandStart: true,
  isContinuedLine: false,
  isInvalidLine: false,

  squareBracketDepth: 0,
  parenDepth: 0,
  braceDepth: 0,
  apostropheDepth: 0,
  quotationDepth: 0,

  expectingBracketKey: true,
  expectingBracketValue: false,
  expectingQuotedBracketStringValue: false,
  expectingQuotedBracketCommandValue: false,
  inQuotedBracketStringValue: false,
  inQuotedBracketCommandValue: false,
  quotedBracketValueCanStartCommand: false,

  nextExpected: null,
})

export const rebuildCommandIndexes = () => {
  mcfunctionStore.rootCommandNames = new Set(Object.keys(mcfunctionStore.commandSchema.children ?? {}))
}

export const normalizeCommandToken = (token: string) => token.replace(/^\//, "")

export const resolveRedirectNode = (node: CommandNode | undefined): CommandNode | undefined => {
  let current = node
  const visited = new Set<CommandNode>()

  while (current?.redirect && current.redirect.length > 0) {
    if (visited.has(current)) break
    visited.add(current)

    const [firstSegment, ...remainingSegments] = current.redirect
    if (!firstSegment) break

    let redirected: CommandNode | undefined = (mcfunctionStore.commandSchema.children ?? {})[firstSegment]
    for (const segment of remainingSegments) {
      redirected = redirected?.children?.[segment]
      if (!redirected) break
    }

    if (!redirected) break
    current = redirected
  }

  return current
}

export const getEffectiveChildren = (node: CommandNode | CommandSchemaRoot | undefined) => {
  const resolved = resolveRedirectNode(node as CommandNode)
  return resolved?.children ?? node?.children ?? {}
}

export const tokenizeCommand = (input: string) => {
  const tokens: string[] = []
  let current = ""
  let quote: "'" | '"' | null = null
  let escaped = false
  let braceDepth = 0
  let bracketDepth = 0

  for (const character of input) {
    if (escaped) {
      current += character
      escaped = false
      continue
    }

    if (character === "\\") {
      current += character
      escaped = true
      continue
    }

    if (quote) {
      current += character
      if (character === quote) quote = null
      continue
    }

    if (character === '"' || character === "'") {
      quote = character
      current += character
      continue
    }

    if (character === "{") {
      braceDepth += 1
      current += character
      continue
    }

    if (character === "}") {
      braceDepth = Math.max(0, braceDepth - 1)
      current += character
      continue
    }

    if (character === "[") {
      bracketDepth += 1
      current += character
      continue
    }

    if (character === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1)
      current += character
      continue
    }

    if (/\s/.test(character) && braceDepth === 0 && bracketDepth === 0) {
      if (current.length > 0) {
        tokens.push(current)
        current = ""
      }
      continue
    }

    current += character
  }

  if (current.length > 0) tokens.push(current)

  return tokens
}

export const getParserTokenCount = (parserId: string): number => {
  const multiTokenParsers: Record<string, number> = {
    "minecraft:block_pos": 3,
    "minecraft:column_pos": 2,
    "minecraft:vec2": 2,
    "minecraft:vec3": 3,
    "minecraft:rotation": 2,
  }
  return multiTokenParsers[parserId] ?? 1
}

export const resolveNodeForTokens = (tokens: string[]) => {
  let current: CommandNode | undefined
  let children = mcfunctionStore.commandSchema.children ?? {}

  let index = 0
  while (index < tokens.length) {
    const rawToken = tokens[index]
    const token = index === 0 ? normalizeCommandToken(rawToken) : rawToken
    if (!token) return undefined

    let nextNode: CommandNode | undefined = children[token]
    let tokensConsumed = 1

    if (!nextNode) {
      const argumentEntry = Object.entries(children).find(([, child]) => child.type === "argument")
      nextNode = argumentEntry?.[1]

      if (nextNode?.parser) {
        tokensConsumed = getParserTokenCount(nextNode.parser)
      }
    }

    if (!nextNode) return undefined

    current = resolveRedirectNode(nextNode) ?? nextNode
    children = getEffectiveChildren(current)
    index += tokensConsumed
  }

  return current
}
