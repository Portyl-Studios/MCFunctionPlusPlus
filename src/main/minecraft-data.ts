import type { IpcMain } from 'electron'
import { spawn } from 'child_process'
import { createWriteStream, promises as fs } from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { readFile } from './fileops'
import { compareDottedVersions, isDottedNumericVersion } from '../shared/utils'

const MINECRAFT_DATA_CACHE_DIR = 'Minecraft Data Cache'
const MOJANG_VERSION_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const ENSURE_FAILURE_COOLDOWN_MS = 8000
const LEGACY_REPORTS_MAX_VERSION = '1.21.11'

const cacheRequiredFiles = [
  'blocks.json',
  'commands.json',
  'datapack.json',
  'items.json',
  'json-rpc-api-schema.json',
  'packets.json',
  'registries.json',
]

type MinecraftDataManifest = {
  versions?: Array<{
    id?: string
    url?: string
  }>
}

type MinecraftVersionInfo = {
  downloads?: {
    server?: {
      url?: string
    }
  }
}

export type MinecraftVersionEntry = {
  id: string
  type?: string
  releaseTime?: string
  url?: string
}

type MinecraftDataManagerOptions = {
  userDataPath: string
}

type JavaRuntimeInfo = {
  found: boolean
  major: number | null
  output: string
}

type ReportsParserContext = {
  version: string
  reportsPath: string
  cachePath: string
}

type ReportsParserStrategy = {
  name: string
  supports: (version: string) => boolean
  prepareCacheFromReports: (context: ReportsParserContext) => Promise<void>
}

type MinecraftDataEnsureProgress = {
  stage: string
  percent: number
  message: string
}

type MinecraftDataEnsureReporter = (progress: MinecraftDataEnsureProgress) => void

type EnsureOperation = {
  version: string
  cancelled: boolean
  controller: AbortController
  child: ReturnType<typeof spawn> | null
  tempRoot: string | null
}

class MinecraftDataCancelledError extends Error {
  constructor(version: string) {
    super(`Minecraft data preparation cancelled for ${version}`)
    this.name = 'MinecraftDataCancelledError'
  }
}

const ensureInFlightByVersion = new Map<string, Promise<string>>()
const ensureFailureByVersion = new Map<string, { message: string; expiresAt: number }>()
const ensureOperationByVersion = new Map<string, EnsureOperation>()

const throwIfCancelled = (operation: EnsureOperation): void => {
  if (operation.cancelled) {
    throw new MinecraftDataCancelledError(operation.version)
  }
}

const cancelEnsureOperation = async (operation: EnsureOperation): Promise<void> => {
  operation.cancelled = true
  operation.controller.abort()

  if (operation.child && !operation.child.killed) {
    try {
      operation.child.kill('SIGTERM')
    } catch {
      // Best-effort cancellation.
    }
  }

  if (operation.tempRoot) {
    try {
      await fs.rm(operation.tempRoot, { recursive: true, force: true })
    } catch {
      // Best-effort cleanup.
    }
  }
}

const reportEnsureProgress = (
  reporter: MinecraftDataEnsureReporter | undefined,
  stage: string,
  percent: number,
  message: string,
): void => {
  if (!reporter) return
  const normalizedPercent = Math.max(0, Math.min(100, Math.round(percent)))
  reporter({ stage, percent: normalizedPercent, message })
}

const isValidVersion = (version: string): boolean => isDottedNumericVersion(version)

const getCachedVersionPath = (userDataPath: string, version: string): string => {
  return path.join(userDataPath, MINECRAFT_DATA_CACHE_DIR, version)
}

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

const hasRequiredFiles = async (versionPath: string): Promise<boolean> => {
  for (const fileName of cacheRequiredFiles) {
    if (!(await pathExists(path.join(versionPath, fileName)))) {
      return false
    }
  }

  return true
}

