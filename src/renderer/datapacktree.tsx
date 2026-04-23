import React from 'react'
import ReactDOM from 'react-dom'
import type { MenuItem } from './menuitem'
import { CircleTimer } from './circletimer'
import { showAlertEvent, showConfirmEvent, showPromptEvent } from './overlays/dialog-events'
import { showToastEvent } from './overlays/toast-events'
import { Tooltip } from './overlays/tooltip'
import { detectEditorLanguage, type DiagnosticSummary } from './language-handler'
import { createFileWithPrompt, deletePathWithConfirm, renamePathWithPrompt } from './path-actions'
import { compareDottedVersions, isDottedNumericVersion } from '../shared/utils'
import datapackSchemaHistory from '../../resources/datapack-schema/history.json'

const TREE_DRAG_PAYLOAD_MIME = 'application/x-mcpp-tree-entry'
const HOVER_EXPAND_CURSOR_SETTLE_MS = 280
const HOVER_EXPAND_COUNTDOWN_MS = 600

interface DataPackTreeProps {
  paths: string[]
  className?: string
  folderName?: string
  rootId?: string
  rootName?: string
  rootPackVersion?: string
  minecraftVersion?: string
  rootTags?: string[]
  basePath?: string
  onSelect?: (path: string, isFile: boolean, mode?: 'preview' | 'pinned') => void
  onFolderCreated?: () => void
  onRefreshRequested?: () => void
  onRemoveFromWorkspaceRequested?: () => void
  onFileRenamed?: (oldRelativePath: string, newName: string) => Promise<boolean>
  onFileDeleted?: (relativePath: string) => Promise<boolean>
  onContextMenuRequest?: (event: React.MouseEvent, items: MenuItem[]) => void
  modifiedFileKeys?: Set<string>
  fileDiagnosticSummaries?: Record<string, DiagnosticSummary>
  externalSelectedPath?: string | null
  externalSelectedFileKey?: string | null
  externalSelectionRevealNonce?: number
  externalExpandedPaths?: Set<string>
  onExpandedPathsChange?: (paths: Set<string>) => void
  treeContainerRef?: React.RefObject<HTMLDivElement | null>
}

type TreeNode = {
  name: string
  children?: Map<string, TreeNode>
  isFile?: boolean
  // Schema metadata
  schemaNode?: DatapackSchemaNode
  description?: string
  experimental?: boolean
  contentType?: string
  allowedChildren?: string[]
  // Root-level metadata
  packFormatVersion?: string
  minMinecraftVersion?: string
  maxMinecraftVersion?: string
}

type DatapackSchemaNode = {
  name?: string
  description?: string
  experimental?: boolean
  contentType?: string
  children?: DatapackSchemaNode[]
  packFormatVersion?: string
  minMinecraftVersion?: string
  maxMinecraftVersion?: string
}

type DatapackSchemaModule = {
  default: DatapackSchemaNode
}

type DatapackSchemaHistoryEntry = {
  minVersion?: string | null
  maxVersion?: string | null
}

const datapackSchemaLoaders = import.meta.glob<DatapackSchemaModule>('../../resources/datapack-schema/version/*.json')
const datapackSchemaCache = new Map<string, Promise<DatapackSchemaNode>>()
const datapackSchemaHistoryEntries = datapackSchemaHistory as Record<string, DatapackSchemaHistoryEntry>

const getSchemaPackFormatVersionFromPath = (schemaPath: string): string => {
  const fileName = schemaPath.split('/').pop() || ''
  return fileName.replace(/\.json$/i, '').trim()
}

const comparePackFormatVersions = (left: string, right: string): number => {
  if (isDottedNumericVersion(left) && isDottedNumericVersion(right)) {
    return compareDottedVersions(left, right)
  }

  return left.localeCompare(right)
}

const sortedDatapackSchemaPaths = Object.keys(datapackSchemaLoaders).sort((left, right) => {
  const leftVersion = getSchemaPackFormatVersionFromPath(left)
  const rightVersion = getSchemaPackFormatVersionFromPath(right)

  return comparePackFormatVersions(rightVersion, leftVersion)
})

const sortedHistoryPackVersions = Object.keys(datapackSchemaHistoryEntries).sort((left, right) => {
  return comparePackFormatVersions(right, left)
})

const resolvePackVersionFromMinecraftVersion = (minecraftVersion?: string): string | undefined => {
  const normalizedMinecraftVersion = minecraftVersion?.trim()
  if (!normalizedMinecraftVersion || !isDottedNumericVersion(normalizedMinecraftVersion)) {
    return undefined
  }

  for (const packVersion of sortedHistoryPackVersions) {
    const entry = datapackSchemaHistoryEntries[packVersion]
    const minVersion = entry?.minVersion?.trim()
    const maxVersion = entry?.maxVersion?.trim()
    if (!minVersion || !maxVersion) {
      continue
    }

    if (!isDottedNumericVersion(minVersion) || !isDottedNumericVersion(maxVersion)) {
      continue
    }

    const isAtLeastMinVersion = compareDottedVersions(normalizedMinecraftVersion, minVersion) >= 0
    const isAtMostMaxVersion = compareDottedVersions(normalizedMinecraftVersion, maxVersion) <= 0
    if (isAtLeastMinVersion && isAtMostMaxVersion) {
      return packVersion
    }
  }

  return undefined
}

const loadDatapackSchemaFromPath = async (schemaPath: string): Promise<DatapackSchemaNode | undefined> => {
  const loader = datapackSchemaLoaders[schemaPath]
  if (!loader) {
    return undefined
  }

  const cached = datapackSchemaCache.get(schemaPath)
  if (cached) {
    return await cached
  }

  const loadPromise = loader().then((module) => module.default)
  datapackSchemaCache.set(schemaPath, loadPromise)
  return await loadPromise
}

const resolveDatapackSchema = async (minecraftVersion?: string): Promise<DatapackSchemaNode | undefined> => {
  const targetPackVersion = resolvePackVersionFromMinecraftVersion(minecraftVersion)
  if (targetPackVersion) {
    for (const schemaPath of sortedDatapackSchemaPaths) {
      const schemaPackVersion = getSchemaPackFormatVersionFromPath(schemaPath)
      if (comparePackFormatVersions(schemaPackVersion, targetPackVersion) !== 0) {
        continue
      }

      const schema = await loadDatapackSchemaFromPath(schemaPath)
      if (schema) {
        return schema
      }
    }
  }

  const latestSchemaPath = sortedDatapackSchemaPaths[0]
  if (!latestSchemaPath) {
    return undefined
  }

  return await loadDatapackSchemaFromPath(latestSchemaPath)
}

type MinecraftDatapackValidation = {
  others?: Record<string, { elements?: boolean; format?: string; stable?: boolean; tags?: boolean }>
  registries?: Record<string, { elements?: boolean; stable?: boolean; tags?: boolean }>
}

type TreeClipboardEntry = {
  fullPath: string
  name: string
  isFile: boolean
  mode: 'copy' | 'cut'
}

type TreeDragPayload = {
  fullPath: string
  name: string
  isFile: boolean
}

let treeClipboardEntry: TreeClipboardEntry | null = null
let activeTreeDragPayload: TreeDragPayload | null = null

const buildTree = (paths: string[], rootName: string = 'root'): TreeNode => {
  const root: TreeNode = { name: rootName, children: new Map() }

  for (const rawPath of paths) {
    const normalized = rawPath.replace(/\\/g, '/').replace(/^\/+/, '')
    if (!normalized) continue

    const parts = normalized.split('/').filter(Boolean)
    let current = root

    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i]
      if (!current.children) current.children = new Map()

      let child = current.children.get(part)
      if (!child) {
        child = { name: part, children: new Map() }
        current.children.set(part, child)
      }

      const isLeaf = i === parts.length - 1
      child.isFile = isLeaf

      current = child
    }
  }

  return root
}

