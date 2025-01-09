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

    // A statement can be a function declaration, variable declaration, assignment, or a print statement
    $.RULE("statement", () => {
      $.OR([
        { ALT: () => $.SUBRULE($.functionDeclaration) },
        { ALT: () => $.SUBRULE($.variableDeclaration) },
        { ALT: () => $.SUBRULE($.assignment) },
        { ALT: () => $.SUBRULE($.printStatement) },
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

    // Variable declaration: type name
    $.RULE("variableDeclaration", () => {
      $.CONSUME(Token.NumberType)
      $.CONSUME(Token.Identifier)
    })

    // Assignment: name = expression
    $.RULE("assignment", () => {
      $.CONSUME(Token.Identifier)
      $.CONSUME(Token.Assignment)
      $.SUBRULE($.expression)
    })

    // Print statement: print(expression)
    $.RULE("printStatement", () => {
      $.CONSUME(Token.Print)
      $.CONSUME(Token.OpenParen)
      $.SUBRULE($.expression)
      $.CONSUME(Token.CloseParen)
    })

    // An expression can be a number literal or an identifier
    $.RULE("expression", () => {
      $.OR([
        { ALT: () => $.CONSUME(Token.NumberLiteral) },
        { ALT: () => $.CONSUME(Token.StringLiteral) },
        { ALT: () => $.CONSUME(Token.BooleanLiteral) },
        { ALT: () => $.CONSUME(Token.Identifier) },
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