const copyDirectory = async (sourcePath: string, targetPath: string): Promise<void> => {
  await fs.rm(targetPath, { recursive: true, force: true })
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  await fs.cp(sourcePath, targetPath, { recursive: true, force: true })
}

const copyDirectoryIfPresent = async (sourcePath: string, targetPath: string): Promise<boolean> => {
  if (!(await pathExists(sourcePath))) {
    return false
  }

  await copyDirectory(sourcePath, targetPath)
  return true
}

const copyFileIfPresent = async (sourcePath: string, targetPath: string): Promise<boolean> => {
  if (!(await pathExists(sourcePath))) {
    return false
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  await fs.copyFile(sourcePath, targetPath)
  return true
}

const toMinecraftNamespacedId = (id: string): string => {
  if (id.includes(':')) return id
  return `minecraft:${id}`
}

const collectJsonEntriesFromDirectory = async (directoryPath: string): Promise<Array<[string, unknown]>> => {
  const collectedEntries: Array<[string, unknown]> = []

  const walk = async (currentPath: string, relativePrefix: string): Promise<void> => {
    const directoryEntries = await fs.readdir(currentPath, { withFileTypes: true })
    for (const entry of directoryEntries) {
      const absolutePath = path.join(currentPath, entry.name)
      const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath)
        continue
      }

      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) {
        continue
      }

      const id = relativePath.replace(/\\/g, '/').replace(/\.json$/i, '')
      if (!id) continue

      const raw = await fs.readFile(absolutePath, 'utf-8')
      collectedEntries.push([toMinecraftNamespacedId(id), JSON.parse(raw) as unknown])
    }
  }

  if (!(await pathExists(directoryPath))) {
    return []
  }

  await walk(directoryPath, '')
  return collectedEntries.sort(([left], [right]) => left.localeCompare(right))
}

const writeIndexedObjectFile = async (targetPath: string, ids: Array<[string, unknown]>): Promise<void> => {
  const payload = Object.fromEntries(ids)
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  await fs.writeFile(targetPath, JSON.stringify(payload, null, 2), 'utf-8')
}

const buildItemsFileFromModernReports = async (reportsPath: string, cachePath: string): Promise<boolean> => {
  const directCopy = await copyFileIfPresent(path.join(reportsPath, 'items.json'), path.join(cachePath, 'items.json'))
  if (directCopy) return true

  const candidateDirectories = [
    path.join(reportsPath, 'minecraft', 'components', 'item'),
    path.join(reportsPath, 'minecraft', 'items'),
  ]

  for (const directoryPath of candidateDirectories) {
    const ids = await collectJsonEntriesFromDirectory(directoryPath)
    if (ids.length === 0) continue
    await writeIndexedObjectFile(path.join(cachePath, 'items.json'), ids)
    return true
  }

  return false
}

const legacyReportsParserStrategy: ReportsParserStrategy = {
  name: 'legacy-reports-parser',
  supports: (version: string) => compareDottedVersions(version, LEGACY_REPORTS_MAX_VERSION) <= 0,
  prepareCacheFromReports: async ({ reportsPath, cachePath }) => {
    await copyDirectory(reportsPath, cachePath)
  },
}

const modernReportsParserStrategy: ReportsParserStrategy = {
  name: 'modern-reports-parser',
  supports: (version: string) => compareDottedVersions(version, LEGACY_REPORTS_MAX_VERSION) > 0,
  prepareCacheFromReports: async ({ reportsPath, cachePath }) => {
    await fs.rm(cachePath, { recursive: true, force: true })
    await fs.mkdir(cachePath, { recursive: true })

    const requiredRootFiles = [
      'blocks.json',
      'commands.json',
      'datapack.json',
      'json-rpc-api-schema.json',
      'packets.json',
      'registries.json',
    ]

    for (const fileName of requiredRootFiles) {
      const copied = await copyFileIfPresent(path.join(reportsPath, fileName), path.join(cachePath, fileName))
      if (!copied) {
        throw new Error(`Missing required report file: ${fileName}`)
      }
    }

    await copyDirectoryIfPresent(path.join(reportsPath, 'biome_parameters'), path.join(cachePath, 'biome_parameters'))

    const itemsBuilt = await buildItemsFileFromModernReports(reportsPath, cachePath)
    if (!itemsBuilt) {
      throw new Error('Unable to build items.json from modern report output')
    }
  },
}

