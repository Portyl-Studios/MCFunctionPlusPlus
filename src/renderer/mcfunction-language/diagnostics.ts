import type { EditorView } from "@codemirror/view"
import type { Diagnostic } from "@codemirror/lint"
import { mcfunctionStore, normalizeCommandToken } from "./shared"

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

const hasLineContinuation = (text: string) => !isCommentLine(text) && /\\\s*$/.test(text)

const stripLineContinuation = (text: string) => (hasLineContinuation(text) ? text.replace(/\\\s*$/, "") : text)

export const mcfunctionDiagnosticSource = (view: EditorView): Diagnostic[] => {
  const diagnostics: Diagnostic[] = []
  const doc = view.state.doc

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

    isContinuationLine = hasContinuation
  }

  return diagnostics
}
