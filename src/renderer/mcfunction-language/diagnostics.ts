import type { EditorView } from "@codemirror/view"
import type { Diagnostic } from "@codemirror/lint"
import { mcfunctionStore, normalizeCommandToken } from "./shared"
import type { McfunctionContextIndex } from "./context"
import { collectEntityTagsFromNbt, getQuotedRanges, getRootCommandTokens, isInQuotedRange, type RangedToken, tokenizeCommandWithRanges } from "./parse-utils"

const findCommandSuggestions = (command: string) => {
  const lower = command.toLowerCase()
  return [...mcfunctionStore.rootCommandNames]
    .filter(name => name.startsWith(lower) || name.includes(lower))
    .slice(0, 3)
}

type BracketChar = "[" | "(" | "{"
type ContainerKind = "object" | "list" | "paren"
type ObjectContainerMode = "key-or-end" | "after-key" | "value" | "comma-or-end"
type ListContainerMode = "value-or-end" | "after-key" | "comma-or-end"

type ContainerEntry =
  | { kind: "object"; char: "{"; pos: number; mode: ObjectContainerMode }
  | { kind: "list"; char: "["; pos: number; mode: ListContainerMode }
  | { kind: "paren"; char: "("; pos: number; mode: ListContainerMode }

type DiagnosticParseState = {
  containerStack: ContainerEntry[]
  quote: "'" | '"' | null
  quoteStartPos: number | null
  quoteRole: "object-key" | "value" | null
  escaped: boolean
}

const isCommentLine = (text: string) => /^\s*#/.test(text)

type DiagnosticPass = "collect" | "validate"

type SymbolDiagnosticState = {
  registeredObjectives: Set<string>
  registeredTags: Set<string>
  diagnostics: Diagnostic[]
}

const OBJECTIVE_REGEX = /^[A-Za-z0-9_.+-]{1,16}$/
const TAG_NAME_REGEX = /^[A-Za-z0-9_./:-]+$/
const SELECTOR_TAG_GLOBAL_REGEX = /(?:^|[\[,])\s*tag\s*=\s*(!?)([A-Za-z0-9_./:-]+)/gi
const SCORE_COMPARISON_OPERATORS = new Set(["<", "<=", "=", ">=", ">", "matches"])
const SCOREBOARD_PLAYER_ACTIONS = new Set(["set", "add", "remove", "get", "reset", "enable"])

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
  state: SymbolDiagnosticState,
  lineFrom: number,
  objectiveToken: RangedToken | undefined,
  pass: DiagnosticPass,
) => {
  if (!objectiveToken || !isObjectiveToken(objectiveToken.value)) return

  if (pass === "collect") return

  if (state.registeredObjectives.has(objectiveToken.value)) return
  pushUnknownObjectiveDiagnostic(
    state.diagnostics,
    lineFrom + objectiveToken.start,
    lineFrom + objectiveToken.end,
    objectiveToken.value,
  )
}

const handleScoreboardSymbols = (
  state: SymbolDiagnosticState,
  lineFrom: number,
  rootCommandTokens: RangedToken[],
  pass: DiagnosticPass,
) => {
  const groupToken = rootCommandTokens[1]?.value
  const actionToken = rootCommandTokens[2]?.value

  if (groupToken === "objectives") {
    const objectiveToken = rootCommandTokens[3]
    if (!objectiveToken || !isObjectiveToken(objectiveToken.value)) return

    if (pass === "collect") {
      if (actionToken === "add") {
        state.registeredObjectives.add(objectiveToken.value)
      }
      return
    }

    if (actionToken === "add") {
      state.registeredObjectives.add(objectiveToken.value)
      return
    }

    if (actionToken === "modify" || actionToken === "remove") {
      handleObjectiveToken(state, lineFrom, objectiveToken, "validate")
    }
    return
  }

  if (groupToken !== "players") return

  if (actionToken === "operation") {
    handleObjectiveToken(state, lineFrom, rootCommandTokens[4], pass)
    handleObjectiveToken(state, lineFrom, rootCommandTokens[7], pass)
    return
  }

  if (actionToken && SCOREBOARD_PLAYER_ACTIONS.has(actionToken)) {
    handleObjectiveToken(state, lineFrom, rootCommandTokens[4], pass)
  }
}

