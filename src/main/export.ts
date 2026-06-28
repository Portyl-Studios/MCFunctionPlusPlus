import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import {
  parseDatapackMetadata,
  writeDatapackMetadata,
  createDefaultExportSettings,
  getDatapackMetadataPath,
  type DatapackMetadata,
} from './datapack-parser'
import { isAbsolutePath, isInvalidDirectory, isPathWithinRoot } from './path-validation'
import { withKeyedLock, normalizeLockKey } from './async-lock'
import { incrementPatchVersion } from '../shared/utils'
import {
  applyExportFileNameTemplate,
  sanitizeExportFileName,
  shouldIncludeInExport,
  formatExportDateStamp,
  DEFAULT_EXPORT_DIR_NAME,
  DEFAULT_EXPORT_FILENAME_TEMPLATE,
  type ExportFileNameVariables,
} from '../shared/export-utils'
import { createZipArchive, type ZipEntryInput } from './zip-writer'

export type ExportDatapackResult = {
  outputPath: string
  fileCount: number
  totalBytes: number
  zipBytes: number
  packVersion: string
  versionWarning?: string
}

type ExportHandlerOptions = {
  getMainWindow: () => BrowserWindow | null
  getAllowedRoots: () => string[]
}

// Paths this session has actually exported. export-reveal only opens these, so a
// compromised renderer cannot use it to probe/surface arbitrary .zip files.
const exportedArtifactKeys = new Set<string>()

// Recursively collects the datapack-relative paths that pass the export filter.
const collectExportableFiles = async (
  rootDir: string,
  excludeGlobs: string[],
): Promise<Array<{ absolutePath: string; relativePath: string }>> => {
  const results: Array<{ absolutePath: string; relativePath: string }> = []

  const walk = async (currentDir: string): Promise<void> => {
    const entries = await fs.readdir(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        await walk(absolutePath)
      } else if (entry.isFile()) {
        const relativePath = path.relative(rootDir, absolutePath).replace(/\\/g, '/')
        if (shouldIncludeInExport(relativePath, excludeGlobs)) {
          results.push({ absolutePath, relativePath })
        }
      }
    }
  }

  await walk(rootDir)
  results.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  return results
}

