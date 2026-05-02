import { StreamLanguage, type StringStream } from "@codemirror/language"
import { createInitialStreamState, McFunctionStreamState, mcfunctionStore, normalizeCommandToken } from "./shared"

const streamErrorHandling = {
  resetLineState(stream: StringStream, state: McFunctionStreamState) {
    if (!stream.sol()) return

    if (!state.isContinuedLine) {
      state.atLineStart = true
      state.atCommandStart = true
      state.isInvalidLine = false
      state.squareBracketDepth = 0
      state.parenDepth = 0
      state.braceDepth = 0
      state.apostropheDepth = 0
      state.quotationDepth = 0
      state.expectingBracketKey = true
      state.expectingBracketValue = false
      state.expectingQuotedBracketStringValue = false
      state.expectingQuotedBracketCommandValue = false
      state.inQuotedBracketStringValue = false
      state.inQuotedBracketCommandValue = false
      state.quotedBracketValueCanStartCommand = false
      state.nextExpected = null
      return
    }

    state.isContinuedLine = false
  },

  consumeInvalidLine(stream: StringStream, state: McFunctionStreamState) {
    if (!state.isInvalidLine) return false

    if (/\\\s*$/.test(stream.string)) {
      state.isContinuedLine = true
    }

    stream.skipToEnd()
    return true
  },

  markInvalidLine(stream: StringStream, state: McFunctionStreamState) {
    state.isInvalidLine = true
    if (/\\\s*$/.test(stream.string)) {
      state.isContinuedLine = true
    }
  },
}

