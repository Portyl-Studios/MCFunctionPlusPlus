import { StreamLanguage } from "@codemirror/language"
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete"
import { json as jsonStreamParser } from "@codemirror/legacy-modes/mode/javascript"

type McFunctionStreamState = {
  atLineStart: boolean
  atCommandStart: boolean
  isContinuedLine: boolean
  isInvalidLine: boolean

  //bracketDepth: number
  //angleBracketDepth: number // <>
  squareBracketDepth: number  // []
  parenDepth: number          // ()
  braceDepth: number          // {}
  apostropheDepth: number     // '
  quotationDepth: number      // "
  
  expectingBracketKey: boolean
  expectingBracketValue: boolean
  expectingQuotedBracketStringValue: boolean
  expectingQuotedBracketCommandValue: boolean
  inQuotedBracketStringValue: boolean
  inQuotedBracketCommandValue: boolean
  quotedBracketValueCanStartCommand: boolean

  nextExpected: "score_holder" | "objective" | null
}

type CommandNode = {
  type?: string
  children?: Record<string, CommandNode>
  redirect?: string[]
  parser?: string
}

type CommandSchemaRoot = {
  type?: string
  children?: Record<string, CommandNode>
}

const DEFAULT_COMMAND_SCHEMA_VERSION = "1.21.11"

let commandSchema: CommandSchemaRoot = { type: "root", children: {} }
let rootCommandNames = new Set<string>()
let blockIds: string[] = []
let itemIds: string[] = []
let entityTypeIds: string[] = []
let biomeIds: string[] = []
let enchantmentIds: string[] = []
let particleTypeIds: string[] = []
let soundEventIds: string[] = []
let gameEventIds: string[] = []
let potionIds: string[] = []
let dimensionIds: string[] = []

const createJsonState = () => (jsonStreamParser.startState ? jsonStreamParser.startState(2) : {})

const rebuildCommandIndexes = () => {
  rootCommandNames = new Set(Object.keys(commandSchema.children ?? {}))
}

