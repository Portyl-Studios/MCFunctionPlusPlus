import type { EditorView } from "@codemirror/view"
import type { Diagnostic } from "@codemirror/lint"
import { mcfunctionStore, normalizeCommandToken } from "./shared"
import { getActiveDatapackContextIndex } from "./context"

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

const createDiagnosticParseState = (): DiagnosticParseState => ({
  containerStack: [],
  quote: null,
  quoteStartPos: null,
  quoteRole: null,
  escaped: false,
})

const isCommentLine = (text: string) => /^\s*#/.test(text)

type RangedToken = {
  value: string
  start: number
  end: number
}

const OBJECTIVE_REGEX = /^[A-Za-z0-9_.+-]{1,16}$/
const TAG_NAME_REGEX = /^[A-Za-z0-9_./:-]+$/
const SELECTOR_TAG_GLOBAL_REGEX = /(?:^|[\[,])\s*tag\s*=\s*(!?)([A-Za-z0-9_./:-]+)/gi

const normalizeTagName = (value: string) => value.replace(/^!/, "")

const isObjectiveToken = (value: string) => OBJECTIVE_REGEX.test(value)

const isTagNameToken = (value: string) => {
  const normalized = normalizeTagName(value)
  return normalized.length > 0 && TAG_NAME_REGEX.test(normalized)
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

const hasLineContinuation = (text: string) => !isCommentLine(text) && /\\\s*$/.test(text)

const stripLineContinuation = (text: string) => (hasLineContinuation(text) ? text.replace(/\\\s*$/, "") : text)

export const mcfunctionDiagnosticSource = (view: EditorView): Diagnostic[] => {
  const diagnostics: Diagnostic[] = []
  const doc = view.state.doc
  const activeDatapackContext = getActiveDatapackContextIndex()
  const registeredObjectives = new Set(activeDatapackContext.objectives)
  const registeredTags = new Set(activeDatapackContext.tags)

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
    const rootCommand = tokens[0] ? normalizeCommandToken(tokens[0].value) : null

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

    if (rootCommand === "scoreboard") {
      const groupToken = tokens[1]?.value
      const actionToken = tokens[2]?.value

      if (groupToken === "objectives") {
        const objectiveToken = tokens[3]
        if (objectiveToken && isObjectiveToken(objectiveToken.value)) {
          if (actionToken === "add") {
            registeredObjectives.add(objectiveToken.value)
          } else if (actionToken === "remove") {
            if (!registeredObjectives.has(objectiveToken.value)) {
              pushUnknownObjectiveDiagnostic(
                diagnostics,
                line.from + objectiveToken.start,
                line.from + objectiveToken.end,
                objectiveToken.value,
              )
            } else {
              registeredObjectives.delete(objectiveToken.value)
            }
          } else if (actionToken === "modify" && !registeredObjectives.has(objectiveToken.value)) {
            pushUnknownObjectiveDiagnostic(
              diagnostics,
              line.from + objectiveToken.start,
              line.from + objectiveToken.end,
              objectiveToken.value,
            )
          }
        }
      }

      if (groupToken === "players") {
        const checkObjectiveToken = (objectiveToken: RangedToken | undefined) => {
          if (!objectiveToken || !isObjectiveToken(objectiveToken.value)) return
          if (registeredObjectives.has(objectiveToken.value)) return
          pushUnknownObjectiveDiagnostic(
            diagnostics,
            line.from + objectiveToken.start,
            line.from + objectiveToken.end,
            objectiveToken.value,
          )
        }

        if (actionToken === "operation") {
          checkObjectiveToken(tokens[4])
          checkObjectiveToken(tokens[7])
        } else if (actionToken === "set" || actionToken === "add" || actionToken === "remove" || actionToken === "get" || actionToken === "reset" || actionToken === "enable") {
          checkObjectiveToken(tokens[4])
        }
      }
    }

    for (let i = 0; i < tokens.length - 2; i += 1) {
      if (tokens[i].value !== "score") continue
      const objectiveToken = tokens[i + 2]
      if (!objectiveToken || !isObjectiveToken(objectiveToken.value)) continue
      if (registeredObjectives.has(objectiveToken.value)) continue
      pushUnknownObjectiveDiagnostic(
        diagnostics,
        line.from + objectiveToken.start,
        line.from + objectiveToken.end,
        objectiveToken.value,
      )
    }

    const scoresMatch = textForValidation.match(/scores\s*=\s*\{([^}]*)$/)
    if (scoresMatch) {
      const scoresContent = scoresMatch[1] ?? ""
      const scoresContentOffset = textForValidation.indexOf(scoresContent)
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

    if (rootCommand === "tag") {
      const actionToken = tokens[2]?.value
      const tagToken = tokens[3]
      if (tagToken && isTagNameToken(tagToken.value)) {
        const tagName = normalizeTagName(tagToken.value)
        if (actionToken === "add") {
          registeredTags.add(tagName)
        } else if (actionToken === "remove") {
          if (!registeredTags.has(tagName)) {
            pushUnknownTagDiagnostic(
              diagnostics,
              line.from + tagToken.start,
              line.from + tagToken.end,
              tagName,
            )
          } else {
            registeredTags.delete(tagName)
          }
        }
      }
    }

    const quotedRanges = getQuotedRanges(textForValidation)
    for (const match of textForValidation.matchAll(SELECTOR_TAG_GLOBAL_REGEX)) {
      const rawTagName = match[2]
      if (!rawTagName || !isTagNameToken(rawTagName)) continue

      const matchStart = match.index ?? -1
      if (matchStart < 0) continue
      if (isInQuotedRange(matchStart, quotedRanges)) continue

      const tagName = normalizeTagName(rawTagName)
      if (registeredTags.has(tagName)) continue

      const valueStart = textForValidation.indexOf(rawTagName, matchStart)
      if (valueStart < 0) continue

      pushUnknownTagDiagnostic(
        diagnostics,
        line.from + valueStart,
        line.from + valueStart + rawTagName.length,
        tagName,
      )
    }

    isContinuationLine = hasContinuation
  }

  return diagnostics
}
