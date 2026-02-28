import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete"
import {
  CommandNode,
  CommandSchemaRoot,
  DEFAULT_COMMAND_SCHEMA_VERSION,
  getEffectiveChildren,
  mcfunctionStore,
  normalizeCommandToken,
  rebuildCommandIndexes,
  resolveNodeForTokens,
  tokenizeCommand,
} from "./shared"

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

const getDynamicSuggestionsForParser = (parserId: string): string[] => {
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

  if (parserId === "minecraft:block_state" || parserId === "minecraft:block_predicate") {
    return mcfunctionStore.blockIds.length > 0 ? mcfunctionStore.blockIds.slice(0, 100) : ["minecraft:stone"]
  }

  if (parserId === "minecraft:item_stack" || parserId === "minecraft:item_predicate") {
    return mcfunctionStore.itemIds.length > 0 ? mcfunctionStore.itemIds.slice(0, 100) : ["minecraft:stick"]
  }

  if (parserId === "minecraft:dimension") {
    return mcfunctionStore.dimensionIds.length > 0 ? mcfunctionStore.dimensionIds : ["minecraft:overworld", "minecraft:the_nether", "minecraft:the_end"]
  }

  if (parserId === "minecraft:entity_summon") {
    return mcfunctionStore.entityTypeIds.length > 0 ? mcfunctionStore.entityTypeIds.slice(0, 100) : ["minecraft:pig"]
  }

  if (parserId === "minecraft:particle") {
    return mcfunctionStore.particleTypeIds.length > 0 ? mcfunctionStore.particleTypeIds.slice(0, 100) : ["minecraft:flame"]
  }

  if (parserId === "minecraft:resource_location" || parserId === "minecraft:function") {
    const samples = [...new Set([
      ...mcfunctionStore.itemIds.slice(0, 20),
      ...mcfunctionStore.blockIds.slice(0, 20),
      ...mcfunctionStore.entityTypeIds.slice(0, 20),
    ])]
    return samples.length > 0 ? samples : ["minecraft:"]
  }

  if (parserId === "minecraft:resource_or_tag" || parserId === "minecraft:resource_or_tag_key") {
    const samples = [...new Set([
      ...mcfunctionStore.itemIds.slice(0, 15),
      ...mcfunctionStore.blockIds.slice(0, 15),
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

    mcfunctionStore.commandSchema = parsed
    rebuildCommandIndexes()
    console.log(`[MCFunction] Loaded command schema with ${Object.keys(mcfunctionStore.commandSchema.children ?? {}).length} root commands`)
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

    mcfunctionStore.blockIds = blocks
    mcfunctionStore.itemIds = items
    mcfunctionStore.entityTypeIds = entityTypes
    mcfunctionStore.biomeIds = biomes
    mcfunctionStore.enchantmentIds = enchantments
    mcfunctionStore.particleTypeIds = particleTypes
    mcfunctionStore.soundEventIds = soundEvents
    mcfunctionStore.gameEventIds = gameEvents
    mcfunctionStore.potionIds = potions
    mcfunctionStore.dimensionIds = dimensions

    console.log(`[MCFunction] Loaded Minecraft data: ${blocks.length} blocks, ${items.length} items, ${entityTypes.length} entity types`)
  } catch (error) {
    console.error("[MCFunction] Failed to load Minecraft data:", error)
  }
}

export const mcfunctionCompletionSource = (context: CompletionContext): CompletionResult | null => {
  const line = context.state.doc.lineAt(context.pos)
  const beforeCursor = line.text.slice(0, context.pos - line.from)

  if (/^\s*#/.test(beforeCursor)) return null

  const entitySelectorMatch = beforeCursor.match(/@[apse]\[([^\]]*)$/)
  if (entitySelectorMatch) {
    const selectorContent = entitySelectorMatch[1]
    const from = context.pos - (selectorContent.split(/[,=]/).pop()?.length ?? 0)

    if (selectorContent.match(/type=\w*$/)) {
      const partial = selectorContent.match(/type=(\w*)$/)?.[1] ?? ""

      if (mcfunctionStore.entityTypeIds.length === 0) {
        console.warn("[MCFunction] Entity type suggestions requested but no entity data loaded")
      }

      const options = mcfunctionStore.entityTypeIds
        .filter(id => !partial || id.toLowerCase().includes(partial.toLowerCase()))
        .slice(0, 100)
        .map(id => ({
          label: id,
          type: "variable" as const,
          info: "Entity type",
        }))

      return options.length > 0 ? { from, options } : null
    }

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

  const resourceMatch = beforeCursor.match(/\b(minecraft:|[a-z_][a-z0-9_]*:)([a-z0-9_/]*)$/i)
  if (resourceMatch) {
    const namespace = resourceMatch[1]
    const partial = resourceMatch[2]
    const from = context.pos - partial.length

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
      suggestions = mcfunctionStore.itemIds
    } else if (command === "setblock" || command === "fill") {
      suggestions = mcfunctionStore.blockIds
    } else if (command === "summon") {
      suggestions = mcfunctionStore.entityTypeIds
    } else if (command === "particle") {
      suggestions = mcfunctionStore.particleTypeIds
    } else {
      suggestions = [...new Set([...mcfunctionStore.blockIds, ...mcfunctionStore.itemIds, ...mcfunctionStore.entityTypeIds])]
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

  const endsWithSpace = /\s$/.test(beforeCursor)
  const tokens = tokenizeCommand(beforeCursor)
  const activeToken = endsWithSpace ? "" : (tokens.pop() ?? "")
  let pathTokens = tokens

  const runIndex = pathTokens.lastIndexOf("run")
  if (runIndex !== -1) {
    const tokensBeforeRun = pathTokens.slice(0, runIndex)
    const nodeBeforeRun = tokensBeforeRun.length === 0
      ? ({ children: mcfunctionStore.commandSchema.children } as CommandNode)
      : resolveNodeForTokens(tokensBeforeRun)

    if (nodeBeforeRun) {
      const childMap = getEffectiveChildren(nodeBeforeRun)
      if (childMap["run"]?.type === "literal") {
        pathTokens = pathTokens.slice(runIndex + 1)
      }
    }
  }

  const from = context.pos - activeToken.length
  const firstTokenIsActive = pathTokens.length === 0

  const parentNode = firstTokenIsActive
    ? ({ children: mcfunctionStore.commandSchema.children } as CommandNode)
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

  if (filteredOptions.length === 0 && !context.explicit && !firstTokenIsActive) return null

  return {
    from,
    options: filteredOptions.slice(0, 100),
    validFor: /^[a-z0-9_:<>-]*$/i,
  }
}