const reportsParserStrategies: ReportsParserStrategy[] = [
  modernReportsParserStrategy,
  legacyReportsParserStrategy,
]

const getReportsParserStrategy = (version: string): ReportsParserStrategy => {
  const strategy = reportsParserStrategies.find((candidate) => candidate.supports(version))
  if (!strategy) {
    // Safe fallback so unsupported versions still attempt legacy behavior.
    return legacyReportsParserStrategy
  }

  return strategy
}

export const resolveLatestMinecraftReleaseVersion = async (): Promise<string | null> => {
  const versions = await fetchAvailableVersions()
  const latestRelease = versions.find((entry) => entry.type === 'release')
  return latestRelease?.id ?? versions[0]?.id ?? null
}

const parseJavaMajorVersion = (rawOutput: string): number | null => {
  const versionQuotedMatch = rawOutput.match(/version\s+"([^"]+)"/i)
  const versionToken = versionQuotedMatch?.[1]
  if (versionToken) {
    const parts = versionToken.split('.')
    if (parts[0] === '1' && parts.length > 1) {
      const legacyMajor = Number.parseInt(parts[1], 10)
      return Number.isFinite(legacyMajor) ? legacyMajor : null
    }

    const modernMajor = Number.parseInt(parts[0], 10)
    if (Number.isFinite(modernMajor)) {
      return modernMajor
    }
  }

  const genericMatch = rawOutput.match(/\b(?:openjdk|java)\s+(\d+)(?:\.\d+)*/i)
  if (!genericMatch) return null

  const genericMajor = Number.parseInt(genericMatch[1], 10)
  return Number.isFinite(genericMajor) ? genericMajor : null
}

const getJavaRuntimeInfo = async (): Promise<JavaRuntimeInfo> => {
  return await new Promise<JavaRuntimeInfo>((resolve) => {
    const child = spawn('java', ['-version'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let output = ''

    child.stdout.on('data', (chunk) => {
      output += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      output += chunk.toString()
    })

    child.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        resolve({
          found: false,
          major: null,
          output: 'java executable was not found in PATH',
        })
        return
      }

      resolve({
        found: false,
        major: null,
        output: error.message,
      })
    })

    child.on('close', () => {
      const major = parseJavaMajorVersion(output)
      resolve({
        found: true,
        major,
        output: output.trim(),
      })
    })
  })
}

const classFileVersionToJavaMajor = (classFileVersion: number): number => {
  return classFileVersion - 44
}

const formatJavaRuntimeError = (error: unknown, version: string, javaRuntime: JavaRuntimeInfo): Error => {
  if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
    return new Error(
      `Java was not found in PATH while preparing Minecraft ${version}. Install Java and add it to PATH, then retry.`
    )
  }

  const rawMessage = error instanceof Error ? error.message : String(error)

  const classVersionMatch = rawMessage.match(/class file version\s+(\d+(?:\.\d+)?)/i)
  const recognizedMatch = rawMessage.match(/recognizes class file versions up to\s+(\d+(?:\.\d+)?)/i)
  if (classVersionMatch || recognizedMatch || /UnsupportedClassVersionError/i.test(rawMessage)) {
    const requiredClassFile = classVersionMatch ? Number.parseFloat(classVersionMatch[1]) : null
    const maxClassFile = recognizedMatch ? Number.parseFloat(recognizedMatch[1]) : null
    const requiredJava = requiredClassFile !== null ? classFileVersionToJavaMajor(Math.floor(requiredClassFile)) : null
    const supportedJava = maxClassFile !== null ? classFileVersionToJavaMajor(Math.floor(maxClassFile)) : null
    const detectedJava = javaRuntime.major

    const details = [
      `Minecraft ${version} requires a newer Java runtime.`,
      requiredJava ? `Required Java: ${requiredJava}+.` : null,
      supportedJava ? `Current runtime supports up to Java ${supportedJava}.` : null,
      detectedJava ? `Detected Java: ${detectedJava}.` : null,
      'Install a newer Java version and retry.',
    ].filter(Boolean).join(' ')

    return new Error(details)
  }

  return new Error(rawMessage)
}

