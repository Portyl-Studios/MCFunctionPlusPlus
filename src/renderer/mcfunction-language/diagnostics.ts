import type { EditorView } from "@codemirror/view"
import type { Diagnostic } from "@codemirror/lint"
import { mcfunctionStore, normalizeCommandToken } from "./shared"

const findCommandSuggestions = (command: string) => {
  const lower = command.toLowerCase()
  return [...mcfunctionStore.rootCommandNames]
    .filter(name => name.startsWith(lower) || name.includes(lower))
    .slice(0, 3)
}

type BracketEntry = { char: "[" | "(" | "{"; pos: number }

type DiagnosticParseState = {
  bracketStack: BracketEntry[]
  quote: "'" | '"' | null
  escaped: boolean
}

const createDiagnosticParseState = (): DiagnosticParseState => ({
  bracketStack: [],
  quote: null,
  escaped: false,
})

const validateBracketsAndQuotes = (
  text: string,
  lineFrom: number,
  parseState: DiagnosticParseState,
  finalizeBlock: boolean,
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = []
  const scanText = text

  for (let index = 0; index < scanText.length; index += 1) {
    const char = scanText[index]

    if (parseState.escaped) {
      parseState.escaped = false
      continue
    }

    if (char === "\\") {
      parseState.escaped = true
      continue
    }

    if (parseState.quote) {
      if (char === parseState.quote) parseState.quote = null
      continue
    }

    if (char === "'" || char === '"') {
      parseState.quote = char
      continue
    }

    if (char === "[" || char === "(" || char === "{") {
      parseState.bracketStack.push({ char, pos: lineFrom + index })
      continue
    }

    if (char === "]" || char === ")" || char === "}") {
      const expectedOpen = char === "]" ? "[" : char === ")" ? "(" : "{"
      const top = parseState.bracketStack[parseState.bracketStack.length - 1]
      if (!top || top.char !== expectedOpen) {
        diagnostics.push({
          from: lineFrom + index,
          to: lineFrom + index + 1,
          severity: "error",
          message: `Unexpected '${char}'.`,
        })
        continue
      }
      parseState.bracketStack.pop()
    }
  }

  if (!finalizeBlock) return diagnostics

  if (parseState.quote) {
    diagnostics.push({
      from: lineFrom + Math.max(0, scanText.length - 1),
      to: lineFrom + scanText.length,
      severity: "error",
      message: "Unterminated string literal.",
    })
  }

  for (const remaining of parseState.bracketStack) {
    diagnostics.push({
      from: remaining.pos,
      to: remaining.pos + 1,
      severity: "error",
      message: `Unclosed '${remaining.char}'.`,
    })
  }

  parseState.bracketStack = []
  parseState.quote = null
  parseState.escaped = false

  return diagnostics
}

export const mcfunctionDiagnosticSource = (view: EditorView): Diagnostic[] => {
  const diagnostics: Diagnostic[] = []
  const doc = view.state.doc
  const parseState = createDiagnosticParseState()

  const getContinuationBlockEndLine = (startLineNumber: number) => {
    let endLineNumber = startLineNumber
    while (endLineNumber < doc.lines) {
      const current = doc.line(endLineNumber)
      if (!/\\\s*$/.test(current.text)) break
      endLineNumber += 1
    }
    return endLineNumber
  }

  let isContinuationLine = false
  let lastProcessedLineFrom = 0
  let lastProcessedLineLength = 0

  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber)
    const text = line.text
    const hasContinuation = /\\\s*$/.test(text)
    const textForValidation = hasContinuation ? text.replace(/\\\s*$/, "") : text

    lastProcessedLineFrom = line.from
    lastProcessedLineLength = textForValidation.length

    if (!text.trim() || /^\s*#/.test(text)) {
      isContinuationLine = hasContinuation
      continue
    }

    const commandMatch = textForValidation.match(/^\s*\/?([a-z0-9_:-]+)/i)
    if (!isContinuationLine) {
      const blockEndLineNumber = hasContinuation ? getContinuationBlockEndLine(lineNumber) : lineNumber
      const diagnosticTo = doc.line(blockEndLineNumber).to

      let blockHasMacroVariables = false
      for (let currentLine = lineNumber; currentLine <= blockEndLineNumber; currentLine += 1) {
        const blockLineText = doc.line(currentLine).text.replace(/\\\s*$/, "")
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
        const fullMatch = commandMatch[0]
        const commandStartInLine = fullMatch.lastIndexOf(rawCommandToken)
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

    diagnostics.push(...validateBracketsAndQuotes(textForValidation, line.from, parseState, !hasContinuation))
    isContinuationLine = hasContinuation
  }

  if (parseState.quote || parseState.bracketStack.length > 0) {
    diagnostics.push(...validateBracketsAndQuotes("", lastProcessedLineFrom + lastProcessedLineLength, parseState, true))
  }

  return diagnostics
}
