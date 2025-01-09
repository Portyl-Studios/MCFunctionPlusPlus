export default class ExecutionContext {
  functionName: string
  params: any[]
  parentContext: any
  
  localVariables: Set<string> = new Set<string>()

  constructor(functionName: string, params: any[], parentContext = null) {
    this.functionName = functionName
    this.params = params // Parameters passed to the function
    this.parentContext = parentContext // Reference to the parent context
  }

  // Check if a variable exists in the current or parent contexts
  // If it exists, return the scope in which it was found
  hasLocalVariable(variableName: any): ExecutionContext | null {
    if (this.localVariables.has(variableName)) {
      return this
    }
    if (this.parentContext) {
      return this.parentContext.hasLocalVariable(variableName)
    }
    return null
  }

  // Add a local variable
  // Make sure it doesn't already exist in a parent context
  addLocalVariable(variableName: any, value: any) {
    console.log(`Add local variable: ${variableName}`)
    let result = this.hasLocalVariable(variableName)
    if (result) {
      throw new Error(`Variable ${variableName} already exists in the local scope: ${result.functionName}`)
    }
    this.localVariables.add(variableName)
  }
}