const runExport = async (
  datapackDir: string,
  getAllowedRoots: () => string[],
): Promise<ExportDatapackResult> => {
  // Validate the source against the same allowlist the file-op layer enforces.
  if (!isAbsolutePath(datapackDir)) {
    throw new Error('Invalid datapack directory')
  }
  const allowedRoots = getAllowedRoots()
  if (allowedRoots.length === 0) {
    throw new Error('Export is unavailable until a workspace or datapack is loaded')
  }
  if (!allowedRoots.some((root) => isPathWithinRoot(datapackDir, root))) {
    throw new Error('Export is only allowed within active workspace or datapack directories')
  }

  const metadata = await parseDatapackMetadata(datapackDir)
  if (!metadata) {
    throw new Error('Datapack metadata (.mpp-datapack) could not be read')
  }

  const defaults = createDefaultExportSettings()
  const settings = metadata.export ?? {}
  const fileNameTemplate = settings.fileNameTemplate?.trim() || DEFAULT_EXPORT_FILENAME_TEMPLATE
  const autoIncrementVersion = settings.autoIncrementVersion ?? defaults.autoIncrementVersion ?? true
  const excludeGlobs = Array.isArray(settings.excludeGlobs) ? settings.excludeGlobs : []
  const exportDate = new Date()

  // The artifact carries the CURRENT version; auto-increment bumps the stored
  // version AFTER export so the next export uses the next patch.
  const currentPackVersion = typeof metadata.packVersion === 'string' ? metadata.packVersion : ''
  const releasedVersion = currentPackVersion
  let nextStoredVersion = currentPackVersion
  let versionWarning: string | undefined
  if (autoIncrementVersion) {
    if (!currentPackVersion) {
      versionWarning = 'Pack version is empty, so it could not be auto-incremented for the next export. A same-named export may overwrite this one.'
    } else {
      const incremented = incrementPatchVersion(currentPackVersion)
      if (incremented === currentPackVersion) {
        versionWarning = `Pack version "${currentPackVersion}" is not in major.minor.patch form, so it could not be auto-incremented for the next export. A same-named export may overwrite this one.`
      }
      nextStoredVersion = incremented
    }
  }

  // Gather and read the files to pack.
  const files = await collectExportableFiles(datapackDir, excludeGlobs)
  if (files.length === 0) {
    throw new Error('Nothing to export: no pack.mcmeta, pack.png, or data/ files were found.')
  }
  // A datapack with no pack.mcmeta (e.g. disabled, or excluded by a glob) is
  // unloadable by Minecraft. Fail loudly instead of shipping a broken artifact.
  if (!files.some((file) => file.relativePath === 'pack.mcmeta')) {
    throw new Error('Cannot export: pack.mcmeta is missing. The datapack may be disabled (pack.mcmeta.disabled) or excluded by an exclude pattern — enable it and clear that pattern before exporting.')
  }

  const zipEntries: ZipEntryInput[] = []
  let totalBytes = 0
  for (const file of files) {
    const data = await fs.readFile(file.absolutePath)
    totalBytes += data.length
    zipEntries.push({ path: file.relativePath, data })
  }

  const zipBuffer = createZipArchive(zipEntries, exportDate)

  // Resolve output directory (default ~/dist) and the templated filename. Only
  // honor a configured directory when it is a valid absolute path (the
  // isInvalidDirectory check rejects null bytes, reserved device names, and bad
  // segments); otherwise fall back to the default.
  const configuredOutputDir = settings.outputDir?.trim()
  const outputDir = configuredOutputDir && !isInvalidDirectory(configuredOutputDir)
    ? configuredOutputDir
    : path.join(os.homedir(), DEFAULT_EXPORT_DIR_NAME)
  await fs.mkdir(outputDir, { recursive: true })

  const variables: ExportFileNameVariables = {
    projectName: metadata.name || path.basename(datapackDir),
    mcVersion: metadata.minecraftVersion ?? '',
    packVersion: releasedVersion,
    datapackId: metadata.id ?? '',
    author: metadata.author ?? '',
    packFormat: metadata.packFormatVersionMax != null ? String(metadata.packFormatVersionMax) : '',
    date: formatExportDateStamp(exportDate),
  }
  const fileName = sanitizeExportFileName(applyExportFileNameTemplate(fileNameTemplate, variables))
  const outputPath = path.join(outputDir, fileName)

  await fs.writeFile(outputPath, zipBuffer)
  exportedArtifactKeys.add(normalizeLockKey(outputPath))

  // Persist the incremented version and last-export bookkeeping. Serialize on the
  // metadata-file key and re-read the latest record inside the lock so this update
  // merges onto any concurrent inspector edit instead of clobbering it. A failure
  // here must not fail the export — the artifact is already on disk.
  try {
    await withKeyedLock(normalizeLockKey(getDatapackMetadataPath(datapackDir)), async () => {
      const latest = (await parseDatapackMetadata(datapackDir)) ?? metadata
      const nextMetadata: DatapackMetadata = {
        ...latest,
        packVersion: nextStoredVersion,
        export: {
          ...defaults,
          ...latest.export,
          lastExportedAt: exportDate.toISOString(),
          lastExportPath: outputPath,
        },
      }
      await writeDatapackMetadata(datapackDir, nextMetadata)
    })
  } catch (error) {
    console.warn('Export succeeded but failed to persist datapack metadata:', error)
  }

  return {
    outputPath,
    fileCount: files.length,
    totalBytes,
    zipBytes: zipBuffer.length,
    packVersion: releasedVersion,
    versionWarning,
  }
}

export const registerExportHandlers = (options: ExportHandlerOptions): void => {
  const { getMainWindow, getAllowedRoots } = options

  ipcMain.handle('pick-export-folder', async () => {
    const mainWindow = getMainWindow()
    if (!mainWindow) throw new Error('No main window')

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  ipcMain.handle('export-datapack', async (_event, { datapackDir }): Promise<ExportDatapackResult> => {
    if (!isAbsolutePath(datapackDir)) {
      throw new Error('Invalid datapack directory')
    }
    // Serialize exports per datapack so rapid re-clicks (or the menu + tree + panel
    // entry points) cannot run concurrent read-modify-write cycles on the version.
    return await withKeyedLock(`export:${normalizeLockKey(datapackDir)}`, () => runExport(datapackDir, getAllowedRoots))
  })

  // Reveal-only handler. The export folder is intentionally outside the file-op
  // allowlist, so this restricts reveals to artifacts this session actually wrote.
  ipcMain.handle('export-reveal', async (_event, { filePath }) => {
    if (!isAbsolutePath(filePath)) {
      throw new Error('Invalid file path')
    }
    if (!exportedArtifactKeys.has(normalizeLockKey(filePath))) {
      throw new Error('Reveal is only allowed for datapacks exported in this session')
    }
    try {
      const stats = await fs.stat(filePath)
      if (!stats.isFile()) {
        throw new Error('Export path is not a file')
      }
    } catch {
      throw new Error('Exported file no longer exists')
    }
    shell.showItemInFolder(filePath)
  })
}
