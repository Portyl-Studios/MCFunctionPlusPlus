import { createFileKey } from "../utils"
import { computeDiagnosticSummaryForContent, detectEditorLanguage, type DiagnosticSummary } from "../language-handler"
import { getDatapackContextIndex } from "../mcfunction-language"

type DiagnosticsDatapack = {
  dir: string
  paths: string[]
}

type DiagnosticsOpenedFile = {
  datapackDir: string
  relativePath: string
  content: string
}

type RunGlobalDiagnosticsScanOptions = {
  datapacks: readonly DiagnosticsDatapack[]
  openedFiles: readonly DiagnosticsOpenedFile[]
  modifiedFileKeys: ReadonlySet<string>
  readFile: (datapackDir: string, relativePath: string) => Promise<string>
  targetDatapackDir?: string
  shouldCancel?: () => boolean
}

const normalizeRelativePath = (relativePathRaw: string) =>
  relativePathRaw.replace(/\\/g, "/").replace(/^\/+/, "")

export const runGlobalDiagnosticsScan = async (
  options: RunGlobalDiagnosticsScanOptions,
): Promise<Record<string, DiagnosticSummary> | null> => {
  const {
    datapacks,
    openedFiles,
    modifiedFileKeys,
    readFile,
    targetDatapackDir,
    shouldCancel,
  } = options

  const nextSummaries: Record<string, DiagnosticSummary> = {}
  const datapacksToScan = targetDatapackDir
    ? datapacks.filter(datapack => datapack.dir === targetDatapackDir)
    : datapacks
  const openedModifiedContentByFileKey = new Map<string, string>()

  for (const openedFile of openedFiles) {
    const fileKey = createFileKey(openedFile.datapackDir, openedFile.relativePath)
    if (!modifiedFileKeys.has(fileKey)) continue
    openedModifiedContentByFileKey.set(fileKey, openedFile.content)
  }

  for (const datapack of datapacksToScan) {
    for (const relativePathRaw of datapack.paths) {
      if (shouldCancel?.()) return null

      const relativePath = normalizeRelativePath(relativePathRaw)
      if (!relativePath || relativePath.endsWith("/")) continue

      const language = detectEditorLanguage(relativePath)
      if (!language.supportsDiagnostics) continue

      const fileKey = createFileKey(datapack.dir, relativePath)

      let content: string | null = null
      const openedModifiedContent = openedModifiedContentByFileKey.get(fileKey)

      if (openedModifiedContent !== undefined) {
        content = openedModifiedContent
      } else {
        try {
          content = await readFile(datapack.dir, relativePath)
        } catch {
          continue
        }
      }

      if (shouldCancel?.()) return null
      if (content === null) continue

      const summary = computeDiagnosticSummaryForContent(language.id, content, {
        mcfunctionContextIndex: language.id === "mcfunction"
          ? getDatapackContextIndex(datapack.dir)
          : undefined,
      })
      if (summary.errors > 0 || summary.warnings > 0) {
        nextSummaries[fileKey] = summary
      }
    }
  }

  return nextSummaries
}