// Find matching schema node for a given physical node name
const findMatchingSchemaNode = (nodeName: string, schemaChildren: DatapackSchemaNode[] | undefined): DatapackSchemaNode | undefined => {
  if (!schemaChildren) return undefined

  // Try exact name match first
  for (const child of schemaChildren) {
    if (child.name === nodeName) {
      return child
    }
  }

  // Try placeholder match (like <namespace>, <registry_name>, etc.)
  for (const child of schemaChildren) {
    if (typeof child.name === 'string' && child.name.startsWith('<') && child.name.endsWith('>')) {
      return child
    }
  }

  return undefined
}

// Enrich tree nodes with schema metadata
const enrichTreeWithSchema = (node: TreeNode, schemaNode?: DatapackSchemaNode, isRoot: boolean = false): void => {
  if (!schemaNode) return

  node.schemaNode = schemaNode
  node.description = schemaNode.description
  node.experimental = schemaNode.experimental ?? false
  node.contentType = schemaNode.contentType
  node.allowedChildren = schemaNode.children
    ?.map((child) => child.name)
    .filter((name): name is string => typeof name === 'string')

  // Add root-level version metadata only for root node
  if (isRoot) {
    node.packFormatVersion = schemaNode.packFormatVersion
    node.minMinecraftVersion = schemaNode.minMinecraftVersion
    node.maxMinecraftVersion = schemaNode.maxMinecraftVersion
  }

  // Recursively enrich children
  if (node.children && schemaNode.children) {
    for (const [childName, childNode] of node.children) {
      const matchingSchema = findMatchingSchemaNode(childName, schemaNode.children)
      enrichTreeWithSchema(childNode, matchingSchema, false)
    }
  }
}

