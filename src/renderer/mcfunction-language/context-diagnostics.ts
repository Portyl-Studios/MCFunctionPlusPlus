import type { Diagnostic } from "@codemirror/lint"
import type { EditorView } from "@codemirror/view"
import { normalizeCommandToken } from "./shared"
import { getQuotedRanges, getRootCommandTokens, isInQuotedRange, type RangedToken, tokenizeCommandWithRanges } from "./parse-utils"
import type { McfunctionContextIndex } from "./context"

const OBJECTIVE_REGEX = /^[A-Za-z0-9_.+-]{1,16}$/
const TAG_NAME_REGEX = /^[A-Za-z0-9_./:-]+$/
const SELECTOR_TAG_GLOBAL_REGEX = /(?:^|[\[,])\s*tag\s*=\s*(!?)([A-Za-z0-9_./:-]+)/gi
const SCORE_COMPARISON_OPERATORS = new Set(["<", "<=", "=", ">=", ">", "matches"])
const SCOREBOARD_PLAYER_ACTIONS = new Set(["set", "add", "remove", "get", "reset", "enable"])

const isCommentLine = (text: string) => /^\s*#/.test(text)

const normalizeTagName = (value: string) => value.replace(/^!/, "")

const isObjectiveToken = (value: string) => OBJECTIVE_REGEX.test(value)

const isTagNameToken = (value: string) => {
  const normalized = normalizeTagName(value)
  return normalized.length > 0 && TAG_NAME_REGEX.test(normalized)
}

const pushUnknownObjectiveDiagnostic = (
  diagnostics: Diagnostic[],
  from: number,
  to: number,
  objective: string,
) => {
  diagnostics.push({
    from,
    to,
    severity: "error",
    message: `Unknown objective '${objective}'. Register it with 'scoreboard objectives add ${objective}' before use.`,
  })
}

const pushUnknownTagDiagnostic = (
  diagnostics: Diagnostic[],
  from: number,
  to: number,
  tag: string,
) => {
  diagnostics.push({
    from,
    to,
    severity: "warning",
    message: `Unknown tag '${tag}'. Register it with 'tag <selector> add ${tag}' before use.`,
  })
}

const handleObjectiveToken = (
  registeredObjectives: Set<string>,
  diagnostics: Diagnostic[],
  lineFrom: number,
  objectiveToken: RangedToken | undefined,
) => {
  if (!objectiveToken || !isObjectiveToken(objectiveToken.value)) return
  if (registeredObjectives.has(objectiveToken.value)) return

  const from = lineFrom + objectiveToken.start
  const to = lineFrom + objectiveToken.end
  pushUnknownObjectiveDiagnostic(diagnostics, from, to, objectiveToken.value)
}

const handleScoreboardSymbols = (
  registeredObjectives: Set<string>,
  diagnostics: Diagnostic[],
  lineFrom: number,
  tokens: RangedToken[],
) => {
  const groupToken = tokens[1]?.value
  const actionToken = tokens[2]?.value

  if (groupToken === "objectives") {
    if (actionToken === "add") {
      const objective = tokens[3]
      if (!objective || !isObjectiveToken(objective.value)) return
      registeredObjectives.add(objective.value)
      return
    }

    // For objective commands, only `add` registers. All other objective references should validate.
    if (actionToken === "setdisplay") {
      handleObjectiveToken(registeredObjectives, diagnostics, lineFrom, tokens[4])
      return
    }

    handleObjectiveToken(registeredObjectives, diagnostics, lineFrom, tokens[3])
    return
  }

  if (groupToken !== "players") return

  if (actionToken === "operation") {
    handleObjectiveToken(registeredObjectives, diagnostics, lineFrom, tokens[4])
    handleObjectiveToken(registeredObjectives, diagnostics, lineFrom, tokens[7])
    return
  }

  if (actionToken && SCOREBOARD_PLAYER_ACTIONS.has(actionToken)) {
    handleObjectiveToken(registeredObjectives, diagnostics, lineFrom, tokens[4])
  }
}

const handleInlineScoreSymbols = (
  registeredObjectives: Set<string>,
  diagnostics: Diagnostic[],
  lineFrom: number,
  tokens: RangedToken[],
) => {
  for (let i = 0; i < tokens.length - 2; i += 1) {
    if (tokens[i].value !== "score") continue
    handleObjectiveToken(registeredObjectives, diagnostics, lineFrom, tokens[i + 2])

    const operationToken = tokens[i + 3]?.value
    if (operationToken && SCORE_COMPARISON_OPERATORS.has(operationToken)) {
      handleObjectiveToken(registeredObjectives, diagnostics, lineFrom, tokens[i + 5])
    }
  }
}

const handleTagCommandSymbols = (
  registeredTags: Set<string>,
  diagnostics: Diagnostic[],
  lineFrom: number,
  tokens: RangedToken[],
) => {
  const actionToken = tokens[2]?.value
  if (actionToken !== "add" && actionToken !== "remove") return

  const tagNameToken = tokens[3]
  if (!tagNameToken || !isTagNameToken(tagNameToken.value)) return

  const tagName = normalizeTagName(tagNameToken.value)

  if (actionToken === "add") {
    registeredTags.add(tagName)
    return
  }

  const wasRegistered = registeredTags.has(tagName)
  if (!wasRegistered) return

  // Tag is registered, don't error for add
}

const handleSelectorTagSymbols = (
  registeredTags: Set<string>,
  diagnostics: Diagnostic[],
  lineFrom: number,
  lineText: string,
) => {
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

    if (!registeredTags.has(tagName)) {
      const from = lineFrom + valueStart
      const to = from + rawTagName.length
      pushUnknownTagDiagnostic(diagnostics, from, to, tagName)
    }
  }
}

