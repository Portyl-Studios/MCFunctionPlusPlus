import { RangeSetBuilder, StateField, StateEffect, Text, type EditorState, type Extension } from "@codemirror/state"
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view"
import { normalizeCommandToken } from "./shared"

type RangedToken = {
  value: string
  start: number
  end: number
}

type ScoreSymbolOccurrence = {
  from: number
  to: number
  kind: "holder" | "objective" | "resource" | "tag"
}

export type McfunctionContextIndex = {
  holders: Set<string>
  objectives: Set<string>
  resourcePaths: Set<string>
  tags: Set<string>
  objectivesByHolder: Map<string, Set<string>>
  occurrences: ScoreSymbolOccurrence[]
}

type McfunctionContextState = {
  index: McfunctionContextIndex
  decorations: DecorationSet
}

const HOLDER_REGEX = /^(@[a-z](?:\[[^\]]*\])?|\*|[\$#A-Za-z0-9_+.=-]+)$/i
const OBJECTIVE_REGEX = /^[A-Za-z0-9_.+-]{1,16}$/
const RESOURCE_PATH_REGEX = /^#?[a-z_][a-z0-9_.-]*:[a-z0-9_./-]+$/i
const RESOURCE_PATH_GLOBAL_REGEX = /#?[a-z_][a-z0-9_.-]*:[a-z0-9_./-]+/gi
const TAG_NAME_REGEX = /^[A-Za-z0-9_./:-]+$/
const SELECTOR_TAG_GLOBAL_REGEX = /(?:^|[\[,])\s*tag\s*=\s*(!?)([A-Za-z0-9_./:-]+)/gi
const FUNCTION_FILE_PATH_REGEX = /^data\/([a-z0-9_.-]+)\/functions?\/(.+)\.mcfunction$/i

const workspaceResourcePaths = new Set<string>()
const workspacePathsUpdatedEffect = StateEffect.define<void>()
let editorViewsToRefresh: Set<EditorView> = new Set()
const datapackContextIndexes = new Map<string, McfunctionContextIndex>()
let activeDatapackContextKey: string | null = null

const HOLDER_DECORATION = Decoration.mark({ class: "cm-context cm-context-mcfunction-holder" })
const OBJECTIVE_DECORATION = Decoration.mark({ class: "cm-context cm-context-mcfunction-objective" })
const RESOURCE_DECORATION = Decoration.mark({ class: "cm-context cm-context-mcfunction-resource" })
const TAG_DECORATION = Decoration.mark({ class: "cm-context cm-context-mcfunction-tag" })

const isCommentLine = (lineText: string) => /^\s*#/.test(lineText)

const isQuotedToken = (value: string) => {
  if (value.length < 2) return false
  const first = value[0]
  const last = value[value.length - 1]
  return (first === '"' && last === '"') || (first === "'" && last === "'")
}

const isScoreHolderToken = (value: string) => !isQuotedToken(value) && HOLDER_REGEX.test(value)

const isObjectiveToken = (value: string) => !isQuotedToken(value) && OBJECTIVE_REGEX.test(value)

const isResourcePathToken = (value: string) => RESOURCE_PATH_REGEX.test(value)

const normalizeTagName = (value: string) => value.replace(/^!/, "")

const isTagNameToken = (value: string) => {
  const normalized = normalizeTagName(value)
  return normalized.length > 0 && TAG_NAME_REGEX.test(normalized)
}

const getQuotedRanges = (lineText: string) => {
  const ranges: Array<{ start: number; end: number }> = []
  let quote: "'" | '"' | null = null
  let quoteStart = -1
  let escaped = false

  for (let i = 0; i < lineText.length; i += 1) {
    const character = lineText[i]

    if (escaped) {
      escaped = false
      continue
    }

    if (character === "\\") {
      escaped = true
      continue
    }

    if (!quote && (character === '"' || character === "'")) {
      quote = character
      quoteStart = i
      continue
    }

    if (quote && character === quote) {
      ranges.push({ start: quoteStart, end: i + 1 })
      quote = null
      quoteStart = -1
    }
  }

  if (quote && quoteStart >= 0) {
    ranges.push({ start: quoteStart, end: lineText.length })
  }

  return ranges
}

const isInQuotedRange = (index: number, ranges: Array<{ start: number; end: number }>) => {
  return ranges.some(range => index >= range.start && index < range.end)
}

const addObjectiveByHolder = (index: McfunctionContextIndex, holder: string, objective: string) => {
  const existing = index.objectivesByHolder.get(holder)
  if (existing) {
    existing.add(objective)
    return
  }
  index.objectivesByHolder.set(holder, new Set([objective]))
}

const addOccurrence = (
  index: McfunctionContextIndex,
  lineFrom: number,
  token: RangedToken,
  kind: "holder" | "objective" | "resource" | "tag",
) => {
  index.occurrences.push({
    from: lineFrom + token.start,
    to: lineFrom + token.end,
    kind,
  })
}

const addScorePair = (
  index: McfunctionContextIndex,
  lineFrom: number,
  holderToken: RangedToken | undefined,
  objectiveToken: RangedToken | undefined,
) => {
  if (!holderToken || !objectiveToken) return

  const holderIsValid = isScoreHolderToken(holderToken.value)
  const objectiveIsValid = isObjectiveToken(objectiveToken.value)
  const objectiveIsRegistered = objectiveIsValid && index.objectives.has(objectiveToken.value)

  if (holderIsValid) {
    index.holders.add(holderToken.value)
    addOccurrence(index, lineFrom, holderToken, "holder")
  }

  if (objectiveIsRegistered) {
    addOccurrence(index, lineFrom, objectiveToken, "objective")
  }

  if (holderIsValid && objectiveIsRegistered) {
    addObjectiveByHolder(index, holderToken.value, objectiveToken.value)
  }
}

const parseScoreboardLine = (index: McfunctionContextIndex, lineFrom: number, tokens: RangedToken[]) => {
  const groupToken = tokens[1]?.value
  const actionToken = tokens[2]?.value

  if (groupToken === "objectives") {
    if (actionToken === "add") {
      const objective = tokens[3]
      if (objective && isObjectiveToken(objective.value)) {
        index.objectives.add(objective.value)
        addOccurrence(index, lineFrom, objective, "objective")
      }
      return
    }

    if (actionToken === "modify") {
      const objective = tokens[3]
      if (objective && isObjectiveToken(objective.value) && index.objectives.has(objective.value)) {
        addOccurrence(index, lineFrom, objective, "objective")
      }
      return
    }

    if (actionToken === "remove") {
      const objective = tokens[3]
      if (objective && isObjectiveToken(objective.value)) {
        const wasRegistered = index.objectives.has(objective.value)
        index.objectives.delete(objective.value)
        if (wasRegistered) {
          addOccurrence(index, lineFrom, objective, "objective")
        }
      }
      return
    }
  }

  if (groupToken !== "players") return

  if (actionToken === "operation") {
    addScorePair(index, lineFrom, tokens[3], tokens[4])
    addScorePair(index, lineFrom, tokens[6], tokens[7])
    return
  }

  if (actionToken === "set" || actionToken === "add" || actionToken === "remove" || actionToken === "get" || actionToken === "reset" || actionToken === "enable") {
    addScorePair(index, lineFrom, tokens[3], tokens[4])
  }
}

const parseInlineScoreUsage = (index: McfunctionContextIndex, lineFrom: number, tokens: RangedToken[]) => {
  for (let i = 0; i < tokens.length - 2; i += 1) {
    if (tokens[i].value !== "score") continue
    addScorePair(index, lineFrom, tokens[i + 1], tokens[i + 2])
  }
}

const parseTagCommandUsage = (index: McfunctionContextIndex, lineFrom: number, tokens: RangedToken[]) => {
  const actionToken = tokens[2]?.value
  if (actionToken !== "add" && actionToken !== "remove") return

  const tagNameToken = tokens[3]
  if (!tagNameToken || !isTagNameToken(tagNameToken.value)) return

  const tagName = normalizeTagName(tagNameToken.value)

  if (actionToken === "add") {
    index.tags.add(tagName)
    addOccurrence(index, lineFrom, {
      ...tagNameToken,
      value: tagName,
    }, "tag")
    return
  }

  const wasRegistered = index.tags.has(tagName)
  index.tags.delete(tagName)
  if (wasRegistered) {
    addOccurrence(index, lineFrom, {
      ...tagNameToken,
      value: tagName,
    }, "tag")
  }
}

const parseSelectorTagUsage = (index: McfunctionContextIndex, lineFrom: number, lineText: string) => {
  const quotedRanges = getQuotedRanges(lineText)

  for (const match of lineText.matchAll(SELECTOR_TAG_GLOBAL_REGEX)) {
    const rawTagName = match[2]
    if (!rawTagName || !isTagNameToken(rawTagName)) continue

    const start = match.index ?? -1
    if (start < 0) continue
    if (isInQuotedRange(start, quotedRanges)) continue

    const tagName = normalizeTagName(rawTagName)
    const valueStart = lineText.indexOf(rawTagName, start)
    if (valueStart < 0) continue

    if (!index.tags.has(tagName)) continue

    addOccurrence(index, lineFrom, {
      value: tagName,
      start: valueStart,
      end: valueStart + rawTagName.length,
    }, "tag")
  }
}

const parseResourcePathUsage = (index: McfunctionContextIndex, lineFrom: number, lineText: string) => {
  const quotedRanges = getQuotedRanges(lineText)

  for (const match of lineText.matchAll(RESOURCE_PATH_GLOBAL_REGEX)) {
    const value = match[0]
    const start = match.index ?? -1
    if (start < 0) continue
    if (isInQuotedRange(start, quotedRanges)) continue
    if (!isResourcePathToken(value)) continue

    const token: RangedToken = {
      value,
      start,
      end: start + value.length,
    }

    if (!index.resourcePaths.has(value)) continue
    addOccurrence(index, lineFrom, token, "resource")
  }
}

const createResourcePathFromFilePath = (relativePath: string) => {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "")
  const match = normalized.match(FUNCTION_FILE_PATH_REGEX)
  if (!match) return null

  const namespace = match[1]
  const pathValue = match[2]
  if (!namespace || !pathValue) return null

  return `${namespace}:${pathValue}`
}

export const setWorkspaceResourcePathsFromRelativePaths = (relativePaths: string[]) => {
  workspaceResourcePaths.clear()

  for (const relativePath of relativePaths) {
    const resourcePath = createResourcePathFromFilePath(relativePath)
    if (!resourcePath) continue
    workspaceResourcePaths.add(resourcePath)
  }

  // Trigger refresh in all registered views
  for (const view of editorViewsToRefresh) {
    try {
      view.dispatch({ effects: workspacePathsUpdatedEffect.of(undefined) })
    } catch (e) {
      // View might be destroyed, ignore
    }
  }
}

const tokenizeCommandWithRanges = (input: string): RangedToken[] => {
  const tokens: RangedToken[] = []
  let start = -1
  let quote: "'" | '"' | null = null
  let escaped = false
  let braceDepth = 0
  let bracketDepth = 0

  for (let i = 0; i < input.length; i += 1) {
    const character = input[i]

    if (start === -1 && !/\s/.test(character)) {
      start = i
    }

    if (start === -1) continue

    if (escaped) {
      escaped = false
      continue
    }

    if (character === "\\") {
      escaped = true
      continue
    }

    if (quote) {
      if (character === quote) quote = null
      continue
    }

    if (character === '"' || character === "'") {
      quote = character
      continue
    }

    if (character === "{") {
      braceDepth += 1
      continue
    }

    if (character === "}") {
      braceDepth = Math.max(0, braceDepth - 1)
      continue
    }

    if (character === "[") {
      bracketDepth += 1
      continue
    }

    if (character === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1)
      continue
    }

    if (/\s/.test(character) && braceDepth === 0 && bracketDepth === 0) {
      tokens.push({
        value: input.slice(start, i),
        start,
        end: i,
      })
      start = -1
    }
  }

  if (start !== -1) {
    tokens.push({
      value: input.slice(start),
      start,
      end: input.length,
    })
  }

  return tokens
}

