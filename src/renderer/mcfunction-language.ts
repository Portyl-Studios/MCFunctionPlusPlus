import { StreamLanguage } from "@codemirror/language"
import { json as jsonStreamParser } from "@codemirror/legacy-modes/mode/javascript"

type McFunctionStreamState = {
  inNbt: boolean
  nbtDepth: number
  atLineStart: boolean
  jsonState: unknown
}

const createJsonState = () => (jsonStreamParser.startState ? jsonStreamParser.startState(2) : {})

export const mcfunctionLanguage = StreamLanguage.define<McFunctionStreamState>({
  startState() {
    return {
      inNbt: false,
      nbtDepth: 0,
      atLineStart: true,
      jsonState: createJsonState(),
    }
  },
  copyState(state) {
    return {
      inNbt: state.inNbt,
      nbtDepth: state.nbtDepth,
      atLineStart: state.atLineStart,
      jsonState: jsonStreamParser.copyState ? jsonStreamParser.copyState(state.jsonState) : state.jsonState,
    }
  },
  token(stream, state) {
    if (!state.inNbt) {
      if (stream.sol()) state.atLineStart = true
      if (stream.eatSpace()) return null

      if (stream.peek() === "#") {
        stream.skipToEnd()
        return "comment"
      }

      if (stream.peek() === "{") {
        state.inNbt = true
        state.nbtDepth = 0
        state.jsonState = createJsonState()
      } else {
        if (state.atLineStart && stream.match(/\/?[a-z_]+(?::[a-z_]+)?/i)) {
          state.atLineStart = false
          return "keyword"
        }

        state.atLineStart = false

        if (stream.match(/@[a-z](?:\[[^\]]*\])?/i)) return "variable-2"
        if (stream.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/)) return "string"
        if (stream.match(/-?\d+(?:\.\d+)?[bslfd]?/i)) return "number"

        stream.next()
        return null
      }
    }

    const startPos = stream.pos
    const tokenType = jsonStreamParser.token ? jsonStreamParser.token(stream, state.jsonState) : null

    if (stream.pos === startPos) {
      stream.next()
      return tokenType
    }

    const consumed = stream.string.slice(startPos, stream.pos)

    if (tokenType !== "string") {
      for (const character of consumed) {
        if (character === "{") state.nbtDepth += 1
        if (character === "}") state.nbtDepth -= 1
      }
    }

    if (state.nbtDepth <= 0) {
      state.inNbt = false
      state.nbtDepth = 0
      state.atLineStart = false
      state.jsonState = createJsonState()
    }

    return tokenType
  },
})