const sortChildren = (children: Map<string, TreeNode>): TreeNode[] => {
  const nodes = Array.from(children.values())
  nodes.sort((a, b) => {
    const aIsDir = a.children && a.children.size > 0
    const bIsDir = b.children && b.children.size > 0

    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return nodes
}

const collectDirectoryPaths = (node: TreeNode, pathKey: string, output: string[], depth: number) => {
  const hasChildren = node.children && node.children.size > 0
  if (!hasChildren) return

  // Only expand nodes at depth < 3
  if (depth < 3) {
    output.push(pathKey)
    for (const child of node.children!.values()) {
      collectDirectoryPaths(child, `${pathKey}/${child.name}`, output, depth + 1)
    }
  }
}

const normalizeSchemaPath = (value: string) => value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')

const buildLeafPathSetFromDatapackJson = (raw: MinecraftDatapackValidation): Set<string> => {
  const leafPaths = new Set<string>()

  const addLeafPath = (pathValue: string) => {
    const normalized = normalizeSchemaPath(pathValue)
    if (!normalized) return
    leafPaths.add(normalized)
  }

  const others = raw.others ?? {}
  for (const key of Object.keys(others)) {
    addLeafPath(key)
  }

  const registries = raw.registries ?? {}
  for (const [registryName, registry] of Object.entries(registries)) {
    const normalizedRegistryName = registryName.replace(/^minecraft:/, '')
    addLeafPath(normalizedRegistryName)

    if (registry.tags) {
      addLeafPath(`tags/${normalizedRegistryName}`)
    }
  }

  addLeafPath('tags/blocks')
  addLeafPath('tags/fluids')
  addLeafPath('tags/functions')
  addLeafPath('tags/items')

  return leafPaths
}

const isTreePathValidByDatapackJson = (relativePath: string, validLeafPaths: Set<string> | null): boolean => {
  if (!validLeafPaths) return true

  const normalized = normalizeSchemaPath(relativePath)
  if (!normalized) return true

  if (normalized === 'pack.mcmeta' || normalized === 'pack.png' || normalized === 'data') {
    return true
  }

  if (!normalized.startsWith('data/')) {
    return true
  }

  const relativeDataPath = normalized.slice('data/'.length)
  const segments = relativeDataPath.split('/').filter(Boolean)
  if (segments.length === 0) return true
  if (segments.length === 1) return true

  const namespaceRelativePath = segments.slice(1).join('/')
  if (!namespaceRelativePath) return true

  for (const leafPath of validLeafPaths) {
    if (leafPath === namespaceRelativePath) return true
    if (leafPath.startsWith(`${namespaceRelativePath}/`)) return true
  }

  return false
}

export function DatapackTree({ paths, className, folderName, rootId, rootName, rootPackVersion, minecraftVersion, rootTags, basePath, onSelect, onFolderCreated, onRefreshRequested, onRemoveFromWorkspaceRequested, onFileRenamed, onFileDeleted, onContextMenuRequest, modifiedFileKeys, fileDiagnosticSummaries, externalSelectedPath, externalSelectedFileKey, externalSelectionRevealNonce, externalExpandedPaths, onExpandedPathsChange, treeContainerRef }: DataPackTreeProps) {
  const [versionValidLeafPaths, setVersionValidLeafPaths] = React.useState<Set<string> | null>(null)
  const [datapackSchema, setDatapackSchema] = React.useState<DatapackSchemaNode | undefined>(undefined)
  const lastHandledRevealNonceRef = React.useRef<number | null>(null)
  const suppressRevealForCurrentNonceRef = React.useRef(false)

  React.useEffect(() => {
    let isCancelled = false

    const loadDatapackSchema = async () => {
      try {
        const schema = await resolveDatapackSchema(minecraftVersion)
        if (isCancelled) return
        setDatapackSchema(schema)
      } catch (error) {
        if (isCancelled) return
        console.error('Failed to resolve datapack schema:', error)
        setDatapackSchema(undefined)
      }
    }

    void loadDatapackSchema()

    return () => {
      isCancelled = true
    }
  }, [minecraftVersion])

  React.useEffect(() => {
    let isCancelled = false

    const loadVersionValidation = async () => {
      if (!minecraftVersion) {
        setVersionValidLeafPaths(null)
        return
      }

      try {
        const raw = await window.electron.minecraftDataGet(minecraftVersion, 'datapack')
        if (isCancelled) return

        const parsed = JSON.parse(raw) as MinecraftDatapackValidation
        setVersionValidLeafPaths(buildLeafPathSetFromDatapackJson(parsed))
      } catch (error) {
        if (isCancelled) return
        console.error('Failed to load Minecraft datapack validation:', error)
        setVersionValidLeafPaths(null)
      }
    }

    void loadVersionValidation()

    return () => {
      isCancelled = true
    }
  }, [minecraftVersion])

  const tree = React.useMemo(() => {
    const builtTree = buildTree(paths, folderName)
    // Enrich with schema starting from the root schema node
    enrichTreeWithSchema(builtTree, datapackSchema, true)
    return builtTree
  }, [paths, folderName, datapackSchema])
  const [selectedPath, setSelectedPath] = React.useState<string | null>(externalSelectedPath ?? null)
  const [expandedPaths, setExpandedPaths] = React.useState<Set<string>>(() => {
    const dirs: string[] = []
    // Expand root by default
    dirs.push(tree.name)
    if (tree.children) {
      for (const child of tree.children.values()) {
        collectDirectoryPaths(child, `${tree.name}/${child.name}`, dirs, 2)
      }
    }
    return new Set(dirs)
  })
  const [dragOverPathKey, setDragOverPathKey] = React.useState<string | null>(null)
  const [dragBlockedPathKey, setDragBlockedPathKey] = React.useState<string | null>(null)
  const [draggingSourcePathKey, setDraggingSourcePathKey] = React.useState<string | null>(null)
  const [dragHoverCursor, setDragHoverCursor] = React.useState<{ x: number; y: number } | null>(null)
  const [dragHoverCountdownElapsedMs, setDragHoverCountdownElapsedMs] = React.useState(0)
  const [isDragHoverCountdownActive, setIsDragHoverCountdownActive] = React.useState(false)

  const hoverExpandTargetPathRef = React.useRef<string | null>(null)
  const hoverExpandLastCursorRef = React.useRef<{ x: number; y: number } | null>(null)
  const hoverExpandSettleTimerRef = React.useRef<number | null>(null)
  const hoverExpandCountdownTimerRef = React.useRef<number | null>(null)
  const hoverExpandCountdownTickRef = React.useRef<number | null>(null)
  const hoverExpandCountdownStartAtRef = React.useRef<number | null>(null)

  const hasEnabledMcmeta = React.useMemo(
    () => paths.some((entry) => entry.replace(/\\/g, '/').replace(/^\/+/, '') === 'pack.mcmeta'),
    [paths],
  )
  const hasDisabledMcmeta = React.useMemo(
    () => paths.some((entry) => entry.replace(/\\/g, '/').replace(/^\/+/, '') === 'pack.mcmeta.disabled'),
    [paths],
  )
  const isDatapackDisabled = hasDisabledMcmeta && !hasEnabledMcmeta
  const canToggleDatapack = hasEnabledMcmeta || hasDisabledMcmeta
  const sortedRootTags = React.useMemo(() => {
    const normalized = (rootTags ?? [])
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)
    return [...normalized].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  }, [rootTags])

  // Use external values if provided
  const effectiveSelectedPath = externalSelectedPath !== undefined ? externalSelectedPath : selectedPath
  const effectiveExpandedPaths = externalExpandedPaths ?? expandedPaths
  const isExternalExpanded = externalExpandedPaths !== undefined

  const setExpandedPathsSafe = (next: Set<string>) => {
    if (onExpandedPathsChange) {
      onExpandedPathsChange(next)
    }
    if (!isExternalExpanded) {
      setExpandedPaths(next)
    }
  }

  const setSelectedPathSafe = (next: string | null) => {
    if (externalSelectedPath !== undefined) return
    setSelectedPath(next)
  }

  const hasBlockingOverlayOpen = () => {
    return document.querySelector('[data-overlay-menu="true"]') !== null
      || document.querySelector('[data-overlay-dialog="true"]') !== null
  }

  const clearHoverExpandTimers = React.useCallback((clearTarget: boolean = true) => {
    if (hoverExpandSettleTimerRef.current !== null) {
      window.clearTimeout(hoverExpandSettleTimerRef.current)
      hoverExpandSettleTimerRef.current = null
    }
    if (hoverExpandCountdownTimerRef.current !== null) {
      window.clearTimeout(hoverExpandCountdownTimerRef.current)
      hoverExpandCountdownTimerRef.current = null
    }
    if (hoverExpandCountdownTickRef.current !== null) {
      window.clearInterval(hoverExpandCountdownTickRef.current)
      hoverExpandCountdownTickRef.current = null
    }
    hoverExpandCountdownStartAtRef.current = null
    hoverExpandLastCursorRef.current = null
    setIsDragHoverCountdownActive(false)
    setDragHoverCountdownElapsedMs(0)
    setDragHoverCursor(null)
    if (clearTarget) {
      hoverExpandTargetPathRef.current = null
    }
  }, [])

  React.useEffect(() => {
    if (externalSelectedPath !== undefined) {
      setSelectedPath(externalSelectedPath)
    }
  }, [externalSelectedPath])

  React.useEffect(() => {
    if (isExternalExpanded || !onExpandedPathsChange) return
    onExpandedPathsChange(expandedPaths)
  }, [expandedPaths, isExternalExpanded, onExpandedPathsChange])

  React.useEffect(() => {
    if (isExternalExpanded || externalSelectedPath !== undefined) return
    const dirs: string[] = []
    // Expand root by default
    dirs.push(tree.name)
    if (tree.children) {
      for (const child of tree.children.values()) {
        collectDirectoryPaths(child, `${tree.name}/${child.name}`, dirs, 2)
      }
    }
    setExpandedPaths(new Set(dirs))
    setSelectedPath(null)
  }, [tree, isExternalExpanded, externalSelectedPath])

  React.useEffect(() => {
    if (externalSelectionRevealNonce === undefined) return
    if (lastHandledRevealNonceRef.current === externalSelectionRevealNonce) return

    lastHandledRevealNonceRef.current = externalSelectionRevealNonce
    suppressRevealForCurrentNonceRef.current = false

    const getScrollableAncestor = (element: HTMLElement): HTMLElement | null => {
      let current: HTMLElement | null = element.parentElement
      while (current) {
        const style = window.getComputedStyle(current)
        const isScrollableY = (style.overflowY === 'auto' || style.overflowY === 'scroll')
          && current.scrollHeight > current.clientHeight
        if (isScrollableY) return current
        current = current.parentElement
      }
      return null
    }

    const tryReveal = (remainingFrames: number) => {
      if (suppressRevealForCurrentNonceRef.current) return
      const container = treeContainerRef?.current
      if (!container) return

      const selectedElement = container.querySelector<HTMLElement>('[data-tree-selected="true"]')
      if (!selectedElement) {
        if (remainingFrames <= 0) return
        window.requestAnimationFrame(() => {
          tryReveal(remainingFrames - 1)
        })
        return
      }

      const scrollContainer = getScrollableAncestor(selectedElement) ?? container
      const viewportRect = scrollContainer.getBoundingClientRect()
      const selectedRect = selectedElement.getBoundingClientRect()
      const isFullyVisible = selectedRect.top >= viewportRect.top && selectedRect.bottom <= viewportRect.bottom
      if (isFullyVisible) return

      selectedElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    }

    tryReveal(3)
  }, [externalSelectionRevealNonce, treeContainerRef])

  React.useEffect(() => {
    if (!isDragHoverCountdownActive && hoverExpandSettleTimerRef.current === null) return

    const overlayCheckTimer = window.setInterval(() => {
      if (hasBlockingOverlayOpen()) {
        clearHoverExpandTimers(true)
      }
    }, 50)

    return () => {
      window.clearInterval(overlayCheckTimer)
    }
  }, [isDragHoverCountdownActive, clearHoverExpandTimers])

  React.useEffect(() => {
    return () => {
      clearHoverExpandTimers(true)
    }
  }, [clearHoverExpandTimers])

  React.useEffect(() => {
    const handleDocumentDragOver = (event: DragEvent) => {
      const container = treeContainerRef?.current
      if (!container) {
        return
      }

      const elementUnderPointer = document.elementFromPoint(event.clientX, event.clientY)
      if ((elementUnderPointer && container.contains(elementUnderPointer)) || container.matches(':hover')) {
        return
      }

      setDragOverPathKey(null)
      setDragBlockedPathKey(null)
      clearHoverExpandTimers(true)
    }

    document.addEventListener('dragover', handleDocumentDragOver)
    return () => {
      document.removeEventListener('dragover', handleDocumentDragOver)
    }
  }, [treeContainerRef, clearHoverExpandTimers])

  const modifiedPathKeys = React.useMemo(() => {
    const next = new Set<string>()
    if (!basePath || !modifiedFileKeys?.size) return next

    for (const fileKey of modifiedFileKeys) {
      const separatorIndex = fileKey.indexOf('|')
      if (separatorIndex === -1) continue

      const datapackDir = fileKey.slice(0, separatorIndex)
      if (datapackDir !== basePath) continue

      const relativePath = fileKey
        .slice(separatorIndex + 1)
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')

      next.add(tree.name)

      const segments = relativePath.split('/').filter(Boolean)
      let currentPath = tree.name
      for (const segment of segments) {
        currentPath = `${currentPath}/${segment}`
        next.add(currentPath)
      }
    }

    return next
  }, [basePath, modifiedFileKeys, tree.name])

  const diagnosticPathSummaries = React.useMemo(() => {
    const next: Record<string, DiagnosticSummary> = {}
    if (!basePath || !fileDiagnosticSummaries) return next

    for (const [fileKey, summary] of Object.entries(fileDiagnosticSummaries)) {
      const errors = summary?.errors ?? 0
      const warnings = summary?.warnings ?? 0
      if (errors <= 0 && warnings <= 0) continue

      const separatorIndex = fileKey.indexOf('|')
      if (separatorIndex === -1) continue

      const datapackDir = fileKey.slice(0, separatorIndex)
      if (datapackDir !== basePath) continue

      const relativePath = fileKey
        .slice(separatorIndex + 1)
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')

      const pathKeys = [tree.name]
      const segments = relativePath.split('/').filter(Boolean)
      let currentPath = tree.name
      for (const segment of segments) {
        currentPath = `${currentPath}/${segment}`
        pathKeys.push(currentPath)
      }

      for (const pathKey of pathKeys) {
        const existingSummary = next[pathKey]
        if (existingSummary) {
          existingSummary.errors += errors
          existingSummary.warnings += warnings
        } else {
          next[pathKey] = { errors, warnings }
        }
      }
    }

    return next
  }, [basePath, fileDiagnosticSummaries, tree.name])

  const toggleExpanded = (pathKey: string) => {
    const next = new Set(effectiveExpandedPaths)
    if (next.has(pathKey)) {
      next.delete(pathKey)
    } else {
      next.add(pathKey)
    }
    setExpandedPathsSafe(next)
  }

  const handleSelect = (pathKey: string, isFile: boolean, hasChildren: boolean) => {
    setSelectedPathSafe(pathKey)
    if (hasChildren) {
      toggleExpanded(pathKey)
    }
    if (isFile && onSelect) {
      onSelect(pathKey, true, 'preview')
    } else if (!isFile && onSelect) {
      onSelect(pathKey, false)
    }
  }

  const handleDoubleClick = (pathKey: string, isFile: boolean) => {
    if (!isFile || !onSelect) return
    setSelectedPathSafe(pathKey)
    onSelect(pathKey, true, 'pinned')
  }

  const normalizePath = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '')

  const splitAbsolutePath = (value: string) => {
    const normalized = normalizePath(value)
    const separatorIndex = normalized.lastIndexOf('/')
    if (separatorIndex <= 0) {
      return { directory: normalized, name: normalized }
    }

    return {
      directory: normalized.slice(0, separatorIndex),
      name: normalized.slice(separatorIndex + 1),
    }
  }

  const splitNameAndExtension = (name: string) => {
    const lastDotIndex = name.lastIndexOf('.')
    if (lastDotIndex <= 0) {
      return { stem: name, extension: '' }
    }
    return {
      stem: name.slice(0, lastDotIndex),
      extension: name.slice(lastDotIndex),
    }
  }

  const ensureUniqueChildName = async (directoryPath: string, desiredName: string) => {
    const normalizedDirectoryPath = normalizePath(directoryPath)
    const existingEntries = await window.electron.listFiles(normalizedDirectoryPath)
    const existingPaths = new Set(existingEntries.map((entry) => normalizePath(entry)))

    let candidateName = desiredName
    let suffix = 1
    while (existingPaths.has(`${normalizedDirectoryPath}/${candidateName}`)) {
      const { stem, extension } = splitNameAndExtension(desiredName)
      candidateName = suffix === 1
        ? `${stem} copy${extension}`
        : `${stem} copy ${suffix}${extension}`
      suffix += 1
    }

    return candidateName
  }

  const copyPath = async (sourcePath: string, destinationDirectoryPath: string, destinationName: string, isFile: boolean) => {
    const normalizedSourcePath = normalizePath(sourcePath)
    const normalizedDestinationDirectoryPath = normalizePath(destinationDirectoryPath)

    if (isFile) {
      const sourceParts = splitAbsolutePath(normalizedSourcePath)
      const sourceContents = await window.electron.readFile(sourceParts.directory, sourceParts.name)
      await window.electron.writeFile(normalizedDestinationDirectoryPath, destinationName, sourceContents)
      return
    }

    const destinationRootPath = `${normalizedDestinationDirectoryPath}/${destinationName}`
    await window.electron.createFolder(destinationRootPath)

    const sourceEntries = await window.electron.listFiles(normalizedSourcePath)
    const normalizedEntries = Array.from(new Set(sourceEntries.map((entry) => normalizePath(entry))))
      .sort((left, right) => left.length - right.length)

    for (const sourceEntryPath of normalizedEntries) {
      if (sourceEntryPath === normalizedSourcePath) continue

      const relativeEntryPath = sourceEntryPath.slice(normalizedSourcePath.length).replace(/^\/+/, '')
      if (!relativeEntryPath) continue

      const destinationEntryPath = `${destinationRootPath}/${relativeEntryPath}`
      const hasChildren = normalizedEntries.some((candidate) => candidate.startsWith(`${sourceEntryPath}/`))

      if (hasChildren) {
        await window.electron.createFolder(destinationEntryPath)
        continue
      }

      const sourceEntryParts = splitAbsolutePath(sourceEntryPath)
      try {
        const sourceContents = await window.electron.readFile(sourceEntryParts.directory, sourceEntryParts.name)
        const destinationEntryParts = splitAbsolutePath(destinationEntryPath)
        await window.electron.createFolder(destinationEntryParts.directory)
        await window.electron.writeFile(destinationEntryParts.directory, destinationEntryParts.name, sourceContents)
      } catch {
        await window.electron.createFolder(destinationEntryPath)
      }
    }
  }

  const getRelativePathFromPathKey = (pathKey: string) => {
    const normalizedKey = pathKey.replace(/\\/g, '/')
    const rootPrefix = `${tree.name}/`
    if (normalizedKey === tree.name) return ''
    if (normalizedKey.startsWith(rootPrefix)) {
      return normalizedKey.slice(rootPrefix.length)
    }
    return normalizedKey
  }

  const getRelativeChildPathFromPathKey = (pathKey: string, childName: string) => {
    const parentRelativePath = getRelativePathFromPathKey(pathKey)
    return normalizeSchemaPath(parentRelativePath ? `${parentRelativePath}/${childName}` : childName)
  }

  const resolveTargetPath = (rootPath: string, key: string, childName: string) => {
    const normalizedBase = normalizePath(rootPath)
    const normalizedKey = key.replace(/\\/g, '/')
    const rootPrefix = `${tree.name}/`
    const relative = normalizedKey === tree.name
      ? ''
      : normalizedKey.startsWith(rootPrefix)
        ? normalizedKey.slice(rootPrefix.length)
        : normalizedKey

    const parts = [normalizedBase]
    if (relative) parts.push(relative)
    parts.push(childName)
    return parts.join('/')
  }

  const getActualPath = (pathKey: string): string | null => {
    if (!basePath) return null
    
    const normalizedBase = normalizePath(basePath)
    const normalizedKey = pathKey.replace(/\\/g, '/')
    const rootPrefix = `${tree.name}/`
    
    // Root node
    if (normalizedKey === tree.name) {
      return normalizedBase
    }
    
    // Child nodes
    if (normalizedKey.startsWith(rootPrefix)) {
      const relative = normalizedKey.slice(rootPrefix.length)
      return `${normalizedBase}/${relative}`
    }
    
    return null
  }

  const handleToggleDatapack = async () => {
    if (!basePath) {
      await showAlertEvent('Error', 'Cannot toggle datapack without a base path')
      return
    }

    if (!hasEnabledMcmeta && !hasDisabledMcmeta) {
      await showAlertEvent('Error', 'No pack.mcmeta or pack.mcmeta.disabled file found in datapack root')
      return
    }

    const normalizedBase = normalizePath(basePath)
    const sourcePath = hasEnabledMcmeta
      ? `${normalizedBase}/pack.mcmeta`
      : `${normalizedBase}/pack.mcmeta.disabled`
    const targetName = hasEnabledMcmeta ? 'pack.mcmeta.disabled' : 'pack.mcmeta'
    const actionLabel = hasEnabledMcmeta ? 'Disabled' : 'Enabled'
    const datapackLabel = rootName || folderName || tree.name || 'Datapack'

    try {
      await window.electron.renameFileOrFolder(sourcePath, targetName)
      showToastEvent(`${actionLabel} datapack: ${datapackLabel}`)
      onRefreshRequested?.()
    } catch (error) {
      console.error('Failed to toggle datapack:', error)
      await showAlertEvent('Error', `Failed to toggle datapack: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const handleEditTags = async () => {
    if (!basePath) {
      await showAlertEvent('Error', 'Cannot edit tags without a base path')
      return
    }

    const defaultTagValue = sortedRootTags.join(', ')
    const rawInput = await showPromptEvent('Edit tags', 'Enter comma-separated tags:', defaultTagValue)
    if (rawInput === null) {
      return
    }

    const nextTags = Array.from(new Set(
      rawInput
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0),
    ))

    try {
      const metadataRaw = await window.electron.readFile(basePath, '.mpp-datapack')
      const metadata = JSON.parse(metadataRaw)
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        throw new Error('Invalid metadata format')
      }

      const metadataRecord = metadata as Record<string, unknown>
      const { isDisabled: _legacyDisabledFlag, ...metadataWithoutLegacyDisabled } = metadataRecord
      void _legacyDisabledFlag
      const nextMetadata = {
        ...metadataWithoutLegacyDisabled,
        tags: nextTags,
      }

      await window.electron.writeFile(basePath, '.mpp-datapack', JSON.stringify(nextMetadata, null, 2))
      onRefreshRequested?.()
    } catch (error) {
      console.error('Failed to edit datapack tags:', error)
      await showAlertEvent('Error', `Failed to edit tags: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const handleRename = async (pathKey: string, currentName: string) => {
    const actualPath = getActualPath(pathKey)
    if (!actualPath) {
      console.error('Cannot determine actual path')
      await showAlertEvent('Error', 'Cannot determine actual path')
      return
    }

    // Get relative path for the file being renamed
    const normalizedKey = pathKey.replace(/\\/g, '/')
    const rootPrefix = `${tree.name}/`
    const relativePath = normalizedKey === tree.name
      ? ''
      : normalizedKey.startsWith(rootPrefix)
        ? normalizedKey.slice(rootPrefix.length)
        : normalizedKey

    await renamePathWithPrompt({
      fullPath: actualPath,
      currentName,
      promptRename: showPromptEvent,
      showError: showAlertEvent,
      preRenameCheck: onFileRenamed && relativePath
        ? () => onFileRenamed(relativePath, '')
        : undefined,
      onRenamed: async (newName) => {
        if (onFileRenamed && relativePath) {
          await onFileRenamed(relativePath, newName)
        }

        if (onFolderCreated) {
          onFolderCreated()
        }
      },
    })
  }

  const handleDelete = async (pathKey: string, itemName: string, isFile: boolean) => {
    const actualPath = getActualPath(pathKey)
    if (!actualPath) {
      console.error('Cannot determine actual path')
      await showAlertEvent('Error', 'Cannot determine actual path')
      return
    }

    // Get relative path for the file being deleted
    const normalizedKey = pathKey.replace(/\\/g, '/')
    const rootPrefix = `${tree.name}/`
    const relativePath = normalizedKey === tree.name
      ? ''
      : normalizedKey.startsWith(rootPrefix)
        ? normalizedKey.slice(rootPrefix.length)
        : normalizedKey

    await deletePathWithConfirm({
      fullPath: actualPath,
      itemName,
      itemType: isFile ? 'file' : 'folder',
      confirmDelete: showConfirmEvent,
      showError: showAlertEvent,
      preDeleteCheck: onFileDeleted && relativePath && isFile
        ? () => onFileDeleted(relativePath)
        : undefined,
      onDeleted: async () => {
        if (onFolderCreated) {
          onFolderCreated()
        }
      },
    })
  }

  const handleCreateFile = async (pathKey: string, isFile: boolean) => {
    const actualPath = getActualPath(pathKey)
    if (!actualPath) {
      console.error('Cannot determine actual path')
      await showAlertEvent('Error', 'Cannot determine actual path')
      return
    }

    const normalizedPath = actualPath.replace(/\\/g, '/')
    const parentDirectoryPath = isFile
      ? normalizedPath.split('/').slice(0, -1).join('/')
      : normalizedPath

    await createFileWithPrompt({
      parentDirectoryPath,
      promptFileName: showPromptEvent,
      showError: showAlertEvent,
      onCreated: async () => {
        if (onFolderCreated) {
          onFolderCreated()
        }
      },
    })
  }

  const handleCutOrCopy = async (pathKey: string, itemName: string, isFile: boolean, mode: 'copy' | 'cut') => {
    const actualPath = getActualPath(pathKey)
    if (!actualPath) {
      await showAlertEvent('Error', 'Cannot determine actual path')
      return
    }

    treeClipboardEntry = {
      fullPath: normalizePath(actualPath),
      name: itemName,
      isFile,
      mode,
    }

    showToastEvent(`${mode === 'copy' ? 'Copied' : 'Cut'} ${isFile ? 'file' : 'folder'}: ${itemName}`)
  }

  const transferEntryToDirectory = async (
    entry: TreeClipboardEntry,
    destinationDirectoryPath: string,
    options?: {
      clearClipboardOnCut?: boolean
      modeLabel?: 'pasted' | 'dragged'
    },
  ) => {
    const sourcePath = normalizePath(entry.fullPath)
    const sourceParentDirectory = splitAbsolutePath(sourcePath).directory

    if (!entry.isFile && (destinationDirectoryPath === sourcePath || destinationDirectoryPath.startsWith(`${sourcePath}/`))) {
      showToastEvent('Error: Cannot move a folder into itself')
      return false
    }

    if (entry.mode === 'cut' && destinationDirectoryPath === sourceParentDirectory) {
      return false
    }

    const targetName = await ensureUniqueChildName(destinationDirectoryPath, entry.name)
    await copyPath(sourcePath, destinationDirectoryPath, targetName, entry.isFile)

    if (entry.mode === 'cut') {
      await window.electron.deleteFileOrFolder(sourcePath)
      if (options?.clearClipboardOnCut) {
        treeClipboardEntry = null
      }
    }

    const modeLabel = options?.modeLabel ?? 'pasted'
    if (modeLabel === 'dragged') {
      showToastEvent('Moved item')
    } else {
      showToastEvent(entry.mode === 'cut' ? 'Moved item' : 'Pasted copy')
    }

    return true
  }

  const handlePaste = async (pathKey: string, targetIsFile: boolean) => {
    if (!treeClipboardEntry) return

    const actualPath = getActualPath(pathKey)
    if (!actualPath) {
      await showAlertEvent('Error', 'Cannot determine paste destination')
      return
    }

    const normalizedTargetPath = normalizePath(actualPath)
    const destinationDirectoryPath = targetIsFile
      ? splitAbsolutePath(normalizedTargetPath).directory
      : normalizedTargetPath

    try {
      const didTransfer = await transferEntryToDirectory(treeClipboardEntry, destinationDirectoryPath, {
        clearClipboardOnCut: true,
        modeLabel: 'pasted',
      })
      if (didTransfer) {
        onFolderCreated?.()
      }
    } catch (error) {
      console.error('Failed to paste item:', error)
      await showAlertEvent('Error', `Failed to paste: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const parseDragPayload = (event: React.DragEvent): TreeDragPayload | null => {
    try {
      const rawPayload = event.dataTransfer.getData(TREE_DRAG_PAYLOAD_MIME)
      if (!rawPayload) {
        return activeTreeDragPayload
      }
      const parsed = JSON.parse(rawPayload) as Partial<TreeDragPayload>
      if (!parsed || typeof parsed !== 'object') return null
      if (typeof parsed.fullPath !== 'string') return null
      if (typeof parsed.name !== 'string') return null
      if (typeof parsed.isFile !== 'boolean') return null
      return {
        fullPath: parsed.fullPath,
        name: parsed.name,
        isFile: parsed.isFile,
      }
    } catch {
      return activeTreeDragPayload
    }
  }

  const hasTreeDragPayload = (event: React.DragEvent): boolean => {
    if (activeTreeDragPayload) return true
    return event.dataTransfer.types.includes(TREE_DRAG_PAYLOAD_MIME)
  }

  const getParentPathKey = (pathKey: string) => {
    const normalizedPathKey = pathKey.replace(/\\/g, '/')
    const lastSeparatorIndex = normalizedPathKey.lastIndexOf('/')
    if (lastSeparatorIndex <= 0) {
      return tree.name
    }
    return normalizedPathKey.slice(0, lastSeparatorIndex)
  }

  const resolveDropTargetPathKey = (pathKey: string, nodeIsFile: boolean) => {
    if (!nodeIsFile) {
      return pathKey
    }
    return getParentPathKey(pathKey)
  }

  const startHoverExpandWithSettle = (pathKey: string, cursorX: number, cursorY: number) => {
    clearHoverExpandTimers(false)
    hoverExpandTargetPathRef.current = pathKey
    setDragHoverCursor({ x: cursorX, y: cursorY })

    hoverExpandSettleTimerRef.current = window.setTimeout(() => {
      hoverExpandSettleTimerRef.current = null
      if (hoverExpandTargetPathRef.current !== pathKey) return
      if (hasBlockingOverlayOpen()) {
        clearHoverExpandTimers(true)
        return
      }

      hoverExpandCountdownStartAtRef.current = Date.now()
      setDragHoverCountdownElapsedMs(0)
      setIsDragHoverCountdownActive(true)

      hoverExpandCountdownTickRef.current = window.setInterval(() => {
        const startAt = hoverExpandCountdownStartAtRef.current
        if (!startAt) return
        const elapsed = Math.min(Date.now() - startAt, HOVER_EXPAND_COUNTDOWN_MS)
        setDragHoverCountdownElapsedMs(elapsed)
      }, 50)

      hoverExpandCountdownTimerRef.current = window.setTimeout(() => {
        hoverExpandCountdownTimerRef.current = null
        if (hoverExpandTargetPathRef.current === pathKey && !hasBlockingOverlayOpen()) {
          const next = new Set(effectiveExpandedPaths)
          next.add(pathKey)
          setExpandedPathsSafe(next)
        }
        clearHoverExpandTimers(true)
      }, HOVER_EXPAND_COUNTDOWN_MS)
    }, HOVER_EXPAND_CURSOR_SETTLE_MS)
  }

  const isHoverExpandRunningFor = (pathKey: string) => {
    return hoverExpandTargetPathRef.current === pathKey
      && (hoverExpandSettleTimerRef.current !== null || isDragHoverCountdownActive)
  }

  const handleDragOverForNode = (
    event: React.DragEvent,
    pathKey: string,
    nodeIsFile: boolean,
    hasChildren: boolean,
    isExpanded: boolean,
  ) => {
    if (!hasTreeDragPayload(event)) return

    const payload = parseDragPayload(event)
    if (!payload) return

    const dropTargetPathKey = resolveDropTargetPathKey(pathKey, nodeIsFile)
    const actualTargetPath = getActualPath(dropTargetPathKey)
    if (!actualTargetPath) return

    const destinationDirectoryPath = normalizePath(actualTargetPath)
    const sourcePath = normalizePath(payload.fullPath)
    const sourceParentDirectory = splitAbsolutePath(sourcePath).directory
    const isFolderIntoSelf = !payload.isFile
      && (destinationDirectoryPath === sourcePath || destinationDirectoryPath.startsWith(`${sourcePath}/`))
    const isNoOpSameParent = destinationDirectoryPath === sourceParentDirectory
    const isBlockedTarget = isFolderIntoSelf || isNoOpSameParent

    event.preventDefault()
    event.dataTransfer.dropEffect = isBlockedTarget ? 'none' : 'move'
    setDragOverPathKey(dropTargetPathKey)
    setDragBlockedPathKey(isBlockedTarget ? dropTargetPathKey : null)

    if (isBlockedTarget) {
      clearHoverExpandTimers(true)
      return
    }

    if (hasBlockingOverlayOpen()) {
      clearHoverExpandTimers(true)
      return
    }

    if (nodeIsFile || !hasChildren || isExpanded) {
      clearHoverExpandTimers(true)
      return
    }

    if (isHoverExpandRunningFor(dropTargetPathKey)) {
      setDragHoverCursor({ x: event.clientX, y: event.clientY })
      return
    }

    startHoverExpandWithSettle(dropTargetPathKey, event.clientX, event.clientY)
  }

  const handleDropOnNode = async (event: React.DragEvent, pathKey: string, targetIsFile: boolean) => {
    const payload = parseDragPayload(event)
    setDragOverPathKey(null)
    clearHoverExpandTimers(true)
    if (!payload) return

    event.preventDefault()

    const dropTargetPathKey = resolveDropTargetPathKey(pathKey, targetIsFile)
    const actualPath = getActualPath(dropTargetPathKey)
    if (!actualPath) {
      await showAlertEvent('Error', 'Cannot determine drop destination')
      return
    }

    const normalizedTargetPath = normalizePath(actualPath)
    // dropTargetPathKey always resolves to a folder/root target path.
    const destinationDirectoryPath = normalizedTargetPath

    try {
      const dragEntry: TreeClipboardEntry = {
        fullPath: payload.fullPath,
        name: payload.name,
        isFile: payload.isFile,
        mode: 'cut',
      }
      const didTransfer = await transferEntryToDirectory(dragEntry, destinationDirectoryPath, {
        clearClipboardOnCut: false,
        modeLabel: 'dragged',
      })
      if (didTransfer) {
        onFolderCreated?.()
      }
    } catch (error) {
      console.error('Failed to move dropped item:', error)
      await showAlertEvent('Error', `Failed to move item: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const handleDragOverForFolderGap = (event: React.DragEvent, folderPathKey: string) => {
    if (!hasTreeDragPayload(event)) return

    const payload = parseDragPayload(event)
    if (!payload) return

    const actualTargetPath = getActualPath(folderPathKey)
    if (!actualTargetPath) return

    const destinationDirectoryPath = normalizePath(actualTargetPath)
    const sourcePath = normalizePath(payload.fullPath)
    const sourceParentDirectory = splitAbsolutePath(sourcePath).directory
    const isFolderIntoSelf = !payload.isFile
      && (destinationDirectoryPath === sourcePath || destinationDirectoryPath.startsWith(`${sourcePath}/`))
    const isNoOpSameParent = destinationDirectoryPath === sourceParentDirectory
    const isBlockedTarget = isFolderIntoSelf || isNoOpSameParent

    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = isBlockedTarget ? 'none' : 'move'
    setDragOverPathKey(folderPathKey)
    setDragBlockedPathKey(isBlockedTarget ? folderPathKey : null)

    if (isBlockedTarget) {
      clearHoverExpandTimers(true)
      return
    }

    if (hasBlockingOverlayOpen()) {
      clearHoverExpandTimers(true)
      return
    }

    const folderNode = findNodeByPathKey(folderPathKey)
    const hasChildren = !!(folderNode?.children && folderNode.children.size > 0)
    const isExpanded = hasChildren && effectiveExpandedPaths.has(folderPathKey)

    if (!hasChildren || isExpanded) {
      clearHoverExpandTimers(true)
      return
    }

    if (isHoverExpandRunningFor(folderPathKey)) {
      setDragHoverCursor({ x: event.clientX, y: event.clientY })
      return
    }

    startHoverExpandWithSettle(folderPathKey, event.clientX, event.clientY)
  }

  const handleDropOnFolderGap = async (event: React.DragEvent, folderPathKey: string) => {
    if (!hasTreeDragPayload(event)) return

    event.stopPropagation()
    await handleDropOnNode(event, folderPathKey, false)
  }

  const findNodeByPathKey = (pathKey: string): TreeNode | null => {
    const normalizedKey = pathKey.replace(/\\/g, '/')
    if (normalizedKey === tree.name) return tree

    const rootPrefix = `${tree.name}/`
    const relative = normalizedKey.startsWith(rootPrefix)
      ? normalizedKey.slice(rootPrefix.length)
      : normalizedKey
    const segments = relative.split('/').filter(Boolean)

    let current: TreeNode = tree
    for (const segment of segments) {
      const next = current.children?.get(segment)
      if (!next) return null
      current = next
    }

    return current
  }

  const handleTreeKeyDown = async (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return

    const hasBlockingOverlayOpen =
      document.querySelector('[data-overlay-menu="true"]') !== null
      || document.querySelector('[data-overlay-dialog="true"]') !== null
    if (hasBlockingOverlayOpen) return

    const treeElement = treeContainerRef?.current
    const activeElement = document.activeElement
    if (treeElement && activeElement && treeElement !== activeElement && !treeElement.contains(activeElement)) {
      return
    }

    const key = event.key.toLowerCase()
    if (key !== 'x' && key !== 'c' && key !== 'v') return

    const selectedPathKey = effectiveSelectedPath ?? tree.name
    const selectedNode = findNodeByPathKey(selectedPathKey)
    const isRootNode = selectedPathKey === tree.name
    const canOperateOnSelection = !!selectedNode && !isRootNode && !!basePath

    if (key === 'x') {
      if (!canOperateOnSelection || !selectedNode) return
      event.preventDefault()
      await handleCutOrCopy(selectedPathKey, selectedNode.name, !!selectedNode.isFile, 'cut')
      return
    }

    if (key === 'c') {
      if (!canOperateOnSelection || !selectedNode) return
      event.preventDefault()
      await handleCutOrCopy(selectedPathKey, selectedNode.name, !!selectedNode.isFile, 'copy')
      return
    }

    if (!treeClipboardEntry || !basePath || !selectedNode) return
    event.preventDefault()
    await handlePaste(selectedPathKey, !!selectedNode.isFile)
  }

  const handleRightClick = (e: React.MouseEvent, node: TreeNode, pathKey: string) => {
    const allowedChildren = node.allowedChildren ?? []
    const submenuItems: MenuItem[] = allowedChildren.map((child) => {
      const isTemplate = child.startsWith('<') && child.endsWith('>')
      const isFile = child.includes('.')
      const folderExists = (node.children?.has(child) ?? false)
        || (child === 'pack.mcmeta' && (node.children?.has('pack.mcmeta.disabled') ?? false))
      const childRelativePath = getRelativeChildPathFromPathKey(pathKey, child)
      const isValidForVersion = isTreePathValidByDatapackJson(childRelativePath, versionValidLeafPaths)
      return {
        label: child,
        onClick: async () => {
          if (!isTemplate && !isFile && !folderExists) {
            const targetPath = basePath
              ? resolveTargetPath(basePath, pathKey, child)
              : `${pathKey}/${child}`
            try {
              await window.electron.createFolder(targetPath)
              if (onFolderCreated) {
                onFolderCreated()
              }
            } catch (error) {
              console.error('Failed to create folder:', error)
              await showAlertEvent('Error', `Failed to create folder: ${error instanceof Error ? error.message : 'Unknown error'}`)
            }
          }
        },
        disabled: isTemplate || isFile || folderExists || !isValidForVersion,
        existingFolder: folderExists,
      }
    })

    const isRootNode = pathKey === tree.name
    const canRenameOrDelete = !isRootNode && basePath !== undefined

    const rootItems: MenuItem[] = [
      {
        label: 'Paste',
        shortcut: 'Ctrl+V',
        onClick: () => handlePaste(pathKey, false),
        disabled: !treeClipboardEntry || !basePath,
      },
      {},
      {
        label: 'Refresh',
        onClick: onRefreshRequested,
        disabled: !onRefreshRequested,
      },
      {
        label: hasEnabledMcmeta ? 'Disable Datapack' : 'Enable Datapack',
        onClick: handleToggleDatapack,
        disabled: !canToggleDatapack,
      },
      {
        label: 'Edit Tags',
        onClick: handleEditTags,
        disabled: !basePath,
      },
      {},
      {
        label: 'Remove Datapack from Workspace',
        onClick: onRemoveFromWorkspaceRequested,
        disabled: !onRemoveFromWorkspaceRequested,
      },
      {},
      {
        label: 'Create Datapack Directory',
        children: submenuItems.length ? submenuItems : undefined,
        disabled: submenuItems.length === 0,
      },
    ]

    const items: MenuItem[] = [
      {
        label: 'Cut',
        shortcut: 'Ctrl+X',
        onClick: () => handleCutOrCopy(pathKey, node.name, !!node.isFile, 'cut'),
        disabled: !canRenameOrDelete,
      },
      {
        label: 'Copy',
        shortcut: 'Ctrl+C',
        onClick: () => handleCutOrCopy(pathKey, node.name, !!node.isFile, 'copy'),
        disabled: !canRenameOrDelete,
      },
      {
        label: 'Paste',
        shortcut: 'Ctrl+V',
        onClick: () => handlePaste(pathKey, !!node.isFile),
        disabled: !treeClipboardEntry || !basePath,
      },
      {},
      {
        label: 'New File',
        onClick: () => handleCreateFile(pathKey, !!node.isFile),
        disabled: !canRenameOrDelete
      },
      {
        label: 'Rename',
        shortcut: 'F2',
        onClick: () => handleRename(pathKey, node.name),
        disabled: !canRenameOrDelete
      },
      {
        label: 'Delete',
        shortcut: 'Del',
        onClick: () => handleDelete(pathKey, node.name, !!node.isFile),
        disabled: !canRenameOrDelete
      },
      {},
      {
        label: 'Create Datapack Directory',
        children: submenuItems.length ? submenuItems : undefined,
        disabled: submenuItems.length === 0,
      },
    ]

    onContextMenuRequest?.(e, isRootNode ? rootItems : items)
  }

  const renderNode = (node: TreeNode, depth: number, pathKey: string): React.ReactNode => {
    const hasChildren = node.children && node.children.size > 0
    const isExpanded = hasChildren && effectiveExpandedPaths.has(pathKey)
    const padding = depth * 12
    const relativePath = getRelativePathFromPathKey(pathKey)
    const languageIconClass = node.isFile
      ? detectEditorLanguage(relativePath || node.name).codicon
      : 'codicon-file'
    const nodeFileKey = basePath && relativePath ? `${basePath}|${relativePath}` : null
    const nodeDiagnosticSummary = diagnosticPathSummaries[pathKey]
    const hasDiagnosticError = (nodeDiagnosticSummary?.errors ?? 0) > 0
    const hasDiagnosticWarning = !hasDiagnosticError && (nodeDiagnosticSummary?.warnings ?? 0) > 0
    const isModified = modifiedPathKeys.has(pathKey)
    const isSelected = node.isFile && externalSelectedFileKey && nodeFileKey
      ? externalSelectedFileKey === nodeFileKey
      : effectiveSelectedPath === pathKey
    const isDragOverTarget = !node.isFile && dragOverPathKey === pathKey && dragBlockedPathKey !== pathKey
    const isDragBlockedTarget = !node.isFile && dragBlockedPathKey === pathKey
    const isDraggingSource = draggingSourcePathKey === pathKey
    const isRoot = depth === 0
    const isDisabledMetaFile = node.isFile && (relativePath || node.name) === 'pack.mcmeta.disabled'
    const nodeNameWeightClass = node.isFile ? 'font-normal' : (isRoot ? 'font-bold' : 'font-semibold')
    let nodeNameColorClass = 'text-codemirror-100'
    if ((isRoot && isDatapackDisabled) || isDisabledMetaFile) {
      nodeNameColorClass = 'text-red-400'
    } else if (node.schemaNode) {
      nodeNameColorClass = 'text-emerald-300'
    } else if (isModified) {
      nodeNameColorClass = 'text-orange-300'
    }
    const nodeNameStyleClass = node.experimental ? 'italic' : ''

    return (
      <li key={pathKey}>
        <Tooltip content={node.description} disabled={!node.description}>
          <div
            data-tree-selected={isSelected ? 'true' : undefined}
            data-datapack-tree-root={isRoot ? 'true' : undefined}
            data-tree-entry-draggable={!isRoot ? 'true' : undefined}
            className={`flex min-w-0 items-center cursor-pointer rounded px-1 ${isSelected ? 'bg-codemirror-select' : isRoot && isDatapackDisabled ? 'bg-rose-800/20 hover:bg-rose-800/30' : 'hover:bg-codemirror-highlight'} ${isDragOverTarget ? 'bg-cyan-800/20 ring-2 ring-cyan-300/80 ring-inset' : ''} ${isRoot ? 'py-2' : ''}`}
            style={{ paddingLeft: padding, opacity: isDraggingSource ? 0.1 : 1 }}
            onClick={() => handleSelect(pathKey, !!node.isFile, !!hasChildren)}
            onDoubleClick={() => handleDoubleClick(pathKey, !!node.isFile)}
            onContextMenu={(e) => handleRightClick(e, node, pathKey)}
            draggable={!isRoot}
            onDragStart={(event) => {
              event.stopPropagation()
              const actualPath = getActualPath(pathKey)
              if (!actualPath) {
                event.preventDefault()
                return
              }

              const payload: TreeDragPayload = {
                fullPath: normalizePath(actualPath),
                name: node.name,
                isFile: !!node.isFile,
              }
              setDraggingSourcePathKey(pathKey)
              activeTreeDragPayload = payload
              event.dataTransfer.setData(TREE_DRAG_PAYLOAD_MIME, JSON.stringify(payload))
              event.dataTransfer.setData('text/plain', payload.fullPath)
              event.dataTransfer.effectAllowed = 'move'
            }}
            onDragEnd={() => {
              // No stopPropagation needed on dragend; this only clears local drag state.
              activeTreeDragPayload = null
              setDraggingSourcePathKey(null)
              setDragOverPathKey(null)
              setDragBlockedPathKey(null)
              clearHoverExpandTimers(true)
            }}
            onDragOver={(event) => {
              if (hasTreeDragPayload(event)) {
                event.stopPropagation()
              }
              handleDragOverForNode(event, pathKey, !!node.isFile, !!hasChildren, !!isExpanded)
            }}
            onDragLeave={(event) => {
              if (hasTreeDragPayload(event)) {
                event.stopPropagation()
              }
            }}
            onDrop={(event) => {
              if (hasTreeDragPayload(event)) {
                event.stopPropagation()
              }
              void handleDropOnNode(event, pathKey, !!node.isFile)
            }}
          >
            {/* Chevron */}
            <div className="mr-2 flex items-center text-codemirror-100">
              {hasChildren ? (
                isExpanded ? (
                  <i className="codicon codicon-chevron-down" />
                ) : (
                  <i className="codicon codicon-chevron-right" />
                )
              ) : (
                <i className={`codicon ${languageIconClass}`} />
              )}
            </div>

            {/* Contents */}
            <div className="flex flex-1 gap-x-2 mr-1 items-center min-w-0 overflow-hidden">

              {/* Datapack ID */}
              {isRoot ? (
                <div className={`pillbox px-2.5 pt-1 pb-0.5
                ${isDatapackDisabled ? 'bg-red-800' : 'bg-emerald-800'}
                text-sm font-mono font-bold text-codemirror-50`}>
                  {rootId || 'ID'}
                </div>
              ) : (<div></div>)}

              <div className="flex flex-col min-w-0">

                <div className="flex flex-1 gap-x-2 items-center">
                  {/* Name */}
                  <span className={`truncate
                    ${nodeNameWeightClass} ${nodeNameColorClass} ${nodeNameStyleClass}`}
                  >
                    {isRoot ? rootName || node.name : node.name}
                  </span>

                  {/* Pillboxes */}
                  {isRoot && rootPackVersion && (
                    <span className="pillbox bg-indigo-800 text-indigo-100">
                      v{rootPackVersion}
                    </span>
                  )}
                  {isRoot && node.packFormatVersion && (
                    <span className="pillbox">
                      {node.packFormatVersion}
                    </span>
                  )}
                  {node.contentType && (
                    <span className="pillbox">
                      {node.contentType}
                    </span>
                  )}
                  {node.experimental && (
                    <span className="pillbox bg-yellow-900 text-yellow-400">
                      exp
                    </span>
                  )}

                </div>
                
                {/* Second row for root node information */}
                {isRoot && (
                  <div className="mt-0.5 flex max-h-16 min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5 overflow-y-auto pr-1">
                    {isDatapackDisabled && (
                      <span className="pillbox bg-rose-700 text-rose-50">
                        disabled
                      </span>
                    )}
                    {sortedRootTags.map((tag) => (
                      <span key={tag} className="pillbox
                      bg-codemirror-400 text-codemirror-50
                      max-w-24 truncate">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

              </div>
            </div>

            {/* Indicators: Aligned right */}
            <div className="ml-auto flex shrink-0 items-center">
              {hasDiagnosticError && (
                <i className="codicon codicon-error text-red-400 ml-1 shrink-0" />
              )}
              {hasDiagnosticWarning && (
                <i className="codicon codicon-warning text-amber-400 ml-1 shrink-0" />
              )}
              {isModified && (
                <i className="codicon codicon-circle-filled text-orange-300 ml-1 shrink-0" />
              )}
            </div>

          </div>
        </Tooltip>
        {hasChildren && isExpanded && (
          <ul
            className="mt-1 space-y-1"
            data-tree-children-of={pathKey}
            onDragOver={(event) => {
              handleDragOverForFolderGap(event, pathKey)
            }}
            onDrop={(event) => {
              void handleDropOnFolderGap(event, pathKey)
            }}
          >
            {sortChildren(node.children!).map((child) =>
              renderNode(child, depth + 1, `${pathKey}/${child.name}`)
            )}
          </ul>
        )}
      </li>
    )
  }

  return (
    <>
      <div
        ref={treeContainerRef}
        tabIndex={0}
        className={`${className} overflow-x-hidden overflow-y-auto focus:outline-none ${isDatapackDisabled ? 'bg-red-800/10 hover:bg-red-800/20' : ''}`}
        onMouseDown={(event) => {
          event.currentTarget.focus({ preventScroll: true })
        }}
        onWheelCapture={() => {
          // Allow users to interrupt the current smooth reveal by scrolling.
          suppressRevealForCurrentNonceRef.current = true
        }}
        onKeyDown={(event) => {
          void handleTreeKeyDown(event)
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.matches(':hover')) {
            return
          }

          const relatedTarget = event.relatedTarget as Node | null
          if (relatedTarget && event.currentTarget.contains(relatedTarget)) {
            return
          }
          setDragOverPathKey(null)
          setDragBlockedPathKey(null)
          clearHoverExpandTimers(true)
        }}
      >
        {isDragHoverCountdownActive && dragHoverCursor && ReactDOM.createPortal(
          <div
            className="fixed pointer-events-none"
            style={{ left: dragHoverCursor.x - 12, top: dragHoverCursor.y - 12, zIndex: 2147483647 }}
          >
            <CircleTimer
              elapsed={dragHoverCountdownElapsedMs}
              total={HOVER_EXPAND_COUNTDOWN_MS}
              size={40}
              thickness={4}
              reverse={true}
              progressClassName="text-cyan-300"
              trackClassName="text-codemirror-500"
            />
          </div>,
          document.body,
        )}
        <ul
          className="space-y-1"
          data-tree-children-of={tree.name}
          onDragOver={(event) => {
            handleDragOverForFolderGap(event, tree.name)
          }}
          onDrop={(event) => {
            void handleDropOnFolderGap(event, tree.name)
          }}
        >
          {renderNode(tree, 0, tree.name)}
        </ul>
      </div>
    </>
  )
}