const createEmptyIndex = (): McfunctionContextIndex => ({
  holders: new Set<string>(),
  objectives: new Set<string>(),
  resourcePaths: new Set<string>(),
  tags: new Set<string>(),
  objectivesByHolder: new Map<string, Set<string>>(),
  occurrences: [],
})

const cloneContextIndex = (source: McfunctionContextIndex): McfunctionContextIndex => ({
  holders: new Set(source.holders),
  objectives: new Set(source.objectives),
  resourcePaths: new Set(source.resourcePaths),
  tags: new Set(source.tags),
  objectivesByHolder: new Map(
    [...source.objectivesByHolder.entries()].map(([holder, objectives]) => [holder, new Set(objectives)]),
  ),
  occurrences: [...source.occurrences],
})

const mergeContextInto = (target: McfunctionContextIndex, source: McfunctionContextIndex, includeOccurrences = false) => {
  for (const holder of source.holders) target.holders.add(holder)
  for (const objective of source.objectives) target.objectives.add(objective)
  for (const resourcePath of source.resourcePaths) target.resourcePaths.add(resourcePath)
  for (const tag of source.tags) target.tags.add(tag)

  for (const [holder, sourceObjectives] of source.objectivesByHolder.entries()) {
    const existing = target.objectivesByHolder.get(holder)
    if (existing) {
      for (const objective of sourceObjectives) existing.add(objective)
      continue
    }

    target.objectivesByHolder.set(holder, new Set(sourceObjectives))
  }

  if (includeOccurrences && source.occurrences.length > 0) {
    target.occurrences.push(...source.occurrences)
  }
}