const downloadToFile = async (url: string, targetPath: string, operation: EnsureOperation): Promise<void> => {
  throwIfCancelled(operation)
  const response = await fetch(url, { signal: operation.controller.signal })
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download Minecraft data from ${url}`)
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  const writeStream = createWriteStream(targetPath)
  await pipeline(Readable.fromWeb(response.body as never), writeStream)
  throwIfCancelled(operation)
}

const runJavaReports = async (jarPath: string, workingDirectory: string, operation: EnsureOperation): Promise<void> => {
  throwIfCancelled(operation)
  await new Promise<void>((resolve, reject) => {
    const child = spawn('java', ['-DbundlerMainClass=net.minecraft.data.Main', '-jar', jarPath, '--reports'], {
      cwd: workingDirectory,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    operation.child = child

    let stderr = ''

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
      if (stderr.length > 4000) {
        stderr = stderr.slice(-4000)
      }
    })

    child.on('error', reject)
    child.on('close', (exitCode) => {
      operation.child = null
      if (operation.cancelled) {
        reject(new MinecraftDataCancelledError(operation.version))
        return
      }
      if (exitCode === 0) {
        resolve()
        return
      }

      reject(new Error(stderr.trim() || `Java exited with code ${exitCode ?? 'unknown'}`))
    })
  })
}

const fetchManifest = async (operation?: EnsureOperation): Promise<MinecraftDataManifest> => {
  const response = await fetch(
    MOJANG_VERSION_MANIFEST_URL,
    operation ? { signal: operation.controller.signal } : undefined,
  )
  if (!response.ok) {
    throw new Error(`Failed to fetch Minecraft version manifest (${response.status})`)
  }

  return await response.json() as MinecraftDataManifest
}

const fetchVersionInfo = async (versionUrl: string, operation: EnsureOperation): Promise<MinecraftVersionInfo> => {
  throwIfCancelled(operation)
  const response = await fetch(versionUrl, { signal: operation.controller.signal })
  if (!response.ok) {
    throw new Error(`Failed to fetch Minecraft version metadata (${response.status})`)
  }

  return await response.json() as MinecraftVersionInfo
}

const fetchAvailableVersions = async (): Promise<MinecraftVersionEntry[]> => {
  const manifest = await fetchManifest()
  const versions = (manifest.versions ?? [])
    .filter((entry): entry is { id: string; type?: string; releaseTime?: string; url?: string } => typeof entry.id === 'string' && entry.id.trim().length > 0)
    .map((entry) => ({
      id: entry.id.trim(),
      type: typeof entry.type === 'string' ? entry.type : undefined,
      releaseTime: typeof entry.releaseTime === 'string' ? entry.releaseTime : undefined,
      url: typeof entry.url === 'string' ? entry.url : undefined,
    }))

  versions.sort((left, right) => {
    const leftTime = left.releaseTime ? Date.parse(left.releaseTime) : 0
    const rightTime = right.releaseTime ? Date.parse(right.releaseTime) : 0
    return rightTime - leftTime
  })

  return versions
}

const ensureMinecraftDataInternal = async (
  version: string,
  options: MinecraftDataManagerOptions,
  operation: EnsureOperation,
  reporter?: MinecraftDataEnsureReporter,
): Promise<string> => {
  const normalizedVersion = version.trim()
  throwIfCancelled(operation)
  if (!isValidVersion(normalizedVersion)) {
    throw new Error('Invalid Minecraft version')
  }

  reportEnsureProgress(reporter, 'cache-check', 5, `Checking local cache for Minecraft ${normalizedVersion}...`)
  const cachedVersionPath = getCachedVersionPath(options.userDataPath, normalizedVersion)
  if (await hasRequiredFiles(cachedVersionPath)) {
    reportEnsureProgress(reporter, 'cache-hit', 100, `Minecraft ${normalizedVersion} is already cached.`)
    return cachedVersionPath
  }

  const tempRoot = path.join(options.userDataPath, MINECRAFT_DATA_CACHE_DIR, '.downloads', normalizedVersion)
  const jarPath = path.join(tempRoot, 'server.jar')
  operation.tempRoot = tempRoot
  reportEnsureProgress(reporter, 'java-check', 10, 'Validating Java runtime...')
  const javaRuntime = await getJavaRuntimeInfo()
  throwIfCancelled(operation)
  if (!javaRuntime.found) {
    throw new Error(
      `Java was not found in PATH while preparing Minecraft ${normalizedVersion}. Install Java and add it to PATH, then retry.`
    )
  }

  reportEnsureProgress(reporter, 'prepare-temp', 15, 'Preparing download workspace...')
  await fs.rm(tempRoot, { recursive: true, force: true })
  await fs.mkdir(tempRoot, { recursive: true })

  try {
    throwIfCancelled(operation)
    reportEnsureProgress(reporter, 'manifest', 25, 'Fetching official Minecraft version manifest...')
    const manifest = await fetchManifest(operation)
    const versionEntry = manifest.versions?.find((entry) => entry.id === normalizedVersion)
    if (!versionEntry?.url) {
      throw new Error(`Minecraft version ${normalizedVersion} was not found in the official manifest`)
    }

    reportEnsureProgress(reporter, 'version-metadata', 35, `Fetching metadata for Minecraft ${normalizedVersion}...`)
    const versionInfo = await fetchVersionInfo(versionEntry.url, operation)
    const serverUrl = versionInfo.downloads?.server?.url
    if (!serverUrl) {
      throw new Error(`Minecraft version ${normalizedVersion} does not expose a server download`)
    }

    reportEnsureProgress(reporter, 'server-download', 50, `Downloading server data for Minecraft ${normalizedVersion}...`)
    await downloadToFile(serverUrl, jarPath, operation)
    reportEnsureProgress(reporter, 'server-download-complete', 65, 'Server download complete. Generating reports...')
    try {
      await runJavaReports(jarPath, tempRoot, operation)
    } catch (error) {
      if (error instanceof MinecraftDataCancelledError) {
        throw error
      }
      throw formatJavaRuntimeError(error, normalizedVersion, javaRuntime)
    }

    const generatedReportsPath = path.join(tempRoot, 'generated', 'reports')
    const parserStrategy = getReportsParserStrategy(normalizedVersion)
    reportEnsureProgress(reporter, 'cache-prepare', 82, `Building cache using ${parserStrategy.name}...`)
    try {
      throwIfCancelled(operation)
      await parserStrategy.prepareCacheFromReports({
        version: normalizedVersion,
        reportsPath: generatedReportsPath,
        cachePath: cachedVersionPath,
      })
    } catch (error) {
      throw new Error(
        `Minecraft reports for ${normalizedVersion} were not generated correctly (${parserStrategy.name}): ${error instanceof Error ? error.message : 'Unknown parser error'}`
      )
    }

    if (!(await hasRequiredFiles(cachedVersionPath))) {
      throw new Error(`Minecraft reports for ${normalizedVersion} were not generated correctly (${parserStrategy.name})`)
    }

    reportEnsureProgress(reporter, 'cache-ready', 100, `Minecraft ${normalizedVersion} cache is ready.`)
    return cachedVersionPath
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true })
    operation.tempRoot = null
  }
}

const ensureMinecraftData = async (
  version: string,
  options: MinecraftDataManagerOptions,
  reporter?: MinecraftDataEnsureReporter,
): Promise<string> => {
  const normalizedVersion = version.trim()
  const previousFailure = ensureFailureByVersion.get(normalizedVersion)
  if (previousFailure && previousFailure.expiresAt > Date.now()) {
    throw new Error(previousFailure.message)
  }

  if (previousFailure && previousFailure.expiresAt <= Date.now()) {
    ensureFailureByVersion.delete(normalizedVersion)
  }

  const inFlight = ensureInFlightByVersion.get(normalizedVersion)
  if (inFlight) {
    reportEnsureProgress(reporter, 'in-flight', 20, `Reusing in-progress cache preparation for Minecraft ${normalizedVersion}...`)
    return await inFlight
  }

  const operation: EnsureOperation = {
    version: normalizedVersion,
    cancelled: false,
    controller: new AbortController(),
    child: null,
    tempRoot: null,
  }
  ensureOperationByVersion.set(normalizedVersion, operation)

  const pendingPromise = ensureMinecraftDataInternal(normalizedVersion, options, operation, reporter)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      if (error instanceof MinecraftDataCancelledError) {
        throw error
      }
      ensureFailureByVersion.set(normalizedVersion, {
        message,
        expiresAt: Date.now() + ENSURE_FAILURE_COOLDOWN_MS,
      })
      throw new Error(message)
    })
    .finally(() => {
      ensureInFlightByVersion.delete(normalizedVersion)
      ensureOperationByVersion.delete(normalizedVersion)
    })

  ensureInFlightByVersion.set(normalizedVersion, pendingPromise)
  return await pendingPromise
}

export const registerMinecraftDataHandlers = (
  ipc: IpcMain,
  options: MinecraftDataManagerOptions,
): void => {
  ipc.handle('minecraft-versions-list', async () => {
    return await fetchAvailableVersions()
  })

  ipc.handle('minecraft-data-ensure', async (_event, { version }) => {
    if (!version || typeof version !== 'string') {
      throw new Error('Invalid Minecraft data version')
    }

    await ensureMinecraftData(version, options, (progress) => {
      _event.sender.send('minecraft-data-ensure-progress', {
        version: version.trim(),
        ...progress,
      })
    })
    return true
  })

  ipc.handle('minecraft-data-cancel', async (_event, { version }) => {
    if (version !== undefined && typeof version !== 'string') {
      throw new Error('Invalid Minecraft data version')
    }

    const normalizedVersion = typeof version === 'string' ? version.trim() : ''
    if (normalizedVersion) {
      const operation = ensureOperationByVersion.get(normalizedVersion)
      if (!operation) return false
      await cancelEnsureOperation(operation)
      return true
    }

    const operations = Array.from(ensureOperationByVersion.values())
    await Promise.all(operations.map((operation) => cancelEnsureOperation(operation)))
    return operations.length > 0
  })

  ipc.handle('command-schema-get', async (_event, { version }) => {
    if (!version || typeof version !== 'string') {
      throw new Error('Invalid command schema version')
    }

    const versionPath = await ensureMinecraftData(version, options)
    const schemaPath = path.join(versionPath, 'commands.json')
    return await readFile(schemaPath)
  })

  ipc.handle('minecraft-data-get', async (_event, { version, dataType }) => {
    if (!version || typeof version !== 'string') {
      throw new Error('Invalid Minecraft data version')
    }

    if (!dataType || typeof dataType !== 'string') {
      throw new Error('Invalid data type')
    }

    const normalizedDataType = dataType.trim()
    if (!/^[a-z_]+$/.test(normalizedDataType)) {
      throw new Error('Invalid data type format')
    }

    const versionPath = await ensureMinecraftData(version, options)
    const dataPath = path.join(versionPath, `${normalizedDataType}.json`)
    return await readFile(dataPath)
  })
}