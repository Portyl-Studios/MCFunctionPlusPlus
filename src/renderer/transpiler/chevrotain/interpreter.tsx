import { tokenMatcher } from "chevrotain"
import * as Token from "./lexer"
import Parser from "./parser"
import ExecutionContext from "./execution-context"
import * as IR from "./intermediate-representation"

const parser = new Parser()
const BaseCstVisitor = parser.getBaseCstVisitorConstructor()

export default class Interpreter extends BaseCstVisitor {

  //#region Intermediate representation

  // The output of the interpreter
  // This will be a series of commands that can be executed in Minecraft
  intermediateRepresentation: any[] = []

  // Add a command to the intermediate representation
  addCommand(command: any) {
    this.intermediateRepresentation.push(command)
  }

  // Compile the intermediate representation into a series of Minecraft commands
  compile() {
    return this.intermediateRepresentation.map(command => command.compile()).join("\n")
  }

  //#endregion

  //#region Function context management

  callStack: any[] = []

  // Enter a new function context
  enterFunction(functionName: any, params: any[]) {
    console.log(`Entering function: ${functionName}`)
    const parentContext = this.callStack[this.callStack.length - 1] // Get the current context (parent context)
    const newContext = new ExecutionContext(functionName, params, parentContext) // Create a new context
    this.callStack.push(newContext) // Push the new context onto the stack
  }

  // Exit the current function context
  exitFunction() {
    console.log(`Exiting function: ${this.currentContext().functionName}`)
    const exitedContext = this.callStack.pop() // Pop the current context
  }

  // Get the current function context (top of the stack)
  currentContext() {
    return this.callStack[this.callStack.length - 1]
  }

  //#endregion

  //#region Scoreboard variable management

  // This tracks the variables that have been declared
  scoreboardVariables: Set<string> = new Set<string>();

  // Check for a global variable only
  hasScoreboardVariable(variableName: any): boolean {
    return this.scoreboardVariables.has(variableName)
  }

  // Add a global variable
  // Make sure it doesn't already exist in a parent context
  addScoreboardVariable(variableName: any) {
    console.log(`addVariable: ${variableName}`)
    if (this.hasScoreboardVariable(variableName)) {
      throw new Error(`Scoreboard variable ${variableName} already exists in the global scope`)
    }
    this.scoreboardVariables.add(variableName)
  }

  //#endregion

  //#region Internal variable management

  // This tracks the variables that have been declared
  internalVariables: Set<string> = new Set<string>();

  // Check for a global variable only
  hasInternalVariable(variableName: any): boolean {
    return this.internalVariables.has(variableName)
  }

  // Add a global variable
  // Make sure it doesn't already exist in a parent context
  addInternalVariable(variableName: any) {
    console.log(`addInternalVariable: ${variableName}`)
    if (this.hasInternalVariable(variableName)) {
      throw new Error(`Internal variable ${variableName} already exists in the global scope`)
    }
    this.internalVariables.add(variableName)
  }

  //#endregion

  //#region Visitor functions

  constructor() {
    super()
    this.validateVisitor()
  }

  // Enter the program context and visit each statement
  program(ctx: any) {
    ctx.statement?.forEach((statement: any) => this.visit(statement))
  }

  statement(ctx: any) {
    this.visit(
      ctx.functionDeclaration ||
      ctx.variableDeclaration ||
      ctx.assignment ||
      ctx.printStatement
    )
  }

  functionDeclaration(ctx: any) {
    console.log("Function Declaration:", ctx.Identifier[0].image)
    this.enterFunction(ctx.Identifier[0].image, [])
    this.visit(ctx.program)
    this.exitFunction()
  }

  variableDeclaration(ctx: any) {
    console.log("Variable Declaration:", ctx.Identifier[0].image)
    const variableName = ctx.Identifier[0].image
    this.addVariable(variableName)
    this.addCommand(new IR.variableDeclaration(variableName))
  }

  assignment(ctx: any) {
    console.log("Assignment:", ctx.Identifier[0].image)
    const variableName = ctx.Identifier[0].image
    
    if (!this.hasVariable(variableName)) {
      throw new Error(`Variable ${variableName} has not been declared in the global scope`)
    }

    const value = this.visit(ctx.expression)

    this.addCommand(new IR.assignment(variableName, value))
  }

  printStatement(ctx: any) {
    console.log("Print Statement:")
    let value = this.visit(ctx.expression)

    console.log("Type:", typeof value)

    if (typeof value === "object" && tokenMatcher(value, Token.Identifier)) {
      this.addCommand(new IR.printStatement({ at: "@a", type: "variable", data: value.image }))
    } else if (typeof value === "string") {
      // remove the extra "" from the string
      value = value.slice(1, -1)
      this.addCommand(new IR.printStatement({ at: "@a", type: "string", data: value }))
    } else if (typeof value === "number" || typeof value === "boolean") {
      this.addCommand(new IR.printStatement({ at: "@a", type: "variable", data: value.toString() }))
    }
  }

  expression(ctx: any) {
    if (ctx.NumberLiteral) {
      console.log("Number Literal:", ctx.NumberLiteral[0].image)
      return parseFloat(ctx.NumberLiteral[0].image)
    } else if (ctx.StringLiteral) {
      console.log("String Literal:", ctx.StringLiteral[0].image)
      return ctx.StringLiteral[0].image
    } else if (ctx.BooleanLiteral) {
      console.log("Boolean Literal:", ctx.BooleanLiteral[0].image)
      return ctx.BooleanLiteral[0].image === "true" ? true : false
    } else if (ctx.Identifier) {
      console.log("Identifier:", ctx.Identifier[0].image)
      const variableName = ctx.Identifier[0].image
      if (this.currentContext()) {
        if (!this.currentContext().hasLocalVariable(variableName)) {
          throw new Error(`Variable ${variableName} has not been declared in the current context: ${this.currentContext().functionName}`)
        }
      } else {
        if (!this.hasGlobalVariable(variableName)) {
          throw new Error(`Variable ${variableName} has not been declared in the global scope`)
        }
      }
      return variableName
    }
  }

  //#endregion

}