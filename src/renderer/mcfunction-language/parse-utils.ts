import { normalizeCommandToken } from "./shared"

export type RangedToken = {
  value: string
  start: number
  end: number
}

export const tokenizeCommandWithRanges = (input: string): RangedToken[] => {
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

export const getRootCommandTokens = (tokens: RangedToken[]): RangedToken[] => {
  if (tokens.length === 0) return tokens

  let currentTokens = tokens

  for (let depth = 0; depth < 8; depth += 1) {
    const root = normalizeCommandToken(currentTokens[0]?.value ?? "")
    if (root === "run") {
      if (currentTokens.length <= 1) break
      currentTokens = currentTokens.slice(1)
      continue
    }

    if (root !== "execute") break

    const runIndex = currentTokens.findIndex(token => normalizeCommandToken(token.value) === "run")
    if (runIndex < 0 || runIndex >= currentTokens.length - 1) break

    currentTokens = currentTokens.slice(runIndex + 1)
  }

  return currentTokens
}

export const getQuotedRanges = (lineText: string) => {
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

export const isInQuotedRange = (index: number, ranges: Array<{ start: number; end: number }>) => {
  return ranges.some(range => index >= range.start && index < range.end)
}

const NBT_TAGS_LIST_REGEX = /\bTags\s*:\s*\[/gi

const findMatchingClosingBracket = (text: string, openBracketIndex: number) => {
  let depth = 0
  let quote: "'" | '"' | null = null
  let escaped = false

  for (let index = openBracketIndex; index < text.length; index += 1) {
    const character = text[index]

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

    if (character === "[") {
      depth += 1
      continue
    }

    if (character === "]") {
      depth -= 1
      if (depth === 0) return index
    }
  }

  return -1
}

const splitNbtListEntries = (content: string) => {
  const entries: string[] = []
  let current = ""
  let quote: "'" | '"' | null = null
  let escaped = false

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]

    if (escaped) {
      current += character
      escaped = false
      continue
    }

    if (character === "\\") {
      current += character
      escaped = true
      continue
    }

    if (quote) {
      current += character
      if (character === quote) quote = null
      continue
    }

    if (character === '"' || character === "'") {
      quote = character
      current += character
      continue
    }

    if (character === ",") {
      const trimmedEntry = current.trim()
      if (trimmedEntry.length > 0) entries.push(trimmedEntry)
      current = ""
      continue
    }

    current += character
  }

  const trimmedEntry = current.trim()
  if (trimmedEntry.length > 0) entries.push(trimmedEntry)

  return entries
}

const unquoteNbtString = (value: string) => {
  if (value.length < 2) return value

  const firstCharacter = value[0]
  const lastCharacter = value[value.length - 1]
  if ((firstCharacter !== '"' && firstCharacter !== "'") || firstCharacter !== lastCharacter) {
    return value
  }

  return value.slice(1, -1).replace(/\\(["'\\])/g, "$1")
}

export const collectEntityTagsFromNbt = (text: string): string[] => {
  const tags = new Set<string>()

  for (const match of text.matchAll(NBT_TAGS_LIST_REGEX)) {
    const matchIndex = match.index ?? -1
    if (matchIndex < 0) continue

    const openBracketIndex = matchIndex + match[0].length - 1
    const closingBracketIndex = findMatchingClosingBracket(text, openBracketIndex)
    if (closingBracketIndex < 0) continue

    const content = text.slice(openBracketIndex + 1, closingBracketIndex)
    for (const entry of splitNbtListEntries(content)) {
      const tagName = unquoteNbtString(entry).trim()
      if (tagName.length > 0) {
        tags.add(tagName)
      }
    }
  }

  return [...tags]
}