const highlighter = {
  startState(): McFunctionStreamState {
    return createInitialStreamState()
  },
  copyState(state: McFunctionStreamState): McFunctionStreamState {
    return {
      atLineStart: state.atLineStart,
      atCommandStart: state.atCommandStart,
      isContinuedLine: state.isContinuedLine,
      isInvalidLine: state.isInvalidLine,

      squareBracketDepth: state.squareBracketDepth,
      parenDepth: state.parenDepth,
      braceDepth: state.braceDepth,
      apostropheDepth: state.apostropheDepth,
      quotationDepth: state.quotationDepth,

      expectingBracketKey: state.expectingBracketKey,
      expectingBracketValue: state.expectingBracketValue,
      expectingQuotedBracketStringValue: state.expectingQuotedBracketStringValue,
      expectingQuotedBracketCommandValue: state.expectingQuotedBracketCommandValue,
      inQuotedBracketStringValue: state.inQuotedBracketStringValue,
      inQuotedBracketCommandValue: state.inQuotedBracketCommandValue,
      quotedBracketValueCanStartCommand: state.quotedBracketValueCanStartCommand,

      nextExpected: state.nextExpected,
    }
  },
  token(stream: StringStream, state: McFunctionStreamState) {
    // Node: reset line-level parser flags at start-of-line.
    streamErrorHandling.resetLineState(stream, state)

    // Node: consume the rest of a previously invalid line as invalid.
    if (streamErrorHandling.consumeInvalidLine(stream, state)) {
      return "invalid"
    }

    // Node: whitespace (no highlighting token).
    if (stream.eatSpace()) return null

    // Node: whole-line comments that begin with '#'.
    if (state.atLineStart && stream.peek() === "#") {
      stream.skipToEnd()
      return "comment"
    }

    // Node: opening square bracket '[' outside protected quoted bracket strings.
    if (!state.inQuotedBracketStringValue && stream.peek() === "[") {
      state.squareBracketDepth += 1
      state.expectingBracketKey = true
      state.expectingBracketValue = false
      state.expectingQuotedBracketStringValue = false
      state.expectingQuotedBracketCommandValue = false
      state.inQuotedBracketStringValue = false
      state.inQuotedBracketCommandValue = false
      state.quotedBracketValueCanStartCommand = false
      stream.next()
      return "squareBracket"
    }

    // Node: closing square bracket ']'.
    if (!state.inQuotedBracketStringValue && stream.peek() === "]") {
      state.squareBracketDepth = Math.max(0, state.squareBracketDepth - 1)
      if (state.squareBracketDepth === 0) {
        state.expectingBracketKey = false
        state.expectingBracketValue = false
        state.expectingQuotedBracketStringValue = false
        state.expectingQuotedBracketCommandValue = false
        state.inQuotedBracketStringValue = false
        state.inQuotedBracketCommandValue = false
        state.quotedBracketValueCanStartCommand = false
      }
      stream.next()
      return "squareBracket"
    }

    // Node: opening parenthesis '('.
    if (!state.inQuotedBracketStringValue && stream.peek() === "(") {
      state.parenDepth += 1
      state.expectingBracketKey = true
      state.expectingBracketValue = false
      state.expectingQuotedBracketStringValue = false
      state.expectingQuotedBracketCommandValue = false
      state.inQuotedBracketStringValue = false
      state.inQuotedBracketCommandValue = false
      state.quotedBracketValueCanStartCommand = false
      stream.next()
      return "paren"
    }

    // Node: closing parenthesis ')'.
    if (!state.inQuotedBracketStringValue && stream.peek() === ")") {
      state.parenDepth = Math.max(0, state.parenDepth - 1)
      if (state.parenDepth === 0) {
        state.expectingBracketKey = false
        state.expectingBracketValue = false
        state.expectingQuotedBracketStringValue = false
        state.expectingQuotedBracketCommandValue = false
        state.inQuotedBracketStringValue = false
        state.inQuotedBracketCommandValue = false
        state.quotedBracketValueCanStartCommand = false
      }
      stream.next()
      return "paren"
    }

    // Node: opening brace '{'.
    if (!state.inQuotedBracketStringValue && stream.peek() === "{") {
      state.braceDepth += 1
      state.expectingBracketKey = true
      state.expectingBracketValue = false
      state.expectingQuotedBracketStringValue = false
      state.expectingQuotedBracketCommandValue = false
      state.inQuotedBracketStringValue = false
      state.inQuotedBracketCommandValue = false
      state.quotedBracketValueCanStartCommand = false
      stream.next()
      return "brace"
    }

    // Node: closing brace '}'.
    if (!state.inQuotedBracketStringValue && stream.peek() === "}") {
      state.braceDepth = Math.max(0, state.braceDepth - 1)
      if (state.braceDepth === 0) {
        state.expectingBracketKey = false
        state.expectingBracketValue = false
        state.expectingQuotedBracketStringValue = false
        state.expectingQuotedBracketCommandValue = false
        state.inQuotedBracketStringValue = false
        state.inQuotedBracketCommandValue = false
        state.quotedBracketValueCanStartCommand = false
      }
      stream.next()
      return "brace"
    }

    // Node: end of quoted command-string value (closing ").
    if (state.inQuotedBracketCommandValue) {
      if (stream.peek() === '"') {
        state.inQuotedBracketCommandValue = false
        stream.next()
        return "string"
      }
    }

    // Node group: content inside a quoted bracket string value.
    if (state.inQuotedBracketStringValue) {
      // Node: command opener '/' when quoted value is configured to start a command.
      if (state.quotedBracketValueCanStartCommand) {
        if (stream.peek() === "/") {
          state.quotedBracketValueCanStartCommand = false
          state.inQuotedBracketStringValue = false
          state.inQuotedBracketCommandValue = true
          state.atCommandStart = true
          stream.next()
          return "keyword"
        }
        state.quotedBracketValueCanStartCommand = false
      }

      // Node: macro placeholder like $(name) inside quoted string values.
      if (stream.match(/\$\([^)]+\)/)) return "macroName"

      // Node: generic text chunk inside quoted string values.
      if (stream.match(/(?:[^"\\$]|\\.)+/)) return "string"

      // Node: terminating quote for quoted string values.
      if (stream.peek() === '"') {
        state.inQuotedBracketStringValue = false
        stream.next()
        return "string"
      }
      stream.next()
      return "string"
    }

    // Node: start of a quoted bracket value string after text/value/command keys.
    if (
      (state.squareBracketDepth > 0 || state.braceDepth > 0 || state.parenDepth > 0) &&
      state.expectingBracketValue &&
      state.expectingQuotedBracketStringValue &&
      stream.peek() === '"'
    ) {
      state.inQuotedBracketStringValue = true
      state.quotedBracketValueCanStartCommand = state.expectingQuotedBracketCommandValue
      state.expectingQuotedBracketStringValue = false
      state.expectingQuotedBracketCommandValue = false
      stream.next()
      return "string"
    }

    // Node group: quoted bracket keys (e.g. "text", "value", "command").
    if (
      (state.squareBracketDepth > 0 || state.braceDepth > 0 || state.parenDepth > 0) &&
      state.expectingBracketKey &&
      stream.peek() === '"'
    ) {
      // Node: special quoted keys that enable quoted string-value parsing.
      if (stream.match(/"(text|value|command)"(?=\s*[:=])/)) {
        state.expectingQuotedBracketStringValue = true
        state.expectingQuotedBracketCommandValue =
          stream.current() === '"value"' || stream.current() === '"command"'
        return "attributeName"
      }

      // Node: generic quoted key before ':' or '='.
      if (stream.match(/"[A-Za-z0-9_$.#-]+"(?=\s*[:=])/)) {
        state.expectingQuotedBracketStringValue = false
        state.expectingQuotedBracketCommandValue = false
        return "attributeName"
      }
    }

    // Node: quote tokens (single and double quote).
    if (stream.peek() === "'") {
      state.apostropheDepth += 1
      stream.next()
      return "string"
    }

    if (stream.peek() === '"') {
      state.quotationDepth += 1
      stream.next()
      return "string"
    }

    // Node group: separators inside bracket/brace/paren contexts.
    if (state.squareBracketDepth > 0 || state.braceDepth > 0 || state.parenDepth > 0) {
      // Node: key/value separator ':' or '='.
      if (stream.match(/[:=]/)) {
        state.expectingBracketKey = false
        state.expectingBracketValue = true
        return "punctuation"
      }

      // Node: pair separator ','.
      if (stream.match(",")) {
        state.expectingBracketKey = true
        state.expectingBracketValue = false
        state.expectingQuotedBracketStringValue = false
        state.expectingQuotedBracketCommandValue = false
        state.inQuotedBracketStringValue = false
        state.inQuotedBracketCommandValue = false
        state.quotedBracketValueCanStartCommand = false
        return "punctuation"
      }
    }

    // Node: macro sigil '$' at command start.
    if (state.atCommandStart && stream.match("$")) {
      return "macroName"
    }

    // Node: macro placeholder $(...) outside quoted string special mode.
    if (stream.match(/\$\([^)]+\)/)) {
      return "macroName"
    }

    // Node: root command token at command start.
    if (state.atCommandStart && stream.match(/[a-z0-9_:-]+/i)) {
      const commandToken = normalizeCommandToken(stream.current())
      state.atLineStart = false
      state.atCommandStart = false
      if (mcfunctionStore.rootCommandNames.has(commandToken)) {
        return "keyword"
      }

      streamErrorHandling.markInvalidLine(stream, state)
      stream.skipToEnd()
      return "invalid"
    }

    // Node: 'run' keyword that resets command-start context.
    if (stream.match(/\brun\b/)) {
      state.atCommandStart = true
      return "controlKeyword"
    }

    // Node: line continuation operator '\\' at line end.
    if (stream.match(/\\\s*$/)) {
      state.isContinuedLine = true
      return "operator"
    }

    // Node: escape sequence (backslash + one char).
    if (stream.match(/\\./)) {
      return "escape"
    }

    // Node: namespaced identifier used as a bracket value.
    if (state.expectingBracketValue && stream.peek() !== '"' && stream.match(/#?[a-z_][a-z0-9_.-]*:[a-z0-9_./-]+/)) return "namespace"

    // Node: namespaced identifier used as a quoted bracket key.
    if (
      state.expectingBracketKey &&
      (stream.string[stream.pos - 1] === '"' || stream.string[stream.pos - 1] === "'") &&
      stream.match(/#?[a-z_][a-z0-9_.-]*:[a-z0-9_./-]+(?=["'])/)
    ) return "namespace"

    // Node: coordinate vectors using ~ or ^ (2-3 components).
    if (stream.match(/^[~^]-?\d*\.?\d*(?:\s+[~^]-?\d*\.?\d*){1,2}/)) {
      return "number"
    }

    // Node: numeric ranges and numeric literals with optional suffixes.
    if (stream.match(/^-?\d+\.\.\d+|-?\d+\.\.|\.\.-?\d+|-?\d+(\.\d+)?[blfdts]?/)) return "number"

    // Node group: unquoted bracket key/value identifiers.
    if (state.squareBracketDepth > 0 || state.braceDepth > 0 || state.parenDepth > 0) {
      const match = stream.match(/[A-Za-z0-9_$.#-]+/)
      if (match && typeof match !== "boolean") {
        // Node: bracket key token.
        if (state.expectingBracketKey) {
          return "attributeName"

        // Node: bracket value token.
        } else if (state.expectingBracketValue) {
          state.expectingQuotedBracketStringValue = false
          state.expectingQuotedBracketCommandValue = false
          return "attributeValue"
        }
      }
    }

    // Node: generic namespaced identifier.
    if (stream.match(/#?[a-z_][a-z0-9_.-]*:[a-z0-9_./-]+/)) return "namespace"

    // Node: control flow keywords (currently reserved/no token return).
    if (stream.match(/\b(if|unless)\b/)) {
      // return "controlKeyword"
    }

    // Node: entity selector token like @s, @p, @a, @e.
    if (stream.match(/@[a-z]/)) return "labelName"

    // Node: operator-style command verbs.
    if (stream.match(/\b(add|remove|operation|get|set|reset|merge|modify|append|insert|prepend)\b/)) return "operatorKeyword"

    // Node: operators and comparator keywords.
    if (stream.match(/[=<>]|[-+*/%\!<>]=|><|matches/)) return "operator"

    // Node: variable-style identifiers containing '$' or leading '$'/'#'.
    if (stream.match(/[a-zA-Z0-9_.]+\$[a-zA-Z0-9_.]+|[\$\#][a-zA-Z0-9_.]+/)) return "variableName"

    // Node: generic identifier fallback.
    if (stream.match(/[A-Za-z_][A-Za-z0-9_.-]*/)) return null

    // Node: final single-character fallback consume.
    stream.next()
    return null
  },
}

export const mcfunctionLanguage = StreamLanguage.define<McFunctionStreamState>(highlighter)
