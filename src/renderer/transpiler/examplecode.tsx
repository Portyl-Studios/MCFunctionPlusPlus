// this is example code for the transpiler

const examplecode =
`
selector any_with_tag(tag) = @e[tag=$(tag)]
//coordinates offset(y) = ~4 ~$(y) ~-2

//execute at offset(2) if entity any_with_tag(npc)
// execute at ~4 ~2 ~-2 if entity @e[tag=npc]
`

import { lexer } from './chevrotain/lexer'
import Parser from './chevrotain/parser'
import Interpreter from './chevrotain/interpreter'

export function testExampleCode() {
  // print each line with line number
  const lines = examplecode.split('\n')

  // calculate padding for line numbers by digit count
  const padding = lines.length.toString().length

  let output = ''
  for (let i = 0; i < lines.length; i++) {
    output += `${(i + 1).toString().padStart(padding, ' ')}: ${lines[i]}\n`
  }
  console.log(output)
  
  // lex the example code
  const lexingResult = lexer.tokenize(examplecode)
  // guard
  if (lexingResult.errors.length > 0) {
    for (const error of lexingResult.errors) {
      console.error("[Lexer]", error.message)
      console.log(error)
    }
    return
  }

  //for (const token of lexingResult.tokens) console.log(token)
  //return

  // parse the example code
  const parser = new Parser()
  parser.input = lexingResult.tokens
  const cst = parser.program()
  // guard
  if (parser.errors.length > 0) {
    for (const error of parser.errors) {
      console.error("[Parser]", error.message)
      console.log(error)
    }
    return
  }

  //console.log("CST Output:", JSON.stringify(cst, null, 2))
  //return

  // interpret the example code
  const interpreter = new Interpreter()
  interpreter.visit(cst)
  console.log(`Interpreter Output\n\n${interpreter.compile()}`)
}