/**
 * Context diagnostics for validating context-dependent symbols.
 * These checks require the context index and include:
 * - Unknown objectives validation
 * - Unknown tags validation
 * - Score symbol validation
 *
 * This should be called after context collection is complete.
 */
export const mcfunctionContextDiagnosticsSource = (
  view: EditorView,
  contextIndex: McfunctionContextIndex,
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = []
  const doc = view.state.doc

  const registeredObjectives = new Set(contextIndex.objectives)
  const registeredTags = new Set(contextIndex.tags)

  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber)
    const text = line.text

    if (!text.trim() || isCommentLine(text)) continue

    const tokens = tokenizeCommandWithRanges(text)
    if (tokens.length === 0) continue

    const rootCommandTokens = getRootCommandTokens(tokens)
    if (rootCommandTokens.length === 0) continue

    const rootCommand = normalizeCommandToken(rootCommandTokens[0].value)

    // Validate scoreboard objectives and players
    if (rootCommand === "scoreboard") {
      handleScoreboardSymbols(registeredObjectives, diagnostics, line.from, rootCommandTokens)
    }

    // Validate inline score references
    handleInlineScoreSymbols(registeredObjectives, diagnostics, line.from, tokens)

    // Validate score selectors in commands
    const scoresMatch = text.match(/scores\s*=\s*\{([^}]*)$/)
    if (scoresMatch) {
      const scoresContent = scoresMatch[1] ?? ""
      const scoresContentOffset = text.indexOf(scoresContent)
      if (scoresContentOffset >= 0) {
        const objectiveKeyRegex = /([A-Za-z0-9_.+-]{1,16})\s*=/g
        for (const match of scoresContent.matchAll(objectiveKeyRegex)) {
          const objective = match[1]
          if (!objective || registeredObjectives.has(objective)) continue
          const relativeStart = (match.index ?? 0)
          const from = line.from + scoresContentOffset + relativeStart
          const to = from + objective.length
          pushUnknownObjectiveDiagnostic(diagnostics, from, to, objective)
        }
      }
    }

    // Validate tag commands
    if (rootCommand === "tag") {
      handleTagCommandSymbols(registeredTags, diagnostics, line.from, rootCommandTokens)
    }

    // Validate selector tags
    handleSelectorTagSymbols(registeredTags, diagnostics, line.from, text)
  }

  return diagnostics
}
