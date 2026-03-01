import { createFileKey } from "../utils"
import { computeDiagnosticSummaryForContent, detectEditorLanguage, type DiagnosticSummary } from "../language-handler"

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
    shouldCancel,
  } = options

  const nextSummaries: Record<string, DiagnosticSummary> = {}

  for (const datapack of datapacks) {
    for (const relativePathRaw of datapack.paths) {
      if (shouldCancel?.()) return null

      const relativePath = normalizeRelativePath(relativePathRaw)
      if (!relativePath || relativePath.endsWith("/")) continue

      const language = detectEditorLanguage(relativePath)
      if (!language.supportsDiagnostics) continue

      const fileKey = createFileKey(datapack.dir, relativePath)

      let content: string | null = null
      const openedFile = openedFiles.find((file) =>
        createFileKey(file.datapackDir, file.relativePath) === fileKey,
      )

      if (openedFile && modifiedFileKeys.has(fileKey)) {
        content = openedFile.content
      } else {
        try {
          content = await readFile(datapack.dir, relativePath)
        } catch {
          continue
        }
      }

      if (shouldCancel?.()) return null
      if (content === null) continue

      const summary = computeDiagnosticSummaryForContent(language.id, content)
      if (summary.errors > 0 || summary.warnings > 0) {
        nextSummaries[fileKey] = summary
      }
    }
  }

  return nextSummaries
}
