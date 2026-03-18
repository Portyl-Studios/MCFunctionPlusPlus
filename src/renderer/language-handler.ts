import { EditorState, type Extension } from "@codemirror/state"
import { keymap, type EditorView } from "@codemirror/view"
import { autocompletion, startCompletion } from "@codemirror/autocomplete"
import { linter, type Diagnostic } from "@codemirror/lint"
import { json, jsonParseLinter } from "@codemirror/lang-json"
import { markdown } from "@codemirror/lang-markdown"
import type { McfunctionContextIndex } from "./mcfunction-language/context"

import {
  mcfunctionContextExtension,
  mcfunctionLanguage,
  mcfunctionCompletionSource,
  mcfunctionDiagnosticSource,
  getActiveDatapackContextIndex,
} from "./mcfunction-language"

export type EditorLanguageId = "mcfunction" | "json" | "markdown" | "plaintext"

export type DiagnosticSummary = {
  errors: number
  warnings: number
}

export type EditorLanguageInfo = {
  id: EditorLanguageId
  label: string
  codicon: string
  extensions: readonly string[]
  supportsDiagnostics: boolean
}

type EditorLanguageDefinition = EditorLanguageInfo & {
  createExtensions: (onDiagnosticSummaryChange?: (summary: DiagnosticSummary) => void) => Extension[]
}

const summarizeDiagnostics = (diagnostics: readonly Diagnostic[]): DiagnosticSummary => {
  let errors = 0
  let warnings = 0

  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "error") {
      errors += 1
      continue
    }

    if (diagnostic.severity === "warning") {
      warnings += 1
    }
  }

  return { errors, warnings }
}

let enterAutocompleteTimer: number | null = null

const mcfunctionEnterAutocompleteKeymap = keymap.of([
  {
    key: "Enter",
    run: (view) => {
      if (enterAutocompleteTimer !== null) {
        window.clearTimeout(enterAutocompleteTimer)
      }

      enterAutocompleteTimer = window.setTimeout(() => {
        const { state } = view
        const line = state.doc.lineAt(state.selection.main.head)
        const beforeCursor = line.text.slice(0, state.selection.main.head - line.from)

        if (/^\s*$/.test(beforeCursor)) {
          startCompletion(view)
        }

        enterAutocompleteTimer = null
      }, 800)

      return false
    },
  },
])

const LANGUAGE_DEFINITIONS_INTERNAL: EditorLanguageDefinition[] = [
  {
    id: "mcfunction",
    label: "MCFunction",
    codicon: "codicon-file-code",
    extensions: [".mcfunction"],
    supportsDiagnostics: true,
    createExtensions: (onDiagnosticSummaryChange) => [
      autocompletion({
        override: [mcfunctionCompletionSource],
        activateOnTyping: true,
        closeOnBlur: true,
        maxRenderedOptions: 100,
      }),
      linter((view) => {
        const diagnostics = mcfunctionDiagnosticSource(view, getActiveDatapackContextIndex())
        onDiagnosticSummaryChange?.(summarizeDiagnostics(diagnostics))
        return diagnostics
      }),
      mcfunctionEnterAutocompleteKeymap,
      mcfunctionContextExtension,
      mcfunctionLanguage,
    ],
  },
  {
    id: "json",
    label: "JSON",
    codicon: "codicon-json",
    extensions: [".json", ".mcmeta", ".mpp-datapack", ".mpp-workspace"],
    supportsDiagnostics: true,
    createExtensions: (onDiagnosticSummaryChange) => [
      autocompletion({
        activateOnTyping: true,
        closeOnBlur: true,
        maxRenderedOptions: 100,
      }),
      linter((view) => {
        const diagnostics = jsonParseLinter()(view)
        onDiagnosticSummaryChange?.(summarizeDiagnostics(diagnostics))
        return diagnostics
      }),
      json(),
    ],
  },
  {
    id: "markdown",
    label: "Markdown",
    codicon: "codicon-markdown",
    extensions: [".md", ".markdown"],
    supportsDiagnostics: false,
    createExtensions: () => [
      autocompletion({
        activateOnTyping: true,
        closeOnBlur: true,
        maxRenderedOptions: 100,
      }),
      markdown(),
    ],
  },
  {
    id: "plaintext",
    label: "Plain Text",
    codicon: "codicon-file",
    extensions: [],
    supportsDiagnostics: false,
    createExtensions: () => [],
  },
]

const LANGUAGE_BY_ID = new Map(LANGUAGE_DEFINITIONS_INTERNAL.map((language) => [language.id, language]))
const FALLBACK_LANGUAGE = LANGUAGE_BY_ID.get("plaintext")!

const toLanguageInfo = (language: EditorLanguageDefinition): EditorLanguageInfo => ({
  id: language.id,
  label: language.label,
  codicon: language.codicon,
  extensions: language.extensions,
  supportsDiagnostics: language.supportsDiagnostics,
})

export const LANGUAGE_DEFINITIONS: readonly EditorLanguageInfo[] = Object.freeze(
  LANGUAGE_DEFINITIONS_INTERNAL.map((language) =>
    Object.freeze({
      ...toLanguageInfo(language),
      extensions: Object.freeze([...language.extensions]),
    }),
  ),
)

export const detectEditorLanguage = (relativePath: string | null | undefined): EditorLanguageInfo => {
  if (!relativePath) {
    return toLanguageInfo(FALLBACK_LANGUAGE)
  }

  const normalized = relativePath.replace(/\\/g, "/").toLowerCase()

  for (const language of LANGUAGE_DEFINITIONS_INTERNAL) {
    if (language.extensions.some((extension) => normalized.endsWith(extension))) {
      return toLanguageInfo(language)
    }
  }

  return toLanguageInfo(FALLBACK_LANGUAGE)
}

export const getLanguageProcessingExtensions = (
  languageId: EditorLanguageId,
  onDiagnosticSummaryChange?: (summary: DiagnosticSummary) => void,
): Extension[] => {
  const language = LANGUAGE_BY_ID.get(languageId) ?? FALLBACK_LANGUAGE
  return language.createExtensions(onDiagnosticSummaryChange)
}

export const computeDiagnosticSummaryForContent = (
  languageId: EditorLanguageId,
  content: string,
  options?: {
    mcfunctionContextIndex?: McfunctionContextIndex
  },
): DiagnosticSummary => {
  if (languageId === "mcfunction") {
    const state = EditorState.create({ doc: content })
    const virtualView = { state } as unknown as EditorView
    const diagnostics = mcfunctionDiagnosticSource(
      virtualView,
      options?.mcfunctionContextIndex ?? getActiveDatapackContextIndex(),
    )
    return summarizeDiagnostics(diagnostics)
  }

  if (languageId === "json") {
    const state = EditorState.create({ doc: content })
    const virtualView = { state } as unknown as EditorView
    const diagnostics = jsonParseLinter()(virtualView)
    return summarizeDiagnostics(diagnostics)
  }

  return { errors: 0, warnings: 0 }
}
