import { rebuildCommandIndexes } from "./shared"

export { mcfunctionLanguage } from "./highlighter"
export {
  loadMcfunctionCommandSchema,
  loadMinecraftData,
  mcfunctionCompletionSource,
} from "./autocomplete"
export { mcfunctionDiagnosticSource } from "./diagnostics"
export { mcfunctionLiveLintingSource } from "./live-linting-diagnostics"
export { mcfunctionContextDiagnosticsSource } from "./context-diagnostics"
export {
  mcfunctionContextExtension,
  getMcfunctionContextIndex,
  isMcfunctionContextIndexEqual,
  setWorkspaceResourcePathsFromRelativePaths,
  parseMcfunctionContextIndex,
  mergeMcfunctionContextIndexes,
  setDatapackContextIndex,
  clearDatapackContextIndexes,
  pruneDatapackContextIndexes,
  setActiveDatapackContext,
  getActiveDatapackContextIndex,
  getDatapackContextIndex,
} from "./context"

rebuildCommandIndexes()
