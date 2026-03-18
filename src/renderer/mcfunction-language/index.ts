import { rebuildCommandIndexes } from "./shared"

export { mcfunctionLanguage } from "./highlighter"
export {
  loadMcfunctionCommandSchema,
  loadMinecraftData,
  mcfunctionCompletionSource,
} from "./autocomplete"
export { mcfunctionDiagnosticSource } from "./diagnostics"
export {
  mcfunctionContextExtension,
  getMcfunctionContextIndex,
  setWorkspaceResourcePathsFromRelativePaths,
  parseMcfunctionContextIndex,
  mergeMcfunctionContextIndexes,
  setDatapackContextIndex,
  clearDatapackContextIndexes,
  setActiveDatapackContext,
  getActiveDatapackContextIndex,
  getDatapackContextIndex,
} from "./context"

rebuildCommandIndexes()