const handleInlineScoreSymbols = (
  state: SymbolDiagnosticState,
  lineFrom: number,
  tokens: RangedToken[],
  pass: DiagnosticPass,
) => {
  for (let i = 0; i < tokens.length - 2; i += 1) {
    if (tokens[i].value !== "score") continue
    handleObjectiveToken(state, lineFrom, tokens[i + 2], pass)

    const operationToken = tokens[i + 3]?.value
    if (operationToken && SCORE_COMPARISON_OPERATORS.has(operationToken)) {
      handleObjectiveToken(state, lineFrom, tokens[i + 5], pass)
    }
  }
}

const handleTagCommandSymbols = (
  state: SymbolDiagnosticState,
  lineFrom: number,
  rootCommandTokens: RangedToken[],
  pass: DiagnosticPass,
) => {
  const actionToken = rootCommandTokens[2]?.value
  if (actionToken !== "add" && actionToken !== "remove") return

  const tagToken = rootCommandTokens[3]
  if (!tagToken || !isTagNameToken(tagToken.value)) return

  const tagName = normalizeTagName(tagToken.value)

  if (pass === "collect") {
    if (actionToken === "add") {
      state.registeredTags.add(tagName)
    }
    return
  }

  if (actionToken === "add") {
    state.registeredTags.add(tagName)
    return
  }

  if (!state.registeredTags.has(tagName)) {
    pushUnknownTagDiagnostic(
      state.diagnostics,
      lineFrom + tagToken.start,
      lineFrom + tagToken.end,
      tagName,
    )
  }
}

const handleSelectorTagSymbols = (
  state: SymbolDiagnosticState,
  lineFrom: number,
  lineText: string,
  pass: DiagnosticPass,
) => {
  if (pass === "collect") return

  const quotedRanges = getQuotedRanges(lineText)
  for (const match of lineText.matchAll(SELECTOR_TAG_GLOBAL_REGEX)) {
    const rawTagName = match[2]
    if (!rawTagName || !isTagNameToken(rawTagName)) continue

    const matchStart = match.index ?? -1
    if (matchStart < 0) continue
    if (isInQuotedRange(matchStart, quotedRanges)) continue

    const tagName = normalizeTagName(rawTagName)
    if (state.registeredTags.has(tagName)) continue

    const valueStart = lineText.indexOf(rawTagName, matchStart)
    if (valueStart < 0) continue

    pushUnknownTagDiagnostic(
      state.diagnostics,
      lineFrom + valueStart,
      lineFrom + valueStart + rawTagName.length,
      tagName,
    )
  }
}

const handleEntityNbtTagSymbols = (
  state: SymbolDiagnosticState,
  lineText: string,
  pass: DiagnosticPass,
) => {
  if (pass !== "collect") return

  for (const tagName of collectEntityTagsFromNbt(lineText)) {
    if (isTagNameToken(tagName)) {
      state.registeredTags.add(normalizeTagName(tagName))
    }
  }
}

const hasLineContinuation = (text: string) => !isCommentLine(text) && /\\\s*$/.test(text)

const stripLineContinuation = (text: string) => (hasLineContinuation(text) ? text.replace(/\\\s*$/, "") : text)