const normalizeCommandToken = (token: string) => token.replace(/^\//, "")

const resolveRedirectNode = (node: CommandNode | undefined): CommandNode | undefined => {
  let current = node
  const visited = new Set<CommandNode>()

  while (current?.redirect && current.redirect.length > 0) {
    if (visited.has(current)) break
    visited.add(current)

    const [firstSegment, ...remainingSegments] = current.redirect
    if (!firstSegment) break

    let redirected: CommandNode | undefined = (commandSchema.children ?? {})[firstSegment]
    for (const segment of remainingSegments) {
      redirected = redirected?.children?.[segment]
      if (!redirected) break
    }

    if (!redirected) break
    current = redirected
  }

  return current
}

const getEffectiveChildren = (node: CommandNode | CommandSchemaRoot | undefined) => {
  const resolved = resolveRedirectNode(node as CommandNode)
  return resolved?.children ?? node?.children ?? {}
}

const tokenizeCommand = (input: string) => {
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

// Helper: determine how many tokens a parser consumes
const getParserTokenCount = (parserId: string): number => {
  const multiTokenParsers: Record<string, number> = {
    "minecraft:block_pos": 3,
    "minecraft:column_pos": 2,
    "minecraft:vec2": 2,
    "minecraft:vec3": 3,
    "minecraft:rotation": 2,
  }
  return multiTokenParsers[parserId] ?? 1
}

const resolveNodeForTokens = (tokens: string[]) => {
  let current: CommandNode | undefined
  let children = commandSchema.children ?? {}

  let index = 0
  while (index < tokens.length) {
    const rawToken = tokens[index]
    const token = index === 0 ? normalizeCommandToken(rawToken) : rawToken
    if (!token) return undefined

    let nextNode: CommandNode | undefined = children[token]
    let tokensConsumed = 1

    if (!nextNode) {
      // Try to match an argument child
      const argumentEntry = Object.entries(children).find(([, child]) => child.type === "argument")
      nextNode = argumentEntry?.[1]
      
      // If we found an argument, check if it consumes multiple tokens
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

const buildLiteralCompletions = (children: Record<string, CommandNode>): Completion[] => {
  return Object.entries(children)
    .filter(([, child]) => child.type === "literal")
    .map(([label]) => {
      return {
        label,
        type: "keyword",
      }
    })
}

// Get registry-based suggestions for argument parsers
const getDynamicSuggestionsForParser = (parserId: string): string[] => {
  // Basic type suggestions
  const basicSuggestions: Record<string, string[]> = {
    "brigadier:bool": ["true", "false"],
    "brigadier:integer": ["0", "1", "-1"],
    "brigadier:float": ["0.0", "0.5", "1.0"],
    "brigadier:double": ["0.0", "0.5", "1.0"],
    "minecraft:entity": ["@s", "@p", "@a", "@e"],
    "minecraft:game_profile": ["@a"],
    "minecraft:block_pos": ["~ ~ ~", "0 64 0"],
    "minecraft:vec2": ["~ ~", "0 0"],
    "minecraft:vec3": ["~ ~ ~", "0 64 0"],
    "minecraft:rotation": ["~ ~", "0 0"],
    "minecraft:score_holder": ["@s", "*"],
    "minecraft:message": ["\"text\""],
    "minecraft:nbt_compound_tag": ["{}"],
    "minecraft:nbt_path": ["path"],
    "minecraft:time": ["1s", "20t", "1d"],
    "minecraft:gamemode": ["survival", "creative", "adventure", "spectator"],
    "minecraft:entity_anchor": ["feet", "eyes"],
  }

  // Registry-powered suggestions (only if data is loaded)
  if (parserId === "minecraft:block_state" || parserId === "minecraft:block_predicate") {
    return blockIds.length > 0 ? blockIds.slice(0, 100) : ["minecraft:stone"]
  }

  if (parserId === "minecraft:item_stack" || parserId === "minecraft:item_predicate") {
    return itemIds.length > 0 ? itemIds.slice(0, 100) : ["minecraft:stick"]
  }

  if (parserId === "minecraft:dimension") {
    return dimensionIds.length > 0 ? dimensionIds : ["minecraft:overworld", "minecraft:the_nether", "minecraft:the_end"]
  }

  if (parserId === "minecraft:entity_summon") {
    return entityTypeIds.length > 0 ? entityTypeIds.slice(0, 100) : ["minecraft:pig"]
  }

  if (parserId === "minecraft:particle") {
    return particleTypeIds.length > 0 ? particleTypeIds.slice(0, 100) : ["minecraft:flame"]
  }

  if (parserId === "minecraft:resource_location" || parserId === "minecraft:function") {
    // For generic resource locations, provide samples from available registries
    const samples = [...new Set([
      ...itemIds.slice(0, 20),
      ...blockIds.slice(0, 20),
      ...entityTypeIds.slice(0, 20),
    ])]
    return samples.length > 0 ? samples : ["minecraft:"]
  }

  if (parserId === "minecraft:resource_or_tag" || parserId === "minecraft:resource_or_tag_key") {
    // Similar to above, but also include tag prefix
    const samples = [...new Set([
      ...itemIds.slice(0, 15),
      ...blockIds.slice(0, 15),
    ])]
    return samples.length > 0 ? [...samples, "#minecraft:"] : ["minecraft:", "#minecraft:"]
  }

  return basicSuggestions[parserId] ?? []
}

const buildArgumentCompletions = (children: Record<string, CommandNode>): Completion[] => {
  return Object.entries(children)
    .filter(([, child]) => child.type === "argument")
    .flatMap(([argumentName, child]) => {
      const parserId = child.parser ?? "argument"
      const parserSuggestions = getDynamicSuggestionsForParser(parserId)

      const concreteSuggestions = parserSuggestions.map((label) => ({
        label,
        type: "variable",
        detail: `<${argumentName}>`,
        info: `${parserId}`,
      } satisfies Completion))

      if (concreteSuggestions.length > 0) {
        return concreteSuggestions
      }

      return [{
        label: `<${argumentName}>`,
        type: "type",
        detail: parserId,
        info: `Expected next argument: ${argumentName}`,
      } satisfies Completion]
    })
}

const normalizeCompletionForMatch = (value: string) => {
  return normalizeCommandToken(value)
    .replace(/^</, "")
    .replace(/>$/, "")
    .toLowerCase()
}

export const loadMcfunctionCommandSchema = async (version: string = DEFAULT_COMMAND_SCHEMA_VERSION) => {
  const electronApi = (window as any)?.electron
  if (!electronApi?.commandSchemaGet) {
    console.error("[MCFunction] No electron API available for command schema")
    return false
  }

  try {
    const schemaRaw = await electronApi.commandSchemaGet(version)
    const parsed = JSON.parse(schemaRaw) as CommandSchemaRoot
    if (!parsed || typeof parsed !== "object" || !parsed.children || typeof parsed.children !== "object") {
      throw new Error("Invalid command schema structure")
    }

    commandSchema = parsed
    rebuildCommandIndexes()
    console.log(`[MCFunction] Loaded command schema with ${Object.keys(commandSchema.children ?? {}).length} root commands`)
    return true
  } catch (error) {
    console.error("[MCFunction] Failed to load command schema:", error)
    return false
  }
}

const loadMinecraftRegistry = async (version: string, registryName: string): Promise<string[]> => {
  const electronApi = (window as any)?.electron
  if (!electronApi?.minecraftDataGet) return []

  try {
    const registriesRaw = await electronApi.minecraftDataGet(version, "registries")
    const registries = JSON.parse(registriesRaw)
    const registry = registries[`minecraft:${registryName}`]
    if (!registry?.entries) return []
    return Object.keys(registry.entries)
  } catch {
    return []
  }
}

const loadMinecraftDataFile = async (version: string, dataType: string): Promise<string[]> => {
  const electronApi = (window as any)?.electron
  if (!electronApi?.minecraftDataGet) return []

  try {
    const dataRaw = await electronApi.minecraftDataGet(version, dataType)
    const data = JSON.parse(dataRaw)
    return Object.keys(data)
  } catch {
    return []
  }
}

export const loadMinecraftData = async (version: string = DEFAULT_COMMAND_SCHEMA_VERSION) => {
  try {
    const [
      blocks,
      items,
      entityTypes,
      biomes,
      enchantments,
      particleTypes,
      soundEvents,
      gameEvents,
      potions,
      dimensions,
    ] = await Promise.all([
      loadMinecraftDataFile(version, "blocks"),
      loadMinecraftDataFile(version, "items"),
      loadMinecraftRegistry(version, "entity_type"),
      loadMinecraftRegistry(version, "biome"),
      loadMinecraftRegistry(version, "enchantment"),
      loadMinecraftRegistry(version, "particle_type"),
      loadMinecraftRegistry(version, "sound_event"),
      loadMinecraftRegistry(version, "game_event"),
      loadMinecraftRegistry(version, "potion"),
      loadMinecraftRegistry(version, "dimension"),
    ])

    blockIds = blocks
    itemIds = items
    entityTypeIds = entityTypes
    biomeIds = biomes
    enchantmentIds = enchantments
    particleTypeIds = particleTypes
    soundEventIds = soundEvents
    gameEventIds = gameEvents
    potionIds = potions
    dimensionIds = dimensions

    console.log(`[MCFunction] Loaded Minecraft data: ${blocks.length} blocks, ${items.length} items, ${entityTypes.length} entity types`)
  } catch (error) {
    console.error("[MCFunction] Failed to load Minecraft data:", error)
  }
}

export const mcfunctionCompletionSource = (context: CompletionContext): CompletionResult | null => {
  const line = context.state.doc.lineAt(context.pos)
  const beforeCursor = line.text.slice(0, context.pos - line.from)

  if (/^\s*#/.test(beforeCursor)) return null

  // Check for entity selector context: @e[type=
  const entitySelectorMatch = beforeCursor.match(/@[apse]\[([^\]]*)$/)
  if (entitySelectorMatch) {
    const selectorContent = entitySelectorMatch[1]
    const from = context.pos - (selectorContent.split(/[,=]/).pop()?.length ?? 0)
    
    // Inside selector after "type="
    if (selectorContent.match(/type=\w*$/)) {
      const partial = selectorContent.match(/type=(\w*)$/)?.[1] ?? ""
      
      if (entityTypeIds.length === 0) {
        console.warn("[MCFunction] Entity type suggestions requested but no entity data loaded")
      }
      
      const options = entityTypeIds
        .filter(id => !partial || id.toLowerCase().includes(partial.toLowerCase()))
        .slice(0, 100)
        .map(id => ({
          label: id,
          type: "variable" as const,
          info: "Entity type",
        }))
      
      return options.length > 0 ? { from, options } : null
    }
    
    // Suggest selector arguments
    const args = ["type=", "tag=", "name=", "distance=", "x=", "y=", "z=", "dx=", "dy=", "dz=", "scores=", "limit=", "sort=", "nbt="]
    const partial = selectorContent.split(",").pop() ?? ""
    const options = args
      .filter(arg => arg.startsWith(partial.toLowerCase()))
      .map(arg => ({
        label: arg,
        type: "property" as const,
        info: "Selector argument",
      }))
    
    return options.length > 0 ? { from, options } : null
  }

  // Check for resource location context: minecraft:
  const resourceMatch = beforeCursor.match(/\b(minecraft:|[a-z_][a-z0-9_]*:)([a-z0-9_/]*)$/i)
  if (resourceMatch) {
    const namespace = resourceMatch[1]
    const partial = resourceMatch[2]
    const from = context.pos - partial.length
    
    // Determine what kind of resource based on command context
    // If there's a "run" keyword, extract command after it; otherwise extract from start
    let commandContext = beforeCursor
    const runMatch = beforeCursor.match(/\brun\s+/)
    if (runMatch) {
      const runIndex = beforeCursor.lastIndexOf(runMatch[0])
      commandContext = beforeCursor.slice(runIndex + runMatch[0].length)
    }
    
    const commandMatch = commandContext.match(/^\s*\/?([a-z_]+)/)
    const command = commandMatch?.[1]
    
    let suggestions: string[] = []
    if (command === "give" || command === "item") {
      suggestions = itemIds
    } else if (command === "setblock" || command === "fill") {
      suggestions = blockIds
    } else if (command === "summon") {
      suggestions = entityTypeIds
    } else if (command === "particle") {
      suggestions = particleTypeIds
    } else {
      // Generic - combine common registries
      suggestions = [...new Set([...blockIds, ...itemIds, ...entityTypeIds])]
    }
    
    if (suggestions.length === 0) {
      console.warn(`[MCFunction] Resource suggestions requested for '${command}' but no data loaded`)
    }
    
    const options = suggestions
      .filter(id => id.startsWith(namespace) && (!partial || id.slice(namespace.length).toLowerCase().startsWith(partial.toLowerCase())))
      .slice(0, 100)
      .map(id => ({
        label: id.slice(namespace.length),
        type: "constant" as const,
        info: id,
      }))
    
    return options.length > 0 ? { from, options } : null
  }

  // Schema-based completion
  const endsWithSpace = /\s$/.test(beforeCursor)
  const tokens = tokenizeCommand(beforeCursor)
  const activeToken = endsWithSpace ? "" : (tokens.pop() ?? "")
  let pathTokens = tokens

  // Handle "execute ... run <command>" - treat tokens after "run" as new command
  const runIndex = pathTokens.lastIndexOf("run")
  if (runIndex !== -1) {
    // Check if "run" is actually a literal in the execute command path
    const tokensBeforeRun = pathTokens.slice(0, runIndex)
    const nodeBeforeRun = tokensBeforeRun.length === 0 
      ? ({ children: commandSchema.children } as CommandNode)
      : resolveNodeForTokens(tokensBeforeRun)
    
    if (nodeBeforeRun) {
      const childMap = getEffectiveChildren(nodeBeforeRun)
      // Check if "run" is a valid literal child at this position
      if (childMap["run"]?.type === "literal") {
        // Everything after "run" is a new command
        pathTokens = pathTokens.slice(runIndex + 1)
      }
    }
  }

  const from = context.pos - activeToken.length
  const firstTokenIsActive = pathTokens.length === 0

  const parentNode = firstTokenIsActive
    ? ({ children: commandSchema.children } as CommandNode)
    : resolveNodeForTokens(pathTokens)

  if (!parentNode) return null

  const childMap = getEffectiveChildren(parentNode)
  const options = [
    ...buildLiteralCompletions(childMap),
    ...buildArgumentCompletions(childMap),
  ]

  const normalizedTyped = normalizeCompletionForMatch(activeToken)
  const filteredOptions = normalizedTyped
    ? options.filter(option => normalizeCompletionForMatch(option.label).startsWith(normalizedTyped))
    : options

  // Show completions at the start of a line even without typing
  if (filteredOptions.length === 0 && !context.explicit && !firstTokenIsActive) return null

  return {
    from,
    options: filteredOptions.slice(0, 100),
    validFor: /^[a-z0-9_:<>-]*$/i,
  }
}

rebuildCommandIndexes()

export const mcfunctionLanguage = StreamLanguage.define<McFunctionStreamState>({
  startState() {
    return {
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
    }
  },
  copyState(state) {
    return {
      atLineStart: state.atLineStart,
      atCommandStart: state.atCommandStart,
      isContinuedLine: state.isContinuedLine,
      isInvalidLine: state.isInvalidLine,

      squareBracketDepth: state.squareBracketDepth,
      parenDepth: state.parenDepth,
      braceDepth: state.braceDepth,
      apostropheDepth: state.apostropheDepth,
      quotationDepth: state.quotationDepth,

      expectingBracketKey: state.expectingBracketKey,
      expectingBracketValue: state.expectingBracketValue,
      expectingQuotedBracketStringValue: state.expectingQuotedBracketStringValue,
      expectingQuotedBracketCommandValue: state.expectingQuotedBracketCommandValue,
      inQuotedBracketStringValue: state.inQuotedBracketStringValue,
      inQuotedBracketCommandValue: state.inQuotedBracketCommandValue,
      quotedBracketValueCanStartCommand: state.quotedBracketValueCanStartCommand,

      nextExpected: state.nextExpected,
    }
  },
  token(stream, state) {

    // Reset state at start of line
    // Ignore if it's a continued line
    if (stream.sol())
    {
      if (!state.isContinuedLine) {
        state.atLineStart = true
        state.atCommandStart = true
        state.isInvalidLine = false
      }
      else {
        state.isContinuedLine = false
      }
    }

    // Propogate invalid lines if they were marked as such in the previous line and continue to check for line continuation
    if (state.isInvalidLine) {
      state.isInvalidLine = true
      if (/\\\s*$/.test(stream.string)) {
        state.isContinuedLine = true
      }
      stream.skipToEnd()
      return "invalid"
    }

    // Consume spaces
    if (stream.eatSpace()) return null

    // Comments
    if (state.atLineStart && stream.peek() === "#") {
      stream.skipToEnd()
      return "comment"
    }

    // Brackets and quotes affect state and are important for determining context, so we handle them before anything else

    // Square Brackets []
    if (!state.inQuotedBracketStringValue && stream.peek() === "[") {
      state.squareBracketDepth += 1
      state.expectingBracketKey = true
      state.expectingBracketValue = false
      state.expectingQuotedBracketStringValue = false
      state.expectingQuotedBracketCommandValue = false
      state.inQuotedBracketStringValue = false
      state.inQuotedBracketCommandValue = false
      state.quotedBracketValueCanStartCommand = false
      stream.next()
      return "squareBracket"
    }
    if (!state.inQuotedBracketStringValue && stream.peek() === "]") {
      state.squareBracketDepth = Math.max(0, state.squareBracketDepth - 1)
      if (state.squareBracketDepth === 0) {
        state.expectingBracketKey = false
        state.expectingBracketValue = false
        state.expectingQuotedBracketStringValue = false
        state.expectingQuotedBracketCommandValue = false
        state.inQuotedBracketStringValue = false
        state.inQuotedBracketCommandValue = false
        state.quotedBracketValueCanStartCommand = false
      }
      stream.next()
      return "squareBracket"
    }

    // Parentheses ()
    if (!state.inQuotedBracketStringValue && stream.peek() === "(") {
      state.parenDepth += 1
      state.expectingBracketKey = true
      state.expectingBracketValue = false
      state.expectingQuotedBracketStringValue = false
      state.expectingQuotedBracketCommandValue = false
      state.inQuotedBracketStringValue = false
      state.inQuotedBracketCommandValue = false
      state.quotedBracketValueCanStartCommand = false
      stream.next()
      return "paren"
    }
    if (!state.inQuotedBracketStringValue && stream.peek() === ")") {
      state.parenDepth = Math.max(0, state.parenDepth - 1)
      if (state.parenDepth === 0) {
        state.expectingBracketKey = false
        state.expectingBracketValue = false
        state.expectingQuotedBracketStringValue = false
        state.expectingQuotedBracketCommandValue = false
        state.inQuotedBracketStringValue = false
        state.inQuotedBracketCommandValue = false
        state.quotedBracketValueCanStartCommand = false
      }
      stream.next()
      return "paren"
    }

    // Braces {}
    if (
      !state.inQuotedBracketStringValue && stream.peek() === "{"
    ) {
      state.braceDepth += 1
      state.expectingBracketKey = true
      state.expectingBracketValue = false
      state.expectingQuotedBracketStringValue = false
      state.expectingQuotedBracketCommandValue = false
      state.inQuotedBracketStringValue = false
      state.inQuotedBracketCommandValue = false
      state.quotedBracketValueCanStartCommand = false
      stream.next()
      return "brace"
    }
    if (!state.inQuotedBracketStringValue && stream.peek() === "}") {
      state.braceDepth = Math.max(0, state.braceDepth - 1)
      if (state.braceDepth === 0) {
        state.expectingBracketKey = false
        state.expectingBracketValue = false
        state.expectingQuotedBracketStringValue = false
        state.expectingQuotedBracketCommandValue = false
        state.inQuotedBracketStringValue = false
        state.inQuotedBracketCommandValue = false
        state.quotedBracketValueCanStartCommand = false
      }
      stream.next()
      return "brace"
    }

    if (state.inQuotedBracketCommandValue) {
      if (stream.peek() === '"') {
        state.inQuotedBracketCommandValue = false
        stream.next()
        return "string"
      }
    }

    // Quoted bracket value string for "text" / "value" keys only
    if (state.inQuotedBracketStringValue) {
      if (state.quotedBracketValueCanStartCommand) {
        if (stream.peek() === "/") {
          state.quotedBracketValueCanStartCommand = false
          state.inQuotedBracketStringValue = false
          state.inQuotedBracketCommandValue = true
          state.atCommandStart = true
          stream.next()
          return "keyword"
        }
        state.quotedBracketValueCanStartCommand = false
      }

      if (stream.match(/\$\([^)]+\)/)) return "macroName"
      if (stream.match(/(?:[^"\\$]|\\.)+/)) return "string"
      if (stream.peek() === '"') {
        state.inQuotedBracketStringValue = false
        stream.next()
        return "string"
      }
      stream.next()
      return "string"
    }

    if (
      (state.squareBracketDepth > 0 || state.braceDepth > 0 || state.parenDepth > 0) &&
      state.expectingBracketValue &&
      state.expectingQuotedBracketStringValue &&
      stream.peek() === '"'
    ) {
      state.inQuotedBracketStringValue = true
      state.quotedBracketValueCanStartCommand = state.expectingQuotedBracketCommandValue
      state.expectingQuotedBracketStringValue = false
      state.expectingQuotedBracketCommandValue = false
      stream.next()
      return "string"
    }

    if (
      (state.squareBracketDepth > 0 || state.braceDepth > 0 || state.parenDepth > 0) &&
      state.expectingBracketKey &&
      stream.peek() === '"'
    ) {
      if (stream.match(/"(text|value|command)"(?=\s*[:=])/)) {
        state.expectingQuotedBracketStringValue = true
        state.expectingQuotedBracketCommandValue =
          stream.current() === '"value"' || stream.current() === '"command"'
        return "attributeName"
      }

      if (stream.match(/"[A-Za-z0-9_$.#-]+"(?=\s*[:=])/)) {
        state.expectingQuotedBracketStringValue = false
        state.expectingQuotedBracketCommandValue = false
        return "attributeName"
      }
    }

    // Apostrophes
    if (stream.peek() === "'") {
      state.apostropheDepth += 1
      stream.next()
      return "string"
    }
    if (stream.peek() === "'") {
      state.apostropheDepth = Math.max(0, state.apostropheDepth - 1)
      stream.next()
      return "string"
    }

    // Quotation marks
    if (stream.peek() === '"') {
      state.quotationDepth += 1
      stream.next()
      return "string"
    }
    if (stream.peek() === '"') {
      state.quotationDepth = Math.max(0, state.quotationDepth - 1)
      stream.next()
      return "string"
    }

    // If we're inside any brackets, we want to check for key=value pairs and comma separators
    if (state.squareBracketDepth > 0 || state.braceDepth > 0 || state.parenDepth > 0) {
      // Handle separators (: and =)
      if (stream.match(/[:=]/)) {
        state.expectingBracketKey = false
        state.expectingBracketValue = true
        return "punctuation"
      }

      // Handle the Comma separator
      if (stream.match(",")) {
        state.expectingBracketKey = true
        state.expectingBracketValue = false
        state.expectingQuotedBracketStringValue = false
        state.expectingQuotedBracketCommandValue = false
        state.inQuotedBracketStringValue = false
        state.inQuotedBracketCommandValue = false
        state.quotedBracketValueCanStartCommand = false
        return "punctuation"
      }
    }


    // Preprocessor
    
    // Matches lines starting with $
    if (state.atCommandStart && stream.match("$")) {
      return "macroName"
    }

    // Matches the format $(...) for preprocessor variables
    if (stream.match(/\$\([^)]+\)/)) {
      return "macroName"
    }


    // Root command
    if (state.atCommandStart &&
      stream.match(/[a-z0-9_:-]+/i)
    ) {
      const commandToken = normalizeCommandToken(stream.current())
      state.atLineStart = false
      state.atCommandStart = false
      if (rootCommandNames.has(commandToken)) {
        return "keyword"
      }
      else {
        state.isInvalidLine = true
        if (/\\\s*$/.test(stream.string)) {
          state.isContinuedLine = true
        }
        stream.skipToEnd()
        return "invalid"
      }
    }

    // Root commands after execute ... run
    if (stream.match(/\brun\b/)) {
      state.atCommandStart = true
      return "controlKeyword"
    }

    // Same line operator
    // Matches \
    if (stream.match(/\\\s*$/)) {
      state.isContinuedLine = true
      return "operator"
    }

    // Escapes
    // Matches \ followed by any character (e.g., \[, \], \(, \), \{, \}, \$, etc.)
    if (stream.match(/\\./)) {
      return "escape"
    }

    // Namespaced IDs
    // Matches patterns like minecraft:stone, custom_namespace:custom_id, etc.
    // Only match early if we're expecting a key or value in brackets, to avoid coloring normal command tokens that happen to have colons
    if (state.expectingBracketValue && stream.peek() !== '"' && stream.match(/#?[a-z_][a-z0-9_.-]*:[a-z0-9_./-]+/)) return "namespace"
    if (
      state.expectingBracketKey &&
      (stream.string[stream.pos - 1] === '"' || stream.string[stream.pos - 1] === "'") &&
      stream.match(/#?[a-z_][a-z0-9_.-]*:[a-z0-9_./-]+(?=["'])/)
    ) return "namespace"

    // Coordinates
    // Matches a set of 2 or 3 coordinates with either ~ or ^ (e.g., ~ ~-1 ~, ^1 ^2 ^3, etc.)
    if (stream.match(/^[~^]-?\d*\.?\d*(?:\s+[~^]-?\d*\.?\d*){1,2}/)) {
      return "number"
    }

    // Numbers
    // Matches patterns like 0, 12, 12.3, 1..2, 1.., ..2, 1t, 2s, 3d, etc.
    if (stream.match(/^-?\d+\.\.\d+|-?\d+\.\.|\.\.-?\d+|-?\d+(\.\d+)?[bslfdts]?/)) return "number"


    // Now we handle the context within brackets

    // Bracket/brace/paren key value pairs
    // Matches patterns like [type=pig,name=Bob,distance=..5], {key:value}, etc.
    if (state.squareBracketDepth > 0 || state.braceDepth > 0 || state.parenDepth > 0) {
      
      // Match the actual text (key or value)
      const match = stream.match(/[A-Za-z0-9_$.#-]+/)
      if (match && typeof match !== "boolean") {
        if (state.expectingBracketKey) {
          // Color for the KEY (e.g., 'type' or 'name')
          return "attributeName" 
        } else if (state.expectingBracketValue) {
          state.expectingQuotedBracketStringValue = false
          state.expectingQuotedBracketCommandValue = false
          // Color for the VALUE (e.g., 'pig' or '1..5')
          return "attributeValue"
        }
      }

    }

    
    // Namespaced IDs
    // Matches patterns like minecraft:stone, custom_namespace:custom_id, etc.
    // Secondary match for namespaced IDs that appear outside of brackets or after keywords, to catch all the other cases after we've handled brackets above
    if (stream.match(/#?[a-z_][a-z0-9_.-]*:[a-z0-9_./-]+/)) return "namespace"

    // Control keywords
    // Matches if, unless
    if (stream.match(/\b(if|unless)\b/)) {
      //return "controlKeyword"
    }

    // Entity selectors
    // Matches patterns like @e, @p, @a, @s
    if (stream.match(/@[a-z]/)) return "labelName"

    // Special case for operator keywords
    // Matches add, remove, operation, get, set, reset, merge, modify, append, insert, prepend
    if (stream.match(/\b(add|remove|operation|get|set|reset|merge|modify|append|insert|prepend)\b/)) return "operatorKeyword"

    // Math operators
    // Matches =, +=, -=, *=, /=, %=, >< (swapping), <, <=, >, >=, !=, matches
    if (stream.match(/[=<>]|[-+*/%\!<>]=|><|matches/)) return "operator"

    // Custom player name variables
    // Matches patterns like:
    // - test$123, player_name$score, etc.
    // - $score, $player_name, etc.
    // - #score, #player_name, etc.
    if (stream.match(/[a-zA-Z0-9_.]+\$[a-zA-Z0-9_.]+|[\$\#][a-zA-Z0-9_.]+/)) return "variableName"

    // Generic identifiers (consume whole words so suffixes like "Target" don't tokenize as "get")
    if (stream.match(/[A-Za-z_][A-Za-z0-9_.-]*/)) return null

    stream.next()
    return null

  },
})