export const mergeMcfunctionContextIndexes = (...indexes: McfunctionContextIndex[]): McfunctionContextIndex => {
  const merged = createEmptyIndex()
  for (const index of indexes) {
    mergeContextInto(merged, index)
  }
  return merged
}

const buildDecorations = (index: McfunctionContextIndex) => {
  const builder = new RangeSetBuilder<Decoration>()
  const sortedOccurrences = [...index.occurrences].sort((left, right) => {
    if (left.from !== right.from) return left.from - right.from
    if (left.to !== right.to) return left.to - right.to
    return left.kind.localeCompare(right.kind)
  })

  for (const occurrence of sortedOccurrences) {
    builder.add(
      occurrence.from,
      occurrence.to,
      occurrence.kind === "holder"
        ? HOLDER_DECORATION
        : occurrence.kind === "objective"
          ? OBJECTIVE_DECORATION
          : occurrence.kind === "resource"
            ? RESOURCE_DECORATION
            : TAG_DECORATION,
    )
  }
  return builder.finish()
}

const parseContextIndex = (
  doc: Text,
  resourcePaths: Iterable<string>,
  seedObjectives?: Iterable<string>,
  seedTags?: Iterable<string>,
  seedHolders?: Iterable<string>,
  seedObjectivesByHolder?: Iterable<[string, Set<string>]>,
): McfunctionContextIndex => {
  const index = createEmptyIndex()

  if (seedObjectives) {
    for (const objective of seedObjectives) {
      index.objectives.add(objective)
    }
  }

  if (seedTags) {
    for (const tag of seedTags) {
      index.tags.add(tag)
    }
  }

  if (seedHolders) {
    for (const holder of seedHolders) {
      index.holders.add(holder)
    }
  }

  if (seedObjectivesByHolder) {
    for (const [holder, objectives] of seedObjectivesByHolder) {
      index.objectivesByHolder.set(holder, new Set(objectives))
    }
  }

  for (const resourcePath of resourcePaths) {
    index.resourcePaths.add(resourcePath)
  }

  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber)
    const text = line.text

    if (!text.trim() || isCommentLine(text)) continue

    const tokens = tokenizeCommandWithRanges(text)
    if (tokens.length === 0) continue

    const rootCommand = normalizeCommandToken(tokens[0].value)
    tokens[0] = { ...tokens[0], value: rootCommand }

    if (rootCommand === "scoreboard") {
      parseScoreboardLine(index, line.from, tokens)
    }

    if (rootCommand === "tag") {
      parseTagCommandUsage(index, line.from, tokens)
    }

    parseInlineScoreUsage(index, line.from, tokens)
    parseSelectorTagUsage(index, line.from, text)
    parseResourcePathUsage(index, line.from, text)
  }

  return index
}