export const mcfunctionDiagnosticSource = (view: EditorView, contextIndex?: McfunctionContextIndex): Diagnostic[] => {
  const diagnostics: Diagnostic[] = []
  const doc = view.state.doc
  const symbolState: SymbolDiagnosticState = {
    registeredObjectives: new Set(contextIndex?.objectives ?? []),
    registeredTags: new Set(contextIndex?.tags ?? []),
    diagnostics,
  }

  const getContinuationBlockEndLine = (startLineNumber: number) => {
    let endLineNumber = startLineNumber
    while (endLineNumber < doc.lines) {
      const current = doc.line(endLineNumber)
      if (!hasLineContinuation(current.text)) break
      endLineNumber += 1
    }
    return endLineNumber
  }

  let isContinuationLine = false

  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber)
    const text = line.text
    const hasContinuation = hasLineContinuation(text)
    const textForValidation = stripLineContinuation(text)

    if (!text.trim() || isCommentLine(text)) {
      isContinuationLine = hasContinuation
      continue
    }

    const tokens = tokenizeCommandWithRanges(textForValidation)
    const rootCommandTokens = getRootCommandTokens(tokens)
    const nestedRootCommand = rootCommandTokens[0] ? normalizeCommandToken(rootCommandTokens[0].value) : null

    const commandMatch = textForValidation.match(/^\s*\/?([a-z0-9_:-]+)/i)
    if (!isContinuationLine) {
      const blockEndLineNumber = hasContinuation ? getContinuationBlockEndLine(lineNumber) : lineNumber
      const diagnosticTo = doc.line(blockEndLineNumber).to

      let blockHasMacroVariables = false
      for (let currentLine = lineNumber; currentLine <= blockEndLineNumber; currentLine += 1) {
        const blockLineText = stripLineContinuation(doc.line(currentLine).text)
        if (/\$\([^)]+\)/.test(blockLineText)) {
          blockHasMacroVariables = true
          break
        }
      }

      const commandStartsWithMacro = /^\s*\/?\$/.test(textForValidation)
      if (blockHasMacroVariables && !commandStartsWithMacro) {
        diagnostics.push({
          from: line.from,
          to: diagnosticTo,
          severity: "warning",
          message: "This command uses $(...) macros but does not start with '$'. Use '$<command>' (for example: '$tellraw').",
        })
      }
    }

    if (!isContinuationLine && commandMatch) {
      const rawCommandToken = commandMatch[1].split(/\s+/)[0]
      const command = normalizeCommandToken(rawCommandToken)
      if (!mcfunctionStore.rootCommandNames.has(command)) {
        const suggestions = findCommandSuggestions(command)
        const suggestionText = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}?` : ""

        const blockEndLineNumber = hasContinuation ? getContinuationBlockEndLine(lineNumber) : lineNumber
        const diagnosticTo = doc.line(blockEndLineNumber).to

        diagnostics.push({
          from: line.from,
          to: diagnosticTo,
          severity: "error",
          message: `Unknown command '${rawCommandToken}'.${suggestionText}`,
        })
      }
    }

    if (nestedRootCommand === "scoreboard") {
      handleScoreboardSymbols(symbolState, line.from, rootCommandTokens, "validate")
    }

    handleInlineScoreSymbols(symbolState, line.from, tokens, "validate")

    const scoresMatch = textForValidation.match(/scores\s*=\s*\{([^}]*)$/)
    if (scoresMatch) {
      const scoresContent = scoresMatch[1] ?? ""
      const scoresContentOffset = textForValidation.indexOf(scoresContent)
      if (scoresContentOffset >= 0) {
        const objectiveKeyRegex = /([A-Za-z0-9_.+-]{1,16})\s*=/g
        for (const match of scoresContent.matchAll(objectiveKeyRegex)) {
          const objective = match[1]
          if (!objective || symbolState.registeredObjectives.has(objective)) continue
          const relativeStart = (match.index ?? 0)
          const from = line.from + scoresContentOffset + relativeStart
          const to = from + objective.length
          pushUnknownObjectiveDiagnostic(diagnostics, from, to, objective)
        }
      }
    }

    if (nestedRootCommand === "tag") {
      handleTagCommandSymbols(symbolState, line.from, rootCommandTokens, "validate")
    }

    if (nestedRootCommand === "summon" || nestedRootCommand === "data") {
      handleEntityNbtTagSymbols(symbolState, textForValidation, "collect")
    }

    handleSelectorTagSymbols(symbolState, line.from, textForValidation, "validate")

    isContinuationLine = hasContinuation
  }

  return diagnostics
}
