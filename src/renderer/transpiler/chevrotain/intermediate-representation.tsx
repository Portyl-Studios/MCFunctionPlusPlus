// this maps mcfunction commands to their intermediate representation

class ICommand {
  commandType: string = "undefined"
  compile() {
    return ""
  }
  constructor(commandType: string) {
    this.commandType = commandType
  }
}

export class functionDeclaration extends ICommand {
  functionName: string
  params: string[]
  body: ICommand[]

  constructor(functionName: string, params: string[], body: ICommand[]) {
    super("functionDeclaration")
    this.functionName = functionName
    this.params = params
    this.body = body
  }
}

export class functionCall extends ICommand {
  functionName: string
  params: any[]

  constructor(functionName: string, params: any[]) {
    super("functionCall")
    this.functionName = functionName
    this.params = params
  }
}

export class variableDeclaration extends ICommand {
  variableName: string

  constructor(variableName: string) {
    super("variableDeclaration")
    this.variableName = variableName
  }

  compile() {
    return `scoreboard players set ${this.variableName} variables 0`
  }
}

export class assignment extends ICommand {
  variableName: string
  value: any
  
  constructor(variableName: string, value: any) {
    super("assignment")
    this.variableName = variableName
    this.value = value
  }

  compile() {
    return `scoreboard players set ${this.variableName} variables ${this.value}`
  }
}

// print statement formatting
// tellraw @a {"text":"<value>"}
// tellraw @a {"text":"<value>", "color":"<color>", "bold":<bold>, "italic":<italic>, "underlined":<underlined>, "strikethrough":<strikethrough>, "obfuscated":<obfuscated>}
// tellraw @a ["", {"text":"<value>", "color":"<color>", "bold":<bold>, "italic":<italic>, "underlined":<underlined>, "strikethrough":<strikethrough>, "obfuscated":<obfuscated>}]
export class printStatement extends ICommand {
  at: string = "@a"
  type?: string = undefined
  data?: string = undefined
  color: string = "white"
  bold: boolean = false
  italic: boolean = false
  underlined: boolean = false
  strikethrough: boolean = false
  obfuscated: boolean = false

  constructor(
    { at, type, data, color, bold, italic, underlined, strikethrough, obfuscated }: Partial<printStatement> = {}
  ) {
    super("printStatement")
    Object.assign(this, { at, type, data, color, bold, italic, underlined, strikethrough, obfuscated })
  }

  compile() {
    let out = `tellraw ${this.at} `

    if (this.type === "string") {
      out += `{"text":"${this.data}"`
    } else if (this.type === "variable") {
      out += `{"score":{"name":"${this.data}","objective":"variables"}`
    } else {
      throw new Error(`Invalid printStatement type: ${this.type}`)
    }

    if (this.color) {
      out += `, "color":"${this.color}"`
    }
    if (this.bold) {
      out += `, "bold":${this.bold}`
    }
    if (this.italic) {
      out += `, "italic":${this.italic}`
    }
    if (this.underlined) {
      out += `, "underlined":${this.underlined}`
    }
    if (this.strikethrough) {
      out += `, "strikethrough":${this.strikethrough}`
    }
    if (this.obfuscated) {
      out += `, "obfuscated":${this.obfuscated}`
    }

    out += "}"

    return out
  }
}