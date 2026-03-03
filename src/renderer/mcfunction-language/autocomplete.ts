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
import { getActiveDatapackContextIndex, getMcfunctionContextIndex, mergeMcfunctionContextIndexes, type McfunctionContextIndex } from "./context"

const SCORE_HOLDER_REGEX = /^(@[a-z](?:\[[^\]]*\])?|\*|[\$#A-Za-z0-9_+.=-]+)$/i
const OBJECTIVE_REGEX = /^[A-Za-z0-9_.+-]{1,16}$/

type CompletionContextHints = {
  previousToken?: string
}

const isScoreHolderToken = (value: string) => SCORE_HOLDER_REGEX.test(value)
const isObjectiveToken = (value: string) => OBJECTIVE_REGEX.test(value)

const getHoldersForObjective = (index: McfunctionContextIndex, objective: string) => {
  const holders: string[] = []
  for (const [holder, objectives] of index.objectivesByHolder.entries()) {
    if (objectives.has(objective)) {
      holders.push(holder)
    }
  }
  return holders
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

const REGISTRY_STORE_MAP: Record<string, keyof typeof mcfunctionStore> = {
  "minecraft:block": "blockIds",
  "minecraft:item": "itemIds",
  "minecraft:entity_type": "entityTypeIds",
  "minecraft:biome": "biomeIds",
  "minecraft:enchantment": "enchantmentIds",
  "minecraft:particle_type": "particleTypeIds",
  "minecraft:sound_event": "soundEventIds",
  "minecraft:game_event": "gameEventIds",
  "minecraft:potion": "potionIds",
  "minecraft:dimension": "dimensionIds",
}

const FALLBACK_SUGGESTIONS = {
  parser: {
    "brigadier:bool": ["true", "false"],
    "brigadier:integer": ["0"],
    "brigadier:float": ["0.0"],
    "brigadier:double": ["0.0"],
    "minecraft:entity": ["@a", "@e", "@p", "@s"],
    "minecraft:game_profile": ["@a"],
    "minecraft:block_pos": ["~ ~ ~", "^ ^ ^", "0 64 0"],
    "minecraft:vec2": ["~ ~", "^ ^", "0 0"],
    "minecraft:vec3": ["~ ~ ~", "^ ^ ^", "0 64 0"],
    "minecraft:rotation": ["~ ~", "^ ^", "0 0"],
    "minecraft:score_holder": ["@a", "@e", "@p", "@s"],
    "minecraft:message": ["\"text\""],
    "minecraft:nbt_compound_tag": ["{}"],
    "minecraft:nbt_path": ["path"],
    "minecraft:time": ["1t", "1s", "1d"],
    "minecraft:gamemode": ["survival", "creative", "adventure", "spectator"],
    "minecraft:entity_anchor": ["feet", "eyes"],
  } as Record<string, string[]>,
  parserResourceFallback: {
    "minecraft:block_state": ["minecraft:stone"],
    "minecraft:block_predicate": ["minecraft:stone"],
    "minecraft:item_stack": ["minecraft:stick"],
    "minecraft:item_predicate": ["minecraft:stick"],
    "minecraft:dimension": ["minecraft:overworld", "minecraft:the_nether", "minecraft:the_end"],
    "minecraft:entity_summon": ["minecraft:pig"],
    "minecraft:particle": ["minecraft:flame"],
    "minecraft:resource_location": ["minecraft:"],
    "minecraft:function": ["minecraft:"],
    "minecraft:resource_or_tag": ["minecraft:", "#minecraft:"],
    "minecraft:resource_or_tag_key": ["minecraft:", "#minecraft:"],
  } as Record<string, string[]>,
  selectorArgs: ["type=", "tag=", "name=", "distance=", "x=", "y=", "z=", "dx=", "dy=", "dz=", "scores=", "limit=", "sort=", "nbt="],
}

const RESOURCE_PARSER_IDS = new Set<string>([
  "minecraft:resource",
  "minecraft:resource_key",
  "minecraft:resource_or_tag",
  "minecraft:resource_or_tag_key",
  "minecraft:resource_location",
  "minecraft:function",
  "minecraft:block_state",
  "minecraft:block_predicate",
  "minecraft:item_stack",
  "minecraft:item_predicate",
  "minecraft:entity_summon",
  "minecraft:particle",
  "minecraft:dimension",
])

const getRegistrySuggestions = (registryId: string) => {
  const storeKey = REGISTRY_STORE_MAP[registryId]
  if (!storeKey) return []

  const values = mcfunctionStore[storeKey]
  return Array.isArray(values) ? values : []
}

const resolveParserSuggestions = (
  node: CommandNode,
  contextIndex: McfunctionContextIndex,
  hints?: CompletionContextHints,
): string[] => {
  const parserId = node.parser
  if (!parserId) return []

  if (parserId === "minecraft:objective") {
    const holderToken = hints?.previousToken
    if (holderToken && isScoreHolderToken(holderToken)) {
      const pairedObjectives = contextIndex.objectivesByHolder.get(holderToken)
      if (pairedObjectives && pairedObjectives.size > 0) {
        return [...pairedObjectives]
      }
    }

    if (contextIndex.objectives.size > 0) return [...contextIndex.objectives]
  }

  if (parserId === "minecraft:score_holder") {
    const objectiveToken = hints?.previousToken
    if (objectiveToken && isObjectiveToken(objectiveToken)) {
      const pairedHolders = getHoldersForObjective(contextIndex, objectiveToken)
      if (pairedHolders.length > 0) {
        return pairedHolders
      }
    }

    if (contextIndex.holders.size > 0) return [...contextIndex.holders]
  }

  const registryName = typeof node.properties?.registry === "string"
    ? node.properties.registry
    : undefined

  if (registryName) {
    const registrySuggestions = getRegistrySuggestions(registryName)
    if (registrySuggestions.length > 0) return registrySuggestions
  }

  if (parserId === "minecraft:block_state" || parserId === "minecraft:block_predicate") {
    if (mcfunctionStore.blockIds.length > 0) return mcfunctionStore.blockIds
  }

  if (parserId === "minecraft:item_stack" || parserId === "minecraft:item_predicate") {
    if (mcfunctionStore.itemIds.length > 0) return mcfunctionStore.itemIds
  }

  if (parserId === "minecraft:entity_summon") {
    if (mcfunctionStore.entityTypeIds.length > 0) return mcfunctionStore.entityTypeIds
  }

  if (parserId === "minecraft:particle") {
    if (mcfunctionStore.particleTypeIds.length > 0) return mcfunctionStore.particleTypeIds
  }

  if (parserId === "minecraft:resource_location" || parserId === "minecraft:function") {
    const samples = [...new Set([
      ...mcfunctionStore.itemIds,
      ...mcfunctionStore.blockIds,
      ...mcfunctionStore.entityTypeIds,
    ])]
    if (samples.length > 0) return samples
  }

  if (parserId === "minecraft:resource_or_tag" || parserId === "minecraft:resource_or_tag_key") {
    const samples = [...new Set([
      ...mcfunctionStore.itemIds,
      ...mcfunctionStore.blockIds,
    ])]
    if (samples.length > 0) return [...samples, "#minecraft:"]
  }

  return FALLBACK_SUGGESTIONS.parserResourceFallback[parserId]
    ?? FALLBACK_SUGGESTIONS.parser[parserId]
    ?? []
}

const buildArgumentCompletions = (
  children: Record<string, CommandNode>,
  contextIndex: McfunctionContextIndex,
  hints?: CompletionContextHints,
): Completion[] => {
  return Object.entries(children)
    .filter(([, child]) => child.type === "argument")
    .flatMap(([argumentName, child]) => {
      const parserId = child.parser ?? "argument"
      const parserSuggestions = resolveParserSuggestions(child, contextIndex, hints)

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

const isResourceLikeArgument = (node: CommandNode) => {
  if (typeof node.properties?.registry === "string") return true
  if (!node.parser) return false
  return RESOURCE_PARSER_IDS.has(node.parser)
}

const normalizeExecutionPathTokens = (tokens: string[]) => {
  const runIndex = tokens.lastIndexOf("run")
  if (runIndex === -1) return tokens

  const tokensBeforeRun = tokens.slice(0, runIndex)
  const nodeBeforeRun = tokensBeforeRun.length === 0
    ? ({ children: mcfunctionStore.commandSchema.children } as CommandNode)
    : resolveNodeForTokens(tokensBeforeRun)

  if (!nodeBeforeRun) return tokens

  const childMap = getEffectiveChildren(nodeBeforeRun)
  if (childMap["run"]?.type !== "literal") return tokens

  return tokens.slice(runIndex + 1)
}

const getGeneralResourceSuggestions = () => {
  return [...new Set([
    ...mcfunctionStore.blockIds,
    ...mcfunctionStore.itemIds,
    ...mcfunctionStore.entityTypeIds,
    ...mcfunctionStore.particleTypeIds,
    ...mcfunctionStore.dimensionIds,
  ])]
}

const getCompletionContextIndex = (context: CompletionContext) => {
  const localIndex = getMcfunctionContextIndex(context.state)
  const datapackIndex = getActiveDatapackContextIndex()
  return mergeMcfunctionContextIndexes(datapackIndex, localIndex)
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
  const contextIndex = getCompletionContextIndex(context)
  const line = context.state.doc.lineAt(context.pos)
  const beforeCursor = line.text.slice(0, context.pos - line.from)

  if (/^\s*#/.test(beforeCursor)) return null

  const entitySelectorMatch = beforeCursor.match(/@[apse]\[([^\]]*)$/)
  if (entitySelectorMatch) {
    const selectorContent = entitySelectorMatch[1]
    const from = context.pos - (selectorContent.split(/[,=]/).pop()?.length ?? 0)

    const selectorHolder = beforeCursor.match(/(@[apse])\[[^\]]*$/)?.[1]

    if (selectorContent.match(/type=\w*$/)) {
      const partial = selectorContent.match(/type=(\w*)$/)?.[1] ?? ""

      if (mcfunctionStore.entityTypeIds.length === 0) {
        console.warn("[MCFunction] Entity type suggestions requested but no entity data loaded")
      }

      const options = mcfunctionStore.entityTypeIds
        .filter(id => !partial || id.toLowerCase().includes(partial.toLowerCase()))
        .map(id => ({
          label: id,
          type: "variable" as const,
          info: "Entity type",
        }))

      return options.length > 0 ? { from, options } : null
    }

    const scoresMatch = selectorContent.match(/scores=\{([^}]*)$/)
    if (scoresMatch) {
      const scoresContent = scoresMatch[1] ?? ""
      const currentSegment = scoresContent.split(",").pop() ?? ""

      if (!currentSegment.includes("=")) {
        const leadingWhitespaceLength = (currentSegment.match(/^\s*/) ?? [""])[0].length
        const objectivePartial = currentSegment.slice(leadingWhitespaceLength)
        const from = context.pos - objectivePartial.length

        const pairedObjectives = selectorHolder
          ? contextIndex.objectivesByHolder.get(selectorHolder)
          : undefined

        const objectiveSuggestions = pairedObjectives && pairedObjectives.size > 0
          ? [...pairedObjectives]
          : [...contextIndex.objectives]

        const options = objectiveSuggestions
          .filter(objective => !objectivePartial || objective.toLowerCase().startsWith(objectivePartial.toLowerCase()))
          .map(objective => ({
            label: `${objective}=`,
            type: "property" as const,
            info: selectorHolder ? `Score objective for ${selectorHolder}` : "Score objective",
          }))

        if (options.length > 0) {
          return {
            from,
            options,
            validFor: /^[a-z0-9_.+-]*$/i,
          }
        }
      }
    }

    const tagMatch = selectorContent.match(/tag=(!?)([A-Za-z0-9_./:-]*)$/)
    if (tagMatch) {
      const negationPrefix = tagMatch[1] ?? ""
      const partial = tagMatch[2] ?? ""
      const from = context.pos - partial.length

      const options = [...contextIndex.tags]
        .filter(tag => !partial || tag.toLowerCase().includes(partial.toLowerCase()))
        .map(tag => ({
          label: `${negationPrefix}${tag}`,
          type: "variable" as const,
          info: "Entity tag",
        }))

      return options.length > 0 ? { from, options } : null
    }

    const args = FALLBACK_SUGGESTIONS.selectorArgs
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

    const resourceTokens = tokenizeCommand(beforeCursor)
    resourceTokens.pop()
    const resourcePathTokens = normalizeExecutionPathTokens(resourceTokens)

    const parentNode = resourcePathTokens.length === 0
      ? ({ children: mcfunctionStore.commandSchema.children } as CommandNode)
      : resolveNodeForTokens(resourcePathTokens)

    const nodeSuggestions = parentNode
      ? Object.values(getEffectiveChildren(parentNode))
        .filter(child => child.type === "argument" && isResourceLikeArgument(child))
        .flatMap(child => resolveParserSuggestions(child, contextIndex))
      : []

    const suggestions = nodeSuggestions.length > 0
      ? [...new Set(nodeSuggestions)]
      : getGeneralResourceSuggestions()

    if (suggestions.length === 0) {
      console.warn("[MCFunction] Resource suggestions requested but no data loaded")
    }

    const options = suggestions
      .filter(id => id.startsWith(namespace) && (!partial || id.slice(namespace.length).toLowerCase().startsWith(partial.toLowerCase())))
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
  const pathTokens = normalizeExecutionPathTokens(tokens)

  const from = context.pos - activeToken.length
  const firstTokenIsActive = pathTokens.length === 0

  const parentNode = firstTokenIsActive
    ? ({ children: mcfunctionStore.commandSchema.children } as CommandNode)
    : resolveNodeForTokens(pathTokens)

  if (!parentNode) return null

  const childMap = getEffectiveChildren(parentNode)
  if (pathTokens[0] === "tag" && (pathTokens[2] === "add" || pathTokens[2] === "remove")) {
    const options = [...contextIndex.tags]
      .map((label) => ({
        label,
        type: "variable" as const,
        info: "Entity tag",
      }))
      .filter(option => !activeToken || normalizeCompletionForMatch(option.label).startsWith(normalizeCompletionForMatch(activeToken)))

    if (options.length > 0) {
      return {
        from,
        options,
        validFor: /^[a-z0-9_./:-]*$/i,
      }
    }
  }

  const options = [
    ...buildLiteralCompletions(childMap),
    ...buildArgumentCompletions(childMap, contextIndex, {
      previousToken: pathTokens[pathTokens.length - 1],
    }),
  ]

  const normalizedTyped = normalizeCompletionForMatch(activeToken)
  const filteredOptions = normalizedTyped
    ? options.filter(option => normalizeCompletionForMatch(option.label).startsWith(normalizedTyped))
    : options

  if (filteredOptions.length === 0 && !context.explicit && !firstTokenIsActive) return null

  return {
    from,
    options: filteredOptions,
    validFor: /^[a-z0-9_:<>-]*$/i,
  }
}
