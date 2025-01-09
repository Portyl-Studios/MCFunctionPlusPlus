import { CstParser } from "chevrotain"
import * as Token from "./lexer"

export default class Parser extends CstParser {
  constructor() {
    super(Token.tokens)
    const $ = this

    // The root rule for parsing a program
    $.RULE("program", () => {
      $.MANY(() => {
        $.SUBRULE($.statement)
      })
    })

    $.RULE("statement", () => {
      $.OR([
        { ALT: () => $.SUBRULE($.functionDeclaration) },
        { ALT: () => $.SUBRULE($.variableDeclaration) },
      ])
    })

    // Function declaration: function name ( ) { ... }
    $.RULE("functionDeclaration", () => {
      $.CONSUME(Token.Function)
      $.CONSUME(Token.Identifier)
      $.CONSUME(Token.OpenParen)

      // Parameters are optional
      $.OPTION(() => {
        $.CONSUME1(Token.Identifier)
        $.MANY(() => {
          $.CONSUME(Token.Comma)
          $.CONSUME2(Token.Identifier)
        })
      })

      $.CONSUME(Token.CloseParen)
      $.CONSUME(Token.OpenBrace)
      $.SUBRULE($.program)
      $.CONSUME(Token.CloseBrace)
    })

    // Variable declaration: type name() = expression
    $.RULE("variableDeclaration", () => {
      $.CONSUME(Token.SelectorType)
      $.CONSUME(Token.Identifier)
      $.CONSUME(Token.OpenParen)

      // paramters are optional
      $.OPTION(() => {
        $.CONSUME1(Token.Identifier)
        $.MANY(() => {
          $.CONSUME(Token.Comma)
          $.CONSUME2(Token.Identifier)
        })
      })

      $.CONSUME(Token.CloseParen)
      $.CONSUME(Token.Assignment)
      $.SUBRULE($.expression)
    })

    // Assignment: name = expression
    $.RULE("assignment", () => {
      $.CONSUME(Token.Identifier)
      $.CONSUME(Token.Assignment)
      $.SUBRULE($.expression)
    })

    // An expression can be anything that is a literal or an identifier
    $.RULE("expression", () => {
      $.OR([
        { ALT: () => $.CONSUME(Token.SelectorLiteral) },
        { ALT: () => $.CONSUME(Token.CoordinateLiteral) },
        { ALT: () => $.CONSUME(Token.Identifier) },
        { ALT: () => $.CONSUME(Token.VariableIdentifier) },
      ])
    })

    $.performSelfAnalysis()
  }

  // Fix type errors for missing rules.
  program!: any
  statement!: any
  functionDeclaration!: any
  variableDeclaration!: any
  assignment!: any
  printStatement!: any
  expression!: any
}