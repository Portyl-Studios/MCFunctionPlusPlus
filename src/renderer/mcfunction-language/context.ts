import { RangeSetBuilder, StateField, type EditorState, type Extension, type Text } from "@codemirror/state"
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

  if (isScoreHolderToken(holderToken.value)) {
    index.holders.add(holderToken.value)
    addOccurrence(index, lineFrom, holderToken, "holder")
  }

  if (isObjectiveToken(objectiveToken.value)) {
    index.objectives.add(objectiveToken.value)
    addOccurrence(index, lineFrom, objectiveToken, "objective")
  }

  if (isScoreHolderToken(holderToken.value) && isObjectiveToken(objectiveToken.value)) {
    addObjectiveByHolder(index, holderToken.value, objectiveToken.value)
  }
}

const parseScoreboardLine = (index: McfunctionContextIndex, lineFrom: number, tokens: RangedToken[]) => {
  const groupToken = tokens[1]?.value
  const actionToken = tokens[2]?.value

  if (groupToken === "objectives") {
    if (actionToken === "add" || actionToken === "modify") {
      const objective = tokens[3]
      if (objective && isObjectiveToken(objective.value)) {
        index.objectives.add(objective.value)
        addOccurrence(index, lineFrom, objective, "objective")
      }
      return
    }

    if (actionToken === "remove") {
      const objective = tokens[3]
      if (objective && isObjectiveToken(objective.value)) {
        index.objectives.delete(objective.value)
        addOccurrence(index, lineFrom, objective, "objective")
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
  index.tags.add(tagName)
  addOccurrence(index, lineFrom, {
    ...tagNameToken,
    value: tagName,
  }, "tag")
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

    index.tags.add(tagName)
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

const buildDecorations = (index: McfunctionContextIndex) => {
  const builder = new RangeSetBuilder<Decoration>()
  for (const occurrence of index.occurrences) {
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

const parseDocContextIndex = (doc: Text): McfunctionContextState => {
  const index = createEmptyIndex()
  for (const resourcePath of workspaceResourcePaths) {
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
    if (!transaction.docChanged) return value
    return parseDocContextIndex(transaction.state.doc)
  },
  provide: field => EditorView.decorations.from(field, value => value.decorations),
})

export const mcfunctionContextExtension: Extension = [
  mcfunctionContextField,
]

const EMPTY_CONTEXT_INDEX = createEmptyIndex()

export const getMcfunctionContextIndex = (state: EditorState): McfunctionContextIndex => {
  try {
    return state.field(mcfunctionContextField).index
  } catch {
    return EMPTY_CONTEXT_INDEX
  }
}