const parseDocContextIndex = (doc: Text): McfunctionContextState => {
  const activeDatapackIndex = getActiveDatapackContextIndex()
  const index = parseContextIndex(
    doc,
    workspaceResourcePaths,
    activeDatapackIndex.objectives,
    activeDatapackIndex.tags,
    activeDatapackIndex.holders,
    activeDatapackIndex.objectivesByHolder.entries(),
  )

  return {
    index,
    decorations: buildDecorations(index),
  }
}

const mcfunctionContextField = StateField.define<McfunctionContextState>({
  create(state) {
    return parseDocContextIndex(state.doc)
  },
  update(value, transaction) {
    // Recalculate if doc changed OR workspace paths were updated
    if (transaction.docChanged || transaction.effects.some(e => e.is(workspacePathsUpdatedEffect))) {
      return parseDocContextIndex(transaction.state.doc)
    }
    return value
  },
  provide: field => EditorView.decorations.from(field, value => value.decorations),
})

const viewTrackingExtension = EditorView.updateListener.of((update) => {
  // Register this view for workspace path updates
  editorViewsToRefresh.add(update.view)
})

export const mcfunctionContextExtension: Extension = [
  mcfunctionContextField,
  viewTrackingExtension,
]

const EMPTY_CONTEXT_INDEX = createEmptyIndex()

export const parseMcfunctionContextIndex = (content: string, resourcePaths: Iterable<string> = []): McfunctionContextIndex => {
  const lines = content.replace(/\r\n/g, "\n").split("\n")
  const doc = Text.of(lines)
  return parseContextIndex(doc, resourcePaths)
}

export const setDatapackContextIndex = (datapackDir: string, index: McfunctionContextIndex | null) => {
  if (!index) {
    datapackContextIndexes.delete(datapackDir)
    return
  }

  datapackContextIndexes.set(datapackDir, cloneContextIndex(index))
}

export const clearDatapackContextIndexes = () => {
  datapackContextIndexes.clear()
}

export const setActiveDatapackContext = (datapackDir: string | null) => {
  activeDatapackContextKey = datapackDir
}

export const getActiveDatapackContextIndex = (): McfunctionContextIndex => {
  if (!activeDatapackContextKey) return EMPTY_CONTEXT_INDEX
  return datapackContextIndexes.get(activeDatapackContextKey) ?? EMPTY_CONTEXT_INDEX
}

export const getMcfunctionContextIndex = (state: EditorState): McfunctionContextIndex => {
  try {
    return state.field(mcfunctionContextField).index
  } catch {
    return EMPTY_CONTEXT_INDEX
  }
}
