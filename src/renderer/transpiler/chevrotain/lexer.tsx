import { createToken, Lexer } from 'chevrotain'

// Whitespace (ignored)
export const Whitespace = createToken({
  name: "Whitespace",
  pattern: /\s+/,
  group: Lexer.SKIPPED,
  line_breaks: true,
})

// Comments (ignored)
export const Comment = createToken({
  name: "Comment",
  pattern: /\/\/[^\n]*/,
  group: Lexer.SKIPPED,
})

// Keywords
export const Keyword = createToken({
  name: "Keyword",
  pattern: Lexer.NA,
})
//export const Struct = createToken({ name: "Struct", pattern: "struct", categories: Keyword })
export const Function = createToken({ name: "Function", pattern: "function", categories: Keyword })
//export const Print = createToken({ name: "Print", pattern: "print", categories: Keyword })

// Types
export const Type = createToken({
  name: "Type",
  pattern: Lexer.NA,
})
//export const NumberType = createToken({ name: "NumberType", pattern: "number", categories: Type })
//export const StringType = createToken({ name: "StringType", pattern: "string", categories: Type })
//export const BooleanType = createToken({ name: "BooleanType", pattern: "boolean", categories: Type })
export const SelectorType = createToken({ name: "SelectorType", pattern: "selector", categories: Type })
export const CoordinateType = createToken({ name: "CoordinateType", pattern: "coordinate", categories: Type })

// Identifiers
export const Identifier = createToken({
  name: "Identifier",
  pattern: /[a-zA-Z_][a-zA-Z0-9_]*/,
})
export const VariableIdentifier = createToken({
  name: "VariableIdentifier",
  pattern: /\$\([a-zA-Z_][a-zA-Z0-9_]*\)/,
})

// Operators
export const Assignment = createToken({ name: "Assignment", pattern: "=" })
export const Comparison = createToken({
  name: "Comparison",
  pattern: Lexer.NA,
})
export const Equal = createToken({ name: "Equal", pattern: "==", categories: Comparison })
export const NotEqual = createToken({ name: "NotEqual", pattern: "!=", categories: Comparison })
export const LessThan = createToken({ name: "LessThan", pattern: "<", categories: Comparison })
export const LessEqual = createToken({ name: "LessEqual", pattern: "<=", categories: Comparison })
export const GreaterThan = createToken({ name: "GreaterThan", pattern: ">", categories: Comparison })
export const GreaterEqual = createToken({ name: "GreaterEqual", pattern: ">=", categories: Comparison })

export const Logical = createToken({
  name: "Logical",
  pattern: Lexer.NA,
})
export const And = createToken({ name: "And", pattern: "&&", categories: Logical })
export const Or = createToken({ name: "Or", pattern: "||", categories: Logical })

export const Arithmetic = createToken({
  name: "Arithmetic",
  pattern: Lexer.NA,
})
export const Add = createToken({ name: "Add", pattern: "+", categories: Arithmetic })
export const Subtract = createToken({ name: "Subtract", pattern: "-", categories: Arithmetic })
export const Multiply = createToken({ name: "Multiply", pattern: "*", categories: Arithmetic })
export const Divide = createToken({ name: "Divide", pattern: "/", categories: Arithmetic })

// Separators
export const OpenParen = createToken({ name: "OpenParen", pattern: "(" })
export const CloseParen = createToken({ name: "CloseParen", pattern: ")" })
export const OpenBrace = createToken({ name: "OpenBrace", pattern: "{" })
export const CloseBrace = createToken({ name: "CloseBrace", pattern: "}" })
export const Comma = createToken({ name: "Comma", pattern: "," })
export const Dot = createToken({ name: "Dot", pattern: "." })

// Literals
export const SelectorLiteral = createToken({
  name: "SelectorLiteral",
  pattern: /@(?:p|a|r|e|s)(?:\[(?:[^\[\]]*)\])?/,
})

export const CoordinateLiteral = createToken({
  name: "CoordinateLiteral",
  pattern: /([~^]?-?\d*\.?\d*\s+[~^]?-?\d*\.?\d*\s+[~^]?-?\d*\.?\d*)/,
})

export const NumberLiteral = createToken({
  name: "NumberLiteral",
  pattern: /[0-9]+(?:\.[0-9]+)?/,
})

export const StringLiteral = createToken({
  name: "StringLiteral",
  pattern: /"([^"\\]|\\.)*"/, // Matches a string literal with escape sequences (like \" or \\)
})

export const BooleanLiteral = createToken({
  name: "BooleanLiteral",
  pattern: /true|false/,
})

// Token order matters keywords must come before identifiers to avoid ambiguity
export const tokens = [
  Whitespace,
  Comment,
  //Struct,
  Function,
  //Print,
  //NumberType,
  //StringType,
  //BooleanType,
  SelectorType,
  CoordinateType,
  Identifier,
  VariableIdentifier,
  Assignment,
  Equal,
  NotEqual,
  LessThan,
  LessEqual,
  GreaterThan,
  GreaterEqual,
  And,
  Or,
  Add,
  Subtract,
  Multiply,
  Divide,
  Comma,
  Dot,
  OpenBrace,
  CloseBrace,
  OpenParen,
  CloseParen,
  SelectorLiteral,
  CoordinateLiteral,
  NumberLiteral,
  StringLiteral,
  BooleanLiteral,
]

export const lexer = new Lexer(tokens)
