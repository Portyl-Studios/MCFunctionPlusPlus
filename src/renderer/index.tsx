import React, { useEffect, useRef, useState } from "react"
import ReactDOM from "react-dom/client"

import { EditorState, Transaction } from "@codemirror/state"
import {
  EditorView,
  keymap,
  highlightActiveLine,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  lineNumbers,
  highlightActiveLineGutter,
} from "@codemirror/view"
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { foldGutter, foldKeymap, indentOnInput, syntaxHighlighting, defaultHighlightStyle, bracketMatching } from "@codemirror/language"
import { closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete"
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search"
import { forceLinting, lintKeymap } from "@codemirror/lint"
import { portylDarkTheme } from "./themes/portyl-dark"
import "./index.css"
import { ResizeHandle, useResizableSection } from "./section"
import { Panel, type PanelTab } from "./panel"
import { DropdownMenu, type MenuItem } from "./dropdownmenu"
import { useWorkspace } from "./use-workspace"
import iconPath from "../../assets/icon.png"
import packageJson from "../../package.json"
import { DatapackTree } from "./datapacktree"
import { Dialog } from "./overlays/dialog"
import { useDialogRequest } from "./overlays/dialog-request"
import { subscribeDialogRequests } from "./overlays/dialog-events"
import { showToastEvent } from "./overlays/toast-events"
import { ToastStack } from "./overlays/toast"
import { ContextMenu } from "./overlays/contextmenu"
import { useContextMenuRequest } from "./overlays/contextmenu-request"
import {
  getDirFromPath,
  toRelativePaths,
  createFileKey,
  parseFileKey,
  getPathLeafName,
  getPathSegments,
  normalizePathSeparators,
  trimLeadingSlashes,
} from "./utils"
import {
  clearDatapackContextIndexes,
  loadMcfunctionCommandSchema,
  loadMinecraftData,
  mergeMcfunctionContextIndexes,
  parseMcfunctionContextIndex,
  resolveDatapackObjectiveBindings,
  pruneDatapackContextIndexes,
  setActiveDatapackContext,
  setDatapackContextIndex,
  setWorkspaceResourcePathsFromRelativePaths,
} from "./mcfunction-language"
import { detectEditorLanguage, getLanguageProcessingExtensions, type DiagnosticSummary } from "./language-handler"
import { runGlobalDiagnosticsScan } from "./diagnostics/global-diagnostics"
import { Tooltip } from "./overlays/tooltip"
import { useExternalFileWatcher } from "./use-external-file-watcher"
import { useAppUpdate } from "./use-app-update"
import { deletePathWithConfirm, renamePathWithPrompt } from "./path-actions"
import type { MinecraftDataEnsureProgress, MinecraftVersionEntry, ShortcutAction } from "../main/electron-api"
import type { AppPreferences } from "../main/preferences"
import datapackSchemaHistory from "../../resources/datapack-schema/history.json"
import { compareDottedVersions, isDottedNumericVersion } from "../shared/utils"
import { PreferencesPanel } from "./preferences-panel"
import { defaultPreferencesSchema } from "./default-preferences-schema"
import { DatapackInspectorPanel } from "./datapack-inspector-panel"

const FALLBACK_MINECRAFT_VERSION = "26.1.2"

type DatapackEntry = {
  dir: string
  name: string
  paths: string[]
  version?: number
  id?: string
  displayName?: string
  packVersion?: string
  minecraftVersion?: string
  lastOpened?: string
  author?: string
  description?: string
  packFormatVersionMin?: number
  packFormatVersionMax?: number
  tags?: string[]
}

type DatapackSchemaHistoryEntry = {
  minVersion?: string | null
  maxVersion?: string | null
}

type MinecraftBatchProgressStatus = 'queued' | 'running' | 'completed' | 'cached' | 'failed'

type MinecraftBatchProgressEntry = {
  percent: number
  message: string
  status: MinecraftBatchProgressStatus
}

const isDatapackEntryDisabled = (entry: DatapackEntry): boolean => {
  const hasEnabledMcmeta = entry.paths.some(
    (path) => path.replace(/\\/g, "/").replace(/^\/+/, "") === "pack.mcmeta",
  )
  const hasDisabledMcmeta = entry.paths.some(
    (path) => path.replace(/\\/g, "/").replace(/^\/+/, "") === "pack.mcmeta.disabled",
  )
  return hasDisabledMcmeta && !hasEnabledMcmeta
}

type OpenedFile = {
  datapackDir: string
  relativePath: string
  fileName: string
  content: string
  isModified?: boolean
}

type WorkspaceTabSessionFile = {
  datapackDir: string
  relativePath: string
}

type WorkspaceTabSession = {
  openedFiles: WorkspaceTabSessionFile[]
  activeFile: string | null
}

type ParsedContextCacheEntry = {
  content: string
  contextIndex: ReturnType<typeof parseMcfunctionContextIndex>
}

type TitlebarAppRegion = "drag" | "no-drag"
type TitlebarAppRegionStyle = React.CSSProperties & { WebkitAppRegion: TitlebarAppRegion }

const OPEN_TABS_PREFERENCE_KEY = "openTabs"
const EXPLORER_EXPANDED_PREFERENCE_KEY = "explorerExpandedPaths"
const EXPLORER_TAG_FILTER_PREFERENCE_KEY = "explorerTagFilter"
const MINECRAFT_FILTER_PREF_KEY = "minecraft"
const DATAPACK_INTRODUCED_RELEASE_TIME_MS = Date.parse("2018-07-18T00:00:00.000Z")
const INSPECTOR_SECTION_EXPANDED_PREFERENCE_KEY = "inspectorSectionExpanded"

type CursorMarkerInfo = {
  line: number
  column: number
  selectedCharacters: number
}

const defaultCursorMarkerInfo: CursorMarkerInfo = {
  line: 1,
  column: 1,
  selectedCharacters: 0,
}

const defaultDiagnosticSummary: DiagnosticSummary = {
  errors: 0,
  warnings: 0,
}

const EMPTY_EXPANDED_PATHS = new Set<string>()
const DATAPACK_DRAG_PAYLOAD_MIME = "application/x-mcpp-datapack-entry"
const TREE_DRAG_PAYLOAD_MIME = "application/x-mcpp-tree-entry"
const DEFAULT_MINECRAFT_BOOTSTRAP_MESSAGE = 'Checking local cache and preparing source data if needed.'
const datapackSchemaHistoryEntries = datapackSchemaHistory as Record<string, DatapackSchemaHistoryEntry>
const TITLEBAR_DRAG_STYLE: TitlebarAppRegionStyle = { WebkitAppRegion: "drag" }
const TITLEBAR_NO_DRAG_STYLE: TitlebarAppRegionStyle = { WebkitAppRegion: "no-drag" }

const comparePackFormatVersions = (left: string, right: string): number => {
  if (isDottedNumericVersion(left) && isDottedNumericVersion(right)) {
    return compareDottedVersions(left, right)
  }

  return left.localeCompare(right)
}

const sortedHistoryPackFormats = Object.keys(datapackSchemaHistoryEntries).sort((left, right) => {
  return comparePackFormatVersions(right, left)
})

const resolvePackFormatFromMinecraftVersion = (minecraftVersion?: string): string | undefined => {
  const normalizedMinecraftVersion = minecraftVersion?.trim()
  if (!normalizedMinecraftVersion || !isDottedNumericVersion(normalizedMinecraftVersion)) {
    return undefined
  }

  for (const packFormat of sortedHistoryPackFormats) {
    const entry = datapackSchemaHistoryEntries[packFormat]
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
      return packFormat
    }
  }

  return undefined
}

const createInitialBatchProgressEntry = (): MinecraftBatchProgressEntry => ({
  percent: 0,
  message: 'Queued',
  status: 'queued',
})

const normalizeInspectorTabId = (tabId: string): string => tabId === "settings" ? "inspector" : tabId

const normalizeInspectorTabIds = (tabIds: Iterable<string>): string[] => {
  const normalized = new Set<string>()

  for (const tabId of tabIds) {
    normalized.add(normalizeInspectorTabId(tabId))
  }

  return Array.from(normalized)
}

const parseDatapackMetadataRecord = async (datapackDir: string): Promise<Record<string, unknown> | null> => {
  try {
    const metadataRaw = await window.electron.readFile(datapackDir, ".mpp-datapack")
    const parsed = JSON.parse(metadataRaw)

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null
    }

    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

const parseReleaseVersionId = (versionId: string): { major: number; minor: number } | null => {
  const normalized = versionId.trim()
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(normalized)) {
    return null
  }

  const [majorRaw, minorRaw] = normalized.split('.')
  const major = Number.parseInt(majorRaw, 10)
  const minor = Number.parseInt(minorRaw, 10)
  if (!Number.isFinite(major) || !Number.isFinite(minor)) {
    return null
  }

  return { major, minor }
}

const isDatapackEraVersion = (entry: MinecraftVersionEntry): boolean => {
  if (typeof entry.releaseTime === 'string') {
    const releaseTimeMs = Date.parse(entry.releaseTime)
    if (Number.isFinite(releaseTimeMs)) {
      return releaseTimeMs >= DATAPACK_INTRODUCED_RELEASE_TIME_MS
    }
  }

  const parsedVersion = parseReleaseVersionId(entry.id)
  if (!parsedVersion) return false

  return parsedVersion.major > 1 || (parsedVersion.major === 1 && parsedVersion.minor >= 13)
}

const getCursorMarkerInfo = (state: EditorState): CursorMarkerInfo => {
  const selection = state.selection.main
  const startPosition = selection.from
  const line = state.doc.lineAt(startPosition)

  return {
    line: line.number,
    column: startPosition - line.from + 1,
    selectedCharacters: selection.to - selection.from,
  }
}

const codeMirrorSetupExtensions = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  foldGutter(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  bracketMatching(),
  closeBrackets(),
  rectangularSelection(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  keymap.of([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...completionKeymap,
    ...lintKeymap,
    indentWithTab,
  ]),
]

function CodeEditor() {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  
  // Section dimensions state (controlled by preferences)
  const [leftPanelWidth, setLeftPanelWidth] = useState(350)
  const [rightPanelWidth, setRightPanelWidth] = useState(350)
  const [bottomPanelHeight, setBottomPanelHeight] = useState(250)
  
  const leftSection = useResizableSection({ 
    position: "left",
    width: leftPanelWidth,
    onWidthChange: setLeftPanelWidth
  })
  const rightSection = useResizableSection({ 
    position: "right",
    width: rightPanelWidth,
    onWidthChange: setRightPanelWidth
  })
  const bottomSection = useResizableSection({ 
    position: "bottom",
    height: bottomPanelHeight,
    onHeightChange: setBottomPanelHeight
  })
  
  const [activeLeftTabId, setActiveLeftTabId] = useState("explorer")
  const [activeRightTabId, setActiveRightTabId] = useState("preferences")
  const [activeBottomTabId, setActiveBottomTabId] = useState("debug")
  const [isDevMode, setIsDevMode] = useState(false)
  const appVersionLabel = `v${packageJson.version}${isDevMode ? " (dev)" : ""}`
  const [minecraftVersionOptions, setMinecraftVersionOptions] = useState<MinecraftVersionEntry[]>([])
  const [isMinecraftVersionMenuOpen, setIsMinecraftVersionMenuOpen] = useState(false)
  const [hideSnapshotVersions, setHideSnapshotVersions] = useState(true)
  const isRestoringMinecraftFilterRef = useRef(false)
  
  // Preferences state
  const [appPreferences, setAppPreferences] = useState<AppPreferences>({})
  const [isPreferencesLoading, setIsPreferencesLoading] = useState(true)

  const loadPreferences = async () => {
    const [panels, windowPreferences, updates, workspace, minecraft] = await Promise.all([
      window.electron.preferencesGet('panels'),
      window.electron.preferencesGet('window'),
      window.electron.preferencesGet('updates'),
      window.electron.preferencesGet('workspace'),
      window.electron.preferencesGet('minecraft'),
    ])

    setAppPreferences({
      panels,
      window: windowPreferences,
      updates,
      workspace,
      minecraft,
    })
    // Keep the UI filter state in sync with loaded preferences
    if (minecraft && typeof minecraft.hideSnapshotsInVersionMenu === 'boolean') {
      setHideSnapshotVersions(minecraft.hideSnapshotsInVersionMenu)
    }
  }

  useEffect(() => {
    let isDisposed = false
    void window.electron.isDevMode().then((value) => {
      if (!isDisposed) {
        setIsDevMode(value)
      }
    }).catch(() => {
      if (!isDisposed) {
        setIsDevMode(false)
      }
    })

    return () => {
      isDisposed = true
    }
  }, [])

  // Load all preferences on mount
  useEffect(() => {
    const loadAllPreferences = async () => {
      try {
        await loadPreferences()
      } catch (error) {
        console.error('Failed to load preferences:', error)
      } finally {
        setIsPreferencesLoading(false)
      }
    }

    void loadAllPreferences()
  }, [])

  // Handler for preference changes
  const handlePreferenceChange = async (sectionId: string, fieldKey: string, value: unknown) => {
    try {
      // Persist to backend: fetch authoritative section first to avoid overwriting other fields
      const currentSection = await window.electron.preferencesGet(sectionId as keyof AppPreferences)
      const merged = {
        ...(currentSection && typeof currentSection === 'object' ? currentSection : {}),
        [fieldKey]: value,
      }

      await window.electron.preferencesSet(sectionId as any, merged)

      const refreshedSection = await window.electron.preferencesGet(sectionId as keyof AppPreferences)
      setAppPreferences(prev => ({
        ...prev,
        [sectionId]: refreshedSection,
      }))
      // If the minecraft section changed, update UI filter state too
      if (sectionId === 'minecraft' && refreshedSection && typeof (refreshedSection as any).hideSnapshotsInVersionMenu === 'boolean') {
        setHideSnapshotVersions((refreshedSection as any).hideSnapshotsInVersionMenu)
      }
    } catch (error) {
      console.error('Failed to save preference:', error)
      showToastEvent(`Failed to save preference: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  useEffect(() => {
    const unsubscribe = window.electron.onPreferencesChanged(async ({ keys }) => {
      try {
        if (!keys.length) {
          await loadPreferences()
          return
        }

        const uniqueKeys = [...new Set(keys)]

        for (const key of uniqueKeys) {
          const section = await window.electron.preferencesGet(key as keyof AppPreferences)
          setAppPreferences((prev) => {
            switch (key) {
              case 'panels':
                return { ...prev, panels: section as AppPreferences['panels'] }
              case 'window':
                return { ...prev, window: section as AppPreferences['window'] }
              case 'updates':
                return { ...prev, updates: section as AppPreferences['updates'] }
              case 'workspace':
                return { ...prev, workspace: section as AppPreferences['workspace'] }
              case 'minecraft':
                // update both preferences and the UI filter state
                if (section && typeof (section as any).hideSnapshotsInVersionMenu === 'boolean') {
                  setHideSnapshotVersions((section as any).hideSnapshotsInVersionMenu)
                }
                return { ...prev, minecraft: section as AppPreferences['minecraft'] }
              default:
                return prev
            }
          })
        }
      } catch (error) {
        console.error('Failed to refresh preferences after save:', error)
      }
    })

    return () => {
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const restoreMinecraftFilterPreference = async () => {
      isRestoringMinecraftFilterRef.current = true
      try {
        const saved = await window.electron.preferencesGet(MINECRAFT_FILTER_PREF_KEY)
        const maybeMinecraft = saved as { hideSnapshotsInVersionMenu?: unknown } | undefined
        if (typeof maybeMinecraft?.hideSnapshotsInVersionMenu === 'boolean') {
          setHideSnapshotVersions(maybeMinecraft.hideSnapshotsInVersionMenu)
        } else {
          setHideSnapshotVersions(true)
        }
      } catch (error) {
        console.error('Failed to restore Minecraft version filter preference:', error)
        setHideSnapshotVersions(true)
      } finally {
        isRestoringMinecraftFilterRef.current = false
      }
    }

    void restoreMinecraftFilterPreference()
  }, [])

  useEffect(() => {
    if (isRestoringMinecraftFilterRef.current) return

    const persistMinecraftFilterPreference = async () => {
      try {
        const currentMinecraftPrefs = await window.electron.preferencesGet(MINECRAFT_FILTER_PREF_KEY)
        await window.electron.preferencesSet(MINECRAFT_FILTER_PREF_KEY, {
          ...(currentMinecraftPrefs && typeof currentMinecraftPrefs === 'object' ? currentMinecraftPrefs : {}),
          hideSnapshotsInVersionMenu: hideSnapshotVersions,
        })
      } catch (error) {
        console.error('Failed to save Minecraft version filter preference:', error)
      }
    }

    void persistMinecraftFilterPreference()
  }, [hideSnapshotVersions])

  const minecraftVersionMenuItems = React.useMemo<MenuItem[]>(() => {
    const datapackEraVersions = minecraftVersionOptions.filter(isDatapackEraVersion)
    const filteredVersions = hideSnapshotVersions
      ? datapackEraVersions.filter((entry) => entry.type !== 'snapshot')
      : datapackEraVersions

    const items: MenuItem[] = [
      {
        label: 'Hide Snapshots',
        toggleable: true,
        toggled: hideSnapshotVersions,
        onToggle: (nextState) => {
          setHideSnapshotVersions(nextState)
        },
      },
      {},
    ]

    if (minecraftVersionOptions.length === 0) {
      items.push({
        label: 'Loading available versions...',
        disabled: true,
      })
      return items
    }

    if (datapackEraVersions.length === 0) {
      items.push({
        label: 'No datapack-era versions available',
        disabled: true,
      })
      return items
    }

    if (filteredVersions.length === 0) {
      items.push({
        label: 'No versions visible (snapshots hidden)',
        disabled: true,
      })
      return items
    }

    for (const entry of filteredVersions) {
      items.push({
        label: entry.id,
        shortcut: entry.type,
        onClick: () => {
          void applyMinecraftVersionSelection(entry.id)
        },
      })
    }

    return items
  }, [hideSnapshotVersions, minecraftVersionOptions])

  const resolveDatapackForMinecraftVersionSelection = (): DatapackEntry | null => {
    const activeDatapackDir = activeFileRef.current ? parseFileKey(activeFileRef.current).datapackDir : null
    if (activeDatapackDir) {
      const activeDatapack = datapacksRef.current.find((entry) => entry.dir === activeDatapackDir)
      if (activeDatapack) {
        return activeDatapack
      }
    }

    return datapacksRef.current[0] ?? null
  }

  const getInspectorDatapack = (): DatapackEntry | null => {
    const activeDatapackDir = activeFile ? parseFileKey(activeFile).datapackDir : null
    if (activeDatapackDir) {
      const activeDatapack = datapacks.find((entry) => entry.dir === activeDatapackDir)
      if (activeDatapack) {
        return activeDatapack
      }
    }

    return datapacks[0] ?? null
  }

  const applyMinecraftVersionSelection = async (version: string) => {
    const targetDatapack = resolveDatapackForMinecraftVersionSelection()
    if (!targetDatapack) {
      await dialog.showAlert('No Datapack Selected', 'Open a datapack first to set and persist its Minecraft version.')
      return
    }

    const normalizedVersion = version.trim()
    if (!normalizedVersion) {
      return
    }

    const currentVersion = targetDatapack.minecraftVersion?.trim() || FALLBACK_MINECRAFT_VERSION
    if (currentVersion === normalizedVersion) {
      return
    }

    // Open loading overlay immediately while preflighting selected version.
    setMinecraftDataBootstrapTargetVersion(normalizedVersion)
    setMinecraftDataBootstrapProgressPercent(5)
    setMinecraftDataBootstrapProgressMessage(`Checking local cache for Minecraft ${normalizedVersion}...`)
    setIsMinecraftDataBootstrapOpen(true)

    try {
      // Ensure selected version can be prepared before persisting metadata.
      await window.electron.minecraftDataEnsure(normalizedVersion)
      const resolvedPackFormat = resolvePackFormatFromMinecraftVersion(normalizedVersion)
      const nextPackFormatVersionMax = resolvedPackFormat ? Number.parseFloat(resolvedPackFormat) : undefined

      const metadataRaw = await window.electron.readFile(targetDatapack.dir, '.mpp-datapack')
      const parsed = JSON.parse(metadataRaw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Invalid datapack metadata format')
      }

      const nextMetadata = {
        ...parsed,
        minecraftVersion: normalizedVersion,
        ...(typeof nextPackFormatVersionMax === 'number' && Number.isFinite(nextPackFormatVersionMax)
          ? { packFormatVersionMax: nextPackFormatVersionMax }
          : {}),
      }

      await window.electron.writeFile(targetDatapack.dir, '.mpp-datapack', JSON.stringify(nextMetadata, null, 2))

      setDatapacks((prev) => prev.map((entry) => (
        entry.dir === targetDatapack.dir
          ? {
              ...entry,
              minecraftVersion: normalizedVersion,
              ...(typeof nextPackFormatVersionMax === 'number' && Number.isFinite(nextPackFormatVersionMax)
                ? { packFormatVersionMax: nextPackFormatVersionMax }
                : {}),
            }
          : entry
      )))
    } catch (error) {
      setIsMinecraftDataBootstrapOpen(false)
      console.error('Failed to apply datapack Minecraft version:', error)
      await dialog.showAlert('Minecraft Version Not Applied', `${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  useEffect(() => {
    let isDisposed = false

    void (async () => {
      try {
        const versions = await window.electron.minecraftVersionsGet()
        if (!isDisposed) {
          setMinecraftVersionOptions(Array.isArray(versions) ? versions : [])
        }
      } catch (error) {
        console.error('Failed to load Minecraft versions:', error)
        if (!isDisposed) {
          setMinecraftVersionOptions([])
        }
      }
    })()

    return () => {
      isDisposed = true
    }
  }, [])
  
  // Panel tab visibility state
  const [visibleLeftPanelTabs, setVisibleLeftPanelTabs] = useState<Set<string>>(new Set(["explorer"]))
  const [visibleRightPanelTabs, setVisibleRightPanelTabs] = useState<Set<string>>(new Set(["preferences", "inspector"]))
  const [visibleBottomPanelTabs, setVisibleBottomPanelTabs] = useState<Set<string>>(new Set(["debug"]))

  // Panel tab order state
  const [leftPanelTabOrder, setLeftPanelTabOrder] = useState<string[]>(["explorer"])
  const [rightPanelTabOrder, setRightPanelTabOrder] = useState<string[]>(["preferences", "inspector"])
  const [bottomPanelTabOrder, setBottomPanelTabOrder] = useState<string[]>(["debug"])

  const notifyPanelPreferencesError = (operation: 'load' | 'save', error: unknown) => {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const normalizedErrorMessage = errorMessage.trim() || 'Unknown error'
    const operationLabel = operation === 'load' ? 'load' : 'save'
    showToastEvent(`Panel preferences ${operationLabel} failed: ${normalizedErrorMessage}`)
  }
  
  // Toggle handlers for each panel
  const handleToggleLeftTab = (tabId: string, nextState?: boolean) => {
    setVisibleLeftPanelTabs(prev => {
      const newSet = new Set(prev)
      const shouldShow = typeof nextState === "boolean" ? nextState : !newSet.has(tabId)
      if (shouldShow) {
        newSet.add(tabId)
      } else {
        newSet.delete(tabId)
      }
      return newSet
    })
  }
  
  const handleToggleRightTab = (tabId: string, nextState?: boolean) => {
    setVisibleRightPanelTabs(prev => {
      const newSet = new Set(prev)
      const shouldShow = typeof nextState === "boolean" ? nextState : !newSet.has(tabId)
      if (shouldShow) {
        newSet.add(tabId)
      } else {
        newSet.delete(tabId)
      }
      return newSet
    })
  }
  
  const handleToggleBottomTab = (tabId: string, nextState?: boolean) => {
    setVisibleBottomPanelTabs(prev => {
      const newSet = new Set(prev)
      const shouldShow = typeof nextState === "boolean" ? nextState : !newSet.has(tabId)
      if (shouldShow) {
        newSet.add(tabId)
      } else {
        newSet.delete(tabId)
      }
      return newSet
    })
  }

  const reorderTabList = (order: string[], draggedId: string, targetId: string, position: "before" | "after" | "end") => {
    if (draggedId === targetId && position !== "end") return order
    const next = order.filter(id => id !== draggedId)
    if (position === "end") {
      next.push(draggedId)
      return next
    }
    const targetIndex = next.indexOf(targetId)
    if (targetIndex === -1) {
      next.push(draggedId)
    } else {
      const insertIndex = position === "after" ? targetIndex + 1 : targetIndex
      next.splice(insertIndex, 0, draggedId)
    }
    return next
  }

  const orderTabsByList = (tabs: PanelTab[], order: string[]) => {
    const indexMap = new Map(order.map((id, index) => [id, index]))
    return [...tabs].sort((a, b) => {
      const aIndex = indexMap.has(a.id) ? indexMap.get(a.id)! : Number.MAX_SAFE_INTEGER
      const bIndex = indexMap.has(b.id) ? indexMap.get(b.id)! : Number.MAX_SAFE_INTEGER
      return aIndex - bIndex
    })
  }

  const handleReorderLeftTab = (draggedId: string, targetId: string, position: "before" | "after" | "end") => {
    setLeftPanelTabOrder(prev => reorderTabList(prev, draggedId, targetId, position))
  }

  const handleReorderRightTab = (draggedId: string, targetId: string, position: "before" | "after" | "end") => {
    setRightPanelTabOrder(prev => reorderTabList(prev, draggedId, targetId, position))
  }

  const handleReorderBottomTab = (draggedId: string, targetId: string, position: "before" | "after" | "end") => {
    setBottomPanelTabOrder(prev => reorderTabList(prev, draggedId, targetId, position))
  }

  // Load panel preferences on mount
  useEffect(() => {
    const loadPanelPreferences = async () => {
      try {
        const panelPrefs = await window.electron.preferencesGet('panels')
        if (panelPrefs) {
          if (panelPrefs.leftPanelTabOrder) setLeftPanelTabOrder(panelPrefs.leftPanelTabOrder)
          if (panelPrefs.rightPanelTabOrder) setRightPanelTabOrder(normalizeInspectorTabIds(panelPrefs.rightPanelTabOrder))
          if (panelPrefs.bottomPanelTabOrder) setBottomPanelTabOrder(panelPrefs.bottomPanelTabOrder)
          if (panelPrefs.visibleLeftPanelTabs) setVisibleLeftPanelTabs(new Set(panelPrefs.visibleLeftPanelTabs))
          if (panelPrefs.visibleRightPanelTabs) setVisibleRightPanelTabs(new Set(normalizeInspectorTabIds(panelPrefs.visibleRightPanelTabs)))
          if (panelPrefs.visibleBottomPanelTabs) setVisibleBottomPanelTabs(new Set(panelPrefs.visibleBottomPanelTabs))
          if (panelPrefs.activeLeftTabId) setActiveLeftTabId(panelPrefs.activeLeftTabId)
          if (panelPrefs.activeRightTabId) setActiveRightTabId(normalizeInspectorTabId(panelPrefs.activeRightTabId))
          if (panelPrefs.activeBottomTabId) setActiveBottomTabId(panelPrefs.activeBottomTabId)
          if (panelPrefs.leftPanelWidth) setLeftPanelWidth(panelPrefs.leftPanelWidth)
          if (panelPrefs.rightPanelWidth) setRightPanelWidth(panelPrefs.rightPanelWidth)
          if (panelPrefs.bottomPanelHeight) setBottomPanelHeight(panelPrefs.bottomPanelHeight)
        }
      } catch (error) {
        console.error('Failed to load panel preferences:', error)
        notifyPanelPreferencesError('load', error)
      }
    }

    loadPanelPreferences()
  }, [])

  // Save panel preferences when they change
  useEffect(() => {
    const savePanelPreferences = async () => {
      try {
        await window.electron.preferencesSet('panels', {
          leftPanelTabOrder,
          rightPanelTabOrder,
          bottomPanelTabOrder,
          visibleLeftPanelTabs: Array.from(visibleLeftPanelTabs),
          visibleRightPanelTabs: Array.from(visibleRightPanelTabs),
          visibleBottomPanelTabs: Array.from(visibleBottomPanelTabs),
          activeLeftTabId,
          activeRightTabId,
          activeBottomTabId,
          leftPanelWidth,
          rightPanelWidth,
          bottomPanelHeight,
        })
      } catch (error) {
        console.error('Failed to save panel preferences:', error)
        notifyPanelPreferencesError('save', error)
      }
    }

    savePanelPreferences()
  }, [
    leftPanelTabOrder,
    rightPanelTabOrder,
    bottomPanelTabOrder,
    visibleLeftPanelTabs,
    visibleRightPanelTabs,
    visibleBottomPanelTabs,
    activeLeftTabId,
    activeRightTabId,
    activeBottomTabId,
    leftPanelWidth,
    rightPanelWidth,
    bottomPanelHeight,
  ])
  
  // Right section menu items based on active tab
  const getRightMenuItems = (): MenuItem[] => {
    if (activeRightTabId === "preferences") {
      return [
        { label: "Preferences Option", onClick: undefined }
      ]
    } else if (activeRightTabId === "inspector") {
      return [
        { label: "Inspector Option", onClick: undefined }
      ]
    }
    return []
  }
  
  const [datapacks, setDatapacks] = useState<DatapackEntry[]>([])
  const [selectedExplorerTags, setSelectedExplorerTags] = useState<Set<string>>(new Set())
  const [explorerTagMatchMode, setExplorerTagMatchMode] = useState<"any" | "exact">("any")
  const [isExplorerTagFilterMenuOpen, setIsExplorerTagFilterMenuOpen] = useState(false)
  const [isHeaderMenuOneOpen, setIsHeaderMenuOneOpen] = useState(false)
  const [isHeaderMenuTwoOpen, setIsHeaderMenuTwoOpen] = useState(false)
  const [isHeaderMenuThreeOpen, setIsHeaderMenuThreeOpen] = useState(false)
  const [isHeaderMenuFourOpen, setIsHeaderMenuFourOpen] = useState(false)
  const [isHeaderMenuFiveOpen, setIsHeaderMenuFiveOpen] = useState(false)
  const [isHeaderMenuSixOpen, setIsHeaderMenuSixOpen] = useState(false)
  const [isFullScreen, setIsFullScreen] = useState(false)
  const [openedFiles, setOpenedFiles] = useState<OpenedFile[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [minecraftDataVersion, setMinecraftDataVersion] = useState<string>(FALLBACK_MINECRAFT_VERSION)
  const [minecraftDataBootstrapTargetVersion, setMinecraftDataBootstrapTargetVersion] = useState<string>(FALLBACK_MINECRAFT_VERSION)
  const [isMinecraftDataBootstrapOpen, setIsMinecraftDataBootstrapOpen] = useState(false)
  const [minecraftDataBootstrapMode, setMinecraftDataBootstrapMode] = useState<'single' | 'multi'>('single')
  const [minecraftDataBootstrapProgressPercent, setMinecraftDataBootstrapProgressPercent] = useState(0)
  const [minecraftDataBootstrapProgressMessage, setMinecraftDataBootstrapProgressMessage] = useState(DEFAULT_MINECRAFT_BOOTSTRAP_MESSAGE)
  const [minecraftDataBootstrapBatchVersions, setMinecraftDataBootstrapBatchVersions] = useState<string[]>([])
  const [minecraftDataBootstrapBatchProgress, setMinecraftDataBootstrapBatchProgress] = useState<Record<string, MinecraftBatchProgressEntry>>({})
  const [previewFileKey, setPreviewFileKey] = useState<string | null>(null)
  const [modifiedFiles, setModifiedFiles] = useState<Set<string>>(new Set())
  const [fileDiagnosticSummaries, setFileDiagnosticSummaries] = useState<Record<string, DiagnosticSummary>>({})
  const [cursorMarkerInfo, setCursorMarkerInfo] = useState<CursorMarkerInfo>(defaultCursorMarkerInfo)
  const [diagnosticSummary, setDiagnosticSummary] = useState<DiagnosticSummary>(defaultDiagnosticSummary)
  const [inspectorContextRevision, setInspectorContextRevision] = useState(0)
  const [diagnosticRefreshStatus, setDiagnosticRefreshStatus] = useState({
    visible: false,
    percent: 0,
    label: 'Refreshing diagnostics...',
  })
  const tabsRef = useRef<HTMLDivElement>(null)
  const tabElementRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [isAutoSaveEnabled, setIsAutoSaveEnabled] = useState(false)
  const isRestoringTabsRef = useRef(false)
  const isRestoringExplorerRef = useRef(false)
  const isRestoringExplorerTagFilterRef = useRef(false)
  const lastSavedTabSessionSignatureRef = useRef("")
  const fileEditorStatesRef = useRef<Map<string, EditorState>>(new Map())
  const contextMenuRequest = useContextMenuRequest()
  
  // File tab drag-and-drop state
  const [draggingFileKey, setDraggingFileKey] = useState<string | null>(null)
  const [dragOverFileKey, setDragOverFileKey] = useState<string | null>(null)
  const [dragOverPosition, setDragOverPosition] = useState<"before" | "after" | null>(null)
  const dragGhostRef = useRef<HTMLDivElement | null>(null)

  // Datapack drag-and-drop state
  const [draggingDatapackDir, setDraggingDatapackDir] = useState<string | null>(null)
  const [dragOverDatapackDir, setDragOverDatapackDir] = useState<string | null>(null)
  const [dragOverDatapackPosition, setDragOverDatapackPosition] = useState<"before" | "after" | null>(null)
  const [isDragOverDatapackEndZone, setIsDragOverDatapackEndZone] = useState(false)
  const datapackDragGhostRef = useRef<HTMLDivElement | null>(null)

  const [explorerSelectedPathsByDatapack, setExplorerSelectedPathsByDatapack] = useState<Record<string, string | null>>({})
  const [explorerSelectedFileKeysByDatapack, setExplorerSelectedFileKeysByDatapack] = useState<Record<string, string | null>>({})
  const [explorerSelectionRevealNonceByDatapack, setExplorerSelectionRevealNonceByDatapack] = useState<Record<string, number>>({})
  const [explorerExpandedPathsByDatapack, setExplorerExpandedPathsByDatapack] = useState<Record<string, Set<string>>>({})
    const [inspectorSectionExpansionById, setInspectorSectionExpansionById] = useState<Record<string, boolean>>({})
  const explorerContainerRefs = useRef<Map<string, React.RefObject<HTMLDivElement | null>>>(new Map())
    const isRestoringInspectorSectionExpansionRef = useRef(false)
  
  // Refs are used to access current state values inside closures (e.g., editor listeners)
  // without triggering re-renders or stale closure issues
  const isAutoSaveEnabledRef = useRef(isAutoSaveEnabled)
  // Track auto-save timers per file using fileKey format: "datapackDir|relativePath"
  const autoSaveTimersRef = useRef<Map<string, number>>(new Map())
  const diagnosticsScanRunIdRef = useRef(0)
  const contextScanRunIdRef = useRef(0)
  const contextDiagnosticsPipelineRunIdRef = useRef(0)
  const contextRefreshRequestedVersionRef = useRef(0)
  const contextRefreshCompletedVersionRef = useRef(0)
  const contextReloadTimerRef = useRef<number | null>(null)
  const directoryRefreshTimerRef = useRef<number | null>(null)
  const directoryWatchIdsRef = useRef<Map<string, string>>(new Map())
  const didConsumeDatapackLaunchPathRef = useRef(false)
  const pendingExternalDatapackPathRef = useRef<string | null>(null)
  const fileContextParseCacheRef = useRef<Map<string, ParsedContextCacheEntry>>(new Map())
  const lastShownJavaVersionErrorRef = useRef<string | null>(null)
  const openFileRequestIdRef = useRef(0)
  const previewFileKeyRef = useRef<string | null>(null)
  const minecraftDataBootstrapRunIdRef = useRef(0)
  const dialog = useDialogRequest()
  const pendingBootstrapQuitDecisionRef = useRef<((confirmed: boolean) => void) | null>(null)
  const openDialogRef = useRef(dialog.openDialog)
  const isDialogOpenRef = useRef(dialog.isOpen)
  const isEditorFocusedRef = useRef(false)
  const openedFilesRef = useRef(openedFiles)
  const modifiedFilesRef = useRef(modifiedFiles)
  const fileDiagnosticSummariesRef = useRef(fileDiagnosticSummaries)
  const fileContextRefreshRequiredVersionRef = useRef<Map<string, number>>(new Map())
  const datapacksRef = useRef(datapacks)
  const workspaceDirRef = useRef<string | null>(null)
  const contextDiagnosticsIsRunningRef = useRef(false)
  const queuedContextDiagnosticsTargetRef = useRef<string | null | undefined>(undefined)
  const {
    workspaceInfo,
    handleOpenWorkspace,
    handleSaveWorkspaceAs,
    handleNewWorkspace,
    handleOpenDefaultWorkspace,
    handleGetDatapacks,
    handleSetDatapacks,
  } = useWorkspace()

  const {
    hasPendingAppUpdate,
    appUpdateTooltipContent,
    isManualUpdateCheckInProgress,
    handleManualUpdateCheck,
  } = useAppUpdate({
    dialog,
    modifiedFilesCount: modifiedFiles.size,
    saveAllFiles,
  })

  useEffect(() => {
    openDialogRef.current = dialog.openDialog
  }, [dialog.openDialog])

  useEffect(() => {
    if (isMinecraftDataBootstrapOpen) return
    if (!pendingBootstrapQuitDecisionRef.current) return

    const resolve = pendingBootstrapQuitDecisionRef.current
    pendingBootstrapQuitDecisionRef.current = null
    dialog.closeDialog()
    resolve(false)
  }, [isMinecraftDataBootstrapOpen, dialog])

  useEffect(() => {
    const unsubscribe = subscribeDialogRequests((config) => {
      openDialogRef.current(config)
    })

    return () => {
      unsubscribe()
    }
  }, [])

  const showMinecraftManifestSyncError = React.useCallback((errorMessage: string) => {
    openDialogRef.current({
      title: 'Minecraft Manifest Error',
      message: errorMessage,
      buttons: [
        {
          label: 'OK',
          onClick: () => undefined,
        },
      ],
    })
  }, [])

  useEffect(() => {
    let cancelled = false

    void window.electron.minecraftDefaultVersionSyncErrorGet().then((errorMessage) => {
      if (cancelled || !errorMessage) {
        return
      }

      showMinecraftManifestSyncError(errorMessage)
    })

    return () => {
      cancelled = true
    }
  }, [showMinecraftManifestSyncError])

  useEffect(() => {
    const unsubscribe = window.electron.onMinecraftDataEnsureProgress((progress: MinecraftDataEnsureProgress) => {
      if (minecraftDataBootstrapMode === 'multi') {
        setMinecraftDataBootstrapBatchProgress((prev) => {
          if (!(progress.version in prev)) {
            return prev
          }

          const nextStatus: MinecraftBatchProgressStatus = progress.stage === 'cache-hit'
            ? 'cached'
            : progress.stage === 'cache-ready'
              ? 'completed'
              : progress.percent >= 100
                ? 'completed'
                : 'running'

          return {
            ...prev,
            [progress.version]: {
              percent: progress.percent,
              message: progress.message || DEFAULT_MINECRAFT_BOOTSTRAP_MESSAGE,
              status: nextStatus,
            },
          }
        })
        return
      }

      if (progress.version !== minecraftDataBootstrapTargetVersion) {
        return
      }

      setMinecraftDataBootstrapProgressPercent(progress.percent)
      setMinecraftDataBootstrapProgressMessage(progress.message || DEFAULT_MINECRAFT_BOOTSTRAP_MESSAGE)
    })

    return () => {
      unsubscribe()
    }
  }, [minecraftDataBootstrapMode, minecraftDataBootstrapTargetVersion])

  // Load auto-save preference from workspace
  useEffect(() => {
    const loadAutoSavePreference = async () => {
      try {
        const savedValue = await window.electron.workspaceGetPreference("autoSave")
        if (typeof savedValue === "boolean") {
          setIsAutoSaveEnabled(savedValue)
        }
      } catch (error) {
        console.error("Failed to load auto-save preference:", error)
        await dialog.showAlert("Error", `Failed to load auto-save preference: ${error instanceof Error ? error.message : "Unknown error"}`)
      }
    }

    loadAutoSavePreference()
  }, [workspaceInfo.dir])

  // Save auto-save preference when it changes
  const toggleAutoSave = async (enabled: boolean) => {
    setIsAutoSaveEnabled(enabled)
    try {
      await window.electron.workspaceUpdatePreference("autoSave", enabled)
    } catch (error) {
      console.error("Failed to save auto-save preference:", error)
      await dialog.showAlert("Error", `Failed to save auto-save preference: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }

  const parseWorkspaceTabSession = (value: unknown): WorkspaceTabSession | null => {
    if (!value || typeof value !== "object") return null

    const maybeSession = value as { openedFiles?: unknown; activeFile?: unknown }
    if (!Array.isArray(maybeSession.openedFiles)) return null

    const openedFiles = maybeSession.openedFiles
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null
        const maybeFile = entry as { datapackDir?: unknown; relativePath?: unknown }
        if (typeof maybeFile.datapackDir !== "string" || typeof maybeFile.relativePath !== "string") {
          return null
        }
        return {
          datapackDir: maybeFile.datapackDir,
          relativePath: maybeFile.relativePath,
        }
      })
      .filter((entry): entry is WorkspaceTabSessionFile => !!entry)

    const activeFile = typeof maybeSession.activeFile === "string"
      ? maybeSession.activeFile
      : null

    return {
      openedFiles,
      activeFile,
    }
  }

  const parseWorkspaceExplorerExpanded = (value: unknown): Record<string, Set<string>> | null => {
    if (!value || typeof value !== "object") return null
    const entries = value as Record<string, unknown>
    const next: Record<string, Set<string>> = {}
    for (const [dir, paths] of Object.entries(entries)) {
      if (!Array.isArray(paths)) continue
      const filtered = paths.filter((item) => typeof item === "string") as string[]
      next[dir] = new Set(filtered)
    }
    return next
  }

  const parseWorkspaceExplorerTagFilter = (value: unknown): { selectedTags: Set<string>; matchAny: boolean } | null => {
    if (!value || typeof value !== "object") return null

    const maybeFilter = value as { selectedTags?: unknown; matchAny?: unknown }
    const selectedTagsRaw = Array.isArray(maybeFilter.selectedTags) ? maybeFilter.selectedTags : []
    const selectedTags = new Set(
      selectedTagsRaw
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim().toLowerCase())
        .filter((tag) => tag.length > 0),
    )

    return {
      selectedTags,
      matchAny: maybeFilter.matchAny !== false,
    }
  }

  const parseWorkspaceInspectorSectionExpansion = (value: unknown): Record<string, boolean> | null => {
    if (!value || typeof value !== "object") return null

    const entries = value as Record<string, unknown>
    const next: Record<string, boolean> = {}
    for (const [sectionId, isExpanded] of Object.entries(entries)) {
      if (typeof isExpanded !== "boolean") continue
      next[sectionId] = isExpanded
    }

    return next
  }

  const loadDatapackEntry = async (datapackDir: string): Promise<DatapackEntry | null> => {
    try {
      const initialFiles = await window.electron.listFiles(datapackDir)
      let paths = Array.isArray(initialFiles) ? initialFiles : []

      const hasMetaFile = paths.some((entry) => entry.replace(/\\/g, '/').endsWith('/.mpp-datapack') || entry.replace(/\\/g, '/').endsWith('.mpp-datapack'))
      const hasPackMcmeta = paths.some((entry) => {
        const normalizedEntry = entry.replace(/\\/g, '/').toLowerCase()
        return normalizedEntry.endsWith('/pack.mcmeta') || normalizedEntry.endsWith('/pack.mcmeta.disabled')
      })

      if (!hasMetaFile && hasPackMcmeta) {
        try {
          const ensureResult = await window.electron.ensureDatapackMetadata(datapackDir)
          if (ensureResult?.created) {
            const refreshedFiles = await window.electron.listFiles(datapackDir)
            paths = Array.isArray(refreshedFiles) ? refreshedFiles : paths
          }
        } catch (error) {
          console.warn('Failed to auto-create datapack metadata while loading workspace entry:', error)
        }
      }

      const name = getPathLeafName(datapackDir) || "datapack"
      let version: number | undefined
      let id: string | undefined
      let displayName: string | undefined
      let packVersion: string | undefined
      let minecraftVersion: string | undefined
      let lastOpened: string | undefined
      let author: string | undefined
      let description: string | undefined
      let packFormatVersionMin: number | undefined
      let packFormatVersionMax: number | undefined
      let tags: string[] | undefined
      try {
        const parsedRecord = await parseDatapackMetadataRecord(datapackDir)
        const nextMetadataRecord = parsedRecord ? { ...parsedRecord } : null
        let shouldPersistMetadata = false

        if (parsedRecord && typeof parsedRecord.version === "number" && Number.isFinite(parsedRecord.version)) {
          version = parsedRecord.version
        }
        if (parsedRecord && typeof parsedRecord.id === "string") {
          id = parsedRecord.id
        }
        if (parsedRecord && typeof parsedRecord.name === "string") {
          displayName = parsedRecord.name
        }
        if (parsedRecord && typeof parsedRecord.packVersion === "string") {
          packVersion = parsedRecord.packVersion
        }
        if (parsedRecord && typeof parsedRecord.lastOpened === "string") {
          lastOpened = parsedRecord.lastOpened
        }
        if (parsedRecord && typeof parsedRecord.author === "string") {
          author = parsedRecord.author
        }
        if (parsedRecord && typeof parsedRecord.description === "string") {
          description = parsedRecord.description
        }
        if (parsedRecord && typeof parsedRecord.packFormatVersionMin === "number" && Number.isFinite(parsedRecord.packFormatVersionMin)) {
          packFormatVersionMin = parsedRecord.packFormatVersionMin
        }

        const parsedMinecraftVersion = parsedRecord && typeof parsedRecord.minecraftVersion === "string"
          ? parsedRecord.minecraftVersion.trim()
          : ""
        minecraftVersion = parsedMinecraftVersion || FALLBACK_MINECRAFT_VERSION
        if (nextMetadataRecord && (!parsedMinecraftVersion || parsedRecord?.minecraftVersion !== parsedMinecraftVersion)) {
          nextMetadataRecord.minecraftVersion = minecraftVersion
          shouldPersistMetadata = true
        }
        if (parsedRecord && typeof parsedRecord.packFormatVersionMax === "number" && Number.isFinite(parsedRecord.packFormatVersionMax)) {
          packFormatVersionMax = parsedRecord.packFormatVersionMax
        }
        if (packFormatVersionMax === undefined) {
          const resolvedPackFormat = resolvePackFormatFromMinecraftVersion(minecraftVersion)
          const resolvedPackFormatVersionMax = resolvedPackFormat ? Number.parseFloat(resolvedPackFormat) : undefined
          if (typeof resolvedPackFormatVersionMax === "number" && Number.isFinite(resolvedPackFormatVersionMax)) {
            packFormatVersionMax = resolvedPackFormatVersionMax

            if (nextMetadataRecord) {
              nextMetadataRecord.packFormatVersionMax = resolvedPackFormatVersionMax
              shouldPersistMetadata = true
            }
          }
        }

        if (nextMetadataRecord && shouldPersistMetadata) {
          try {
            await window.electron.writeFile(
              datapackDir,
              ".mpp-datapack",
              JSON.stringify(nextMetadataRecord, null, 2),
            )
          } catch (error) {
            console.warn('Failed to backfill datapack metadata defaults:', error)
          }
        }

        if (parsedRecord && Array.isArray(parsedRecord.tags)) {
          tags = (parsedRecord.tags as unknown[])
            .filter((tag): tag is string => typeof tag === "string")
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0)
        }
      } catch {
        version = undefined
        id = undefined
        displayName = undefined
        packVersion = undefined
        tags = undefined
        lastOpened = undefined
        author = undefined
        description = undefined
        packFormatVersionMin = undefined
      }
      return {
        dir: datapackDir,
        name,
        paths: toRelativePaths(datapackDir, paths),
        version,
        id,
        displayName,
        packVersion,
        minecraftVersion,
        lastOpened,
        author,
        description,
        packFormatVersionMin,
        packFormatVersionMax,
        tags,
      }
    } catch {
      return null
    }
  }

  const refreshDatapacks = async (dirs: string[]) => {
    const uniqueDirs = Array.from(new Set(dirs.filter(Boolean)))
    const entries = await Promise.all(uniqueDirs.map((dir) => loadDatapackEntry(dir)))
    const nextDatapacks = entries.filter((entry): entry is DatapackEntry => !!entry)
    datapacksRef.current = nextDatapacks
    setDatapacks(nextDatapacks)
  }

  const refreshWorkspaceDatapacks = async (metadataPaths: string[]) => {
    const loadedEntries: DatapackEntry[] = []
    const missingMetadataPaths: string[] = []

    for (const metadataPath of metadataPaths) {
      const datapackDir = getDirFromPath(metadataPath)

      let hasRootMcmeta = false
      try {
        const enabledMcmeta = await window.electron.readFileIfExists(datapackDir, 'pack.mcmeta')
        const disabledMcmeta = await window.electron.readFileIfExists(datapackDir, 'pack.mcmeta.disabled')
        hasRootMcmeta = enabledMcmeta !== null || disabledMcmeta !== null
      } catch {
        hasRootMcmeta = false
      }

      if (!hasRootMcmeta) {
        missingMetadataPaths.push(metadataPath)
        continue
      }

      const loadedEntry = await loadDatapackEntry(datapackDir)
      if (loadedEntry) {
        loadedEntries.push(loadedEntry)
      } else {
        missingMetadataPaths.push(metadataPath)
      }
    }

    setDatapacks(loadedEntries)

    for (const missingMetadataPath of missingMetadataPaths) {
      try {
        await window.electron.workspaceRemoveDatapack(missingMetadataPath)
      } catch (error) {
        console.error('Failed to remove missing datapack entry from workspace:', error)
      }
    }

    if (missingMetadataPaths.length > 0) {
      const label = missingMetadataPaths.length === 1 ? 'entry' : 'entries'
      showToastEvent(`Removed ${missingMetadataPaths.length} missing datapack ${label} from workspace`)
    }
  }

  const handleWorkspaceChangeWithConfirm = async (workspaceChangeAction: () => Promise<void>) => {
    // If no unsaved files, just proceed
    if (modifiedFiles.size === 0) {
      await workspaceChangeAction()
      return
    }

    // Use Promise wrapper to make async dialog behave synchronously
    // This ensures workspace change only happens after user makes a choice
    await new Promise<void>((resolve) => {
      dialog.openDialog({
        title: "Unsaved Changes",
        message: `You have ${modifiedFiles.size} unsaved file(s). What would you like to do?`,
        buttons: [
          {
            label: "Save",
            onClick: async () => {
              const didSave = await saveAllFiles()
              if (didSave) {
                await workspaceChangeAction()
              }
              resolve()
            },
          },
          {
            label: "Discard",
            onClick: async () => {
              await workspaceChangeAction()
              resolve()
            },
          },
          {
            label: "Cancel",
            onClick: () => {
              resolve()
            },
          },
        ],
      })
    })
  }

  const handleOpenWorkspaceWithConfirm = async () => {
    await handleWorkspaceChangeWithConfirm(async () => {
      const didOpenWorkspace = await handleOpenWorkspace()
      if (!didOpenWorkspace) return
    })
  }

  const handleNewWorkspaceWithConfirm = async () => {
    await handleWorkspaceChangeWithConfirm(async () => {
      const didCreateWorkspace = await handleNewWorkspace()
      if (!didCreateWorkspace) return
    })
  }

  const handleOpenDefaultWorkspaceWithConfirm = async () => {
    await handleWorkspaceChangeWithConfirm(async () => {
      const didOpenDefaultWorkspace = await handleOpenDefaultWorkspace()
      if (!didOpenDefaultWorkspace) return
    })
  }

  const handleQuitWithConfirm = async (isNativeQuitRequest = false) => {
    const notifyQuitCancelled = () => {
      if (!isNativeQuitRequest) return
      void window.electron.quitCancelled()
    }

    const confirmBootstrapQuitCancel = async (): Promise<boolean> => {
      return await new Promise<boolean>((resolve) => {
        pendingBootstrapQuitDecisionRef.current = resolve
        dialog.openDialog({
          title: 'Quit During Download',
          message: 'Minecraft data is still being prepared. Quit now, cancel download, and clean up temporary files?',
          buttons: [
            {
              label: 'Quit',
              onClick: () => {
                const nextResolve = pendingBootstrapQuitDecisionRef.current
                pendingBootstrapQuitDecisionRef.current = null
                nextResolve?.(true)
              },
            },
            {
              label: 'Stay',
              onClick: () => {
                const nextResolve = pendingBootstrapQuitDecisionRef.current
                pendingBootstrapQuitDecisionRef.current = null
                nextResolve?.(false)
              },
            },
          ],
        })
      })
    }

    const cancelBootstrapAndQuit = async (): Promise<boolean> => {
      const confirmed = await confirmBootstrapQuitCancel()
      if (!confirmed) {
        notifyQuitCancelled()
        return false
      }

      try {
        await window.electron.minecraftDataCancel()
      } catch (error) {
        console.error('Failed to cancel Minecraft data preparation before quit:', error)
      }

      await window.electron.quit()
      return true
    }

    if (isMinecraftDataBootstrapOpen) {
      await cancelBootstrapAndQuit()
      return
    }

    // If no unsaved files, double confirm quit to prevent accidental exits
    if (modifiedFiles.size === 0) {
      const confirmed = await dialog.showConfirm("Quit", "Are you sure you want to quit?")
      if (confirmed) {
        await window.electron.quit()
      } else {
        notifyQuitCancelled()
      }
      return
    }

    // Use Promise wrapper to make async dialog behave synchronously
    // This ensures quit only happens after user makes a choice
    await new Promise<void>((resolve) => {
      dialog.openDialog({
        title: "Unsaved Changes",
        message: `You have ${modifiedFiles.size} unsaved file(s). Do you want to save before quitting?`,
        buttons: [
          {
            label: "Save",
            onClick: async () => {
              const didSave = await saveAllFiles()
              if (didSave) {
                if (isMinecraftDataBootstrapOpen) {
                  const quitHandled = await cancelBootstrapAndQuit()
                  if (!quitHandled) {
                    resolve()
                    return
                  }
                } else {
                  await window.electron.quit()
                }
              } else {
                notifyQuitCancelled()
              }
              resolve()
            },
          },
          {
            label: "Discard",
            onClick: async () => {
              if (isMinecraftDataBootstrapOpen) {
                const quitHandled = await cancelBootstrapAndQuit()
                if (!quitHandled) {
                  resolve()
                  return
                }
              } else {
                await window.electron.quit()
              }
              resolve()
            },
          },
          {
            label: "Cancel",
            onClick: () => {
              notifyQuitCancelled()
              resolve()
            },
          },
        ],
      })
    })
  }

  const handleRefreshExplorer = async () => {
    if (!datapacks.length) return
    await refreshDatapacks(datapacks.map((datapack) => datapack.dir))
  }

  const handleAddDatapackToWorkspace = async () => {
    const metadataPath = await window.electron.pickDatapackMetadataFile()
    if (!metadataPath) return

    await addDatapackMetadataToWorkspace(metadataPath)
  }

  const addDatapackMetadataToWorkspace = async (metadataPath: string): Promise<boolean> => {
    if (!metadataPath) return false

    try {
      await window.electron.addDatapackFromMetadata(metadataPath)
      const datapackDir = getDirFromPath(metadataPath)
      const existingDirs = datapacks.map((datapack) => datapack.dir)
      await refreshDatapacks([...existingDirs, datapackDir])

      setExplorerExpandedPathsByDatapack((prev) => {
        if (prev[datapackDir] !== undefined) {
          return prev
        }

        const datapackName = getPathLeafName(datapackDir) || 'Datapack'
        return {
          ...prev,
          [datapackDir]: new Set([datapackName, `${datapackName}/data`]),
        }
      })

      const datapackName = getPathLeafName(datapackDir) || 'Datapack'
      showToastEvent(`Added datapack to workspace: ${datapackName}`)
      return true
    } catch (error) {
      console.error('Failed to add datapack to workspace:', error)
      await dialog.showAlert('Error', `Failed to add datapack to workspace: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return false
    }
  }

  const handleRemoveDatapack = async (datapackDir: string) => {
    try {
      const fileKeysToClose = openedFiles
        .filter((file) => file.datapackDir === datapackDir)
        .map((file) => createFileKey(file.datapackDir, file.relativePath))

      if (fileKeysToClose.length > 0) {
        const didCloseAll = await closeTabsSequentially(fileKeysToClose)
        if (!didCloseAll) return
      }

      // Get the metadata path for this datapack
      const metadataPath = `${datapackDir}/.mpp-datapack`
      
      // Remove from workspace
      await window.electron.workspaceRemoveDatapack(metadataPath)
      
      // Refresh the datapack list
      const updatedDirs = datapacks.filter((dp) => dp.dir !== datapackDir).map((dp) => dp.dir)
      await refreshDatapacks(updatedDirs)
      const datapackName = getPathLeafName(datapackDir) || "Datapack"
      showToastEvent(`Removed datapack from workspace: ${datapackName}`)
    } catch (error) {
      console.error("Failed to remove datapack:", error)
      await dialog.showAlert("Error", `Failed to remove datapack from workspace: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }

  const handleInspectorMetadataChange = async (datapackDir: string, fieldKey: string, value: unknown) => {
    const metadataRecord = await parseDatapackMetadataRecord(datapackDir)
    if (!metadataRecord) {
      throw new Error('Invalid datapack metadata format')
    }

    const nextMetadata = { ...metadataRecord }

    if (fieldKey === 'tags') {
      const tagValues = typeof value === 'string'
        ? value.split(',').map((tag) => tag.trim()).filter((tag) => tag.length > 0)
        : []
      nextMetadata.tags = Array.from(new Set(tagValues))
    } else if (fieldKey === 'version' || fieldKey === 'packFormatVersionMin' || fieldKey === 'packFormatVersionMax') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return
      }
      nextMetadata[fieldKey] = value
    } else {
      nextMetadata[fieldKey] = typeof value === 'string' ? value : String(value ?? '')
    }

    await window.electron.writeFile(datapackDir, '.mpp-datapack', JSON.stringify(nextMetadata, null, 2))
    await refreshDatapacks(datapacksRef.current.map((datapack) => datapack.dir))

    if (fieldKey === 'minecraftVersion') {
      await queueContextsThenDiagnosticsReload(datapackDir)
    }
  }

  const handleOpenBugReport = async () => {
    try {
      await window.electron.openExternal('bug-report')
    } catch (error) {
      console.error("Failed to open bug report page:", error)
      await dialog.showAlert("Error", "Failed to open bug report page")
    }
  }

  const removeFileFromOpenedFiles = (fileKey: string) => {
    setPreviewFileKey((prev) => (prev === fileKey ? null : prev))
    setOpenedFiles((prev) => prev.filter((f) => createFileKey(f.datapackDir, f.relativePath) !== fileKey))
  }

  const removeFileFromModifiedFiles = (fileKey: string) => {
    modifiedFilesRef.current = new Set(modifiedFilesRef.current)
    modifiedFilesRef.current.delete(fileKey)
    fileContextRefreshRequiredVersionRef.current.delete(fileKey)
    setModifiedFiles((prev) => {
      const next = new Set(prev)
      next.delete(fileKey)
      return next
    })
  }

  const setDiagnosticSummaryFromCache = (fileKey: string | null) => {
    if (!fileKey) {
      setDiagnosticSummary(defaultDiagnosticSummary)
      return
    }

    setDiagnosticSummary(fileDiagnosticSummariesRef.current[fileKey] ?? defaultDiagnosticSummary)
  }

  const removeFileFromDiagnosticSummaries = (fileKey: string) => {
    setFileDiagnosticSummaries((prev) => {
      if (!(fileKey in prev)) return prev
      const next = { ...prev }
      delete next[fileKey]
      return next
    })
  }

  const removeFileFromOpenAndModified = (fileKey: string) => {
    removeFileFromOpenedFiles(fileKey)
    removeFileFromModifiedFiles(fileKey)
    fileContextParseCacheRef.current.delete(fileKey)
  }

  const handleFileRenamed = async (datapackDir: string, oldRelativePath: string, newName: string): Promise<boolean> => {
    const oldFileKey = createFileKey(datapackDir, oldRelativePath)
    
    // Pre-rename check: if newName is empty, just validate unsaved changes
    if (!newName) {
      setPreviewFileKey((prev) => (prev === oldFileKey ? null : prev))

      const normalizedTarget = oldRelativePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
      const targetPrefix = normalizedTarget ? `${normalizedTarget}/` : ''

      const affectedModifiedFileKeys = Array.from(modifiedFiles).filter((fileKey) => {
        const parsed = parseFileKey(fileKey)
        if (parsed.datapackDir !== datapackDir) return false

        const normalizedRelative = parsed.relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
        if (!normalizedTarget) {
          return true
        }

        return normalizedRelative === normalizedTarget || normalizedRelative.startsWith(targetPrefix)
      })

      if (affectedModifiedFileKeys.length === 0) return true

      const itemLabel = affectedModifiedFileKeys.length === 1 ? 'file has' : 'files have'
      const choice = await dialog.showUnsavedConfirm(
        'Rename File?',
        `${affectedModifiedFileKeys.length} ${itemLabel} unsaved changes. What would you like to do?`
      )

      if (choice === 'cancel') return false

      if (choice === 'discard') {
        setModifiedFiles((prev) => {
          const next = new Set(prev)
          for (const fileKey of affectedModifiedFileKeys) {
            next.delete(fileKey)
          }
          return next
        })

        return true
      }

      for (const fileKey of affectedModifiedFileKeys) {
        const didSave = await saveFileInternal(fileKey)
        if (!didSave) return false
      }

      return true
    }

    // Post-rename: update the open file
    const openedFileIndex = openedFiles.findIndex((f) => createFileKey(f.datapackDir, f.relativePath) === oldFileKey)
    if (openedFileIndex === -1) return true // File wasn"t open
    
    // Calculate new relative path
    const newRelativePath = oldRelativePath.split("/").slice(0, -1).concat(newName).join("/")
    const newFileKey = createFileKey(datapackDir, newRelativePath)
    const newFileName = newRelativePath.split('/').filter(Boolean).pop() || newName
    const wasActive = activeFile === oldFileKey

    const cachedContext = fileContextParseCacheRef.current.get(oldFileKey)
    if (cachedContext) {
      fileContextParseCacheRef.current.set(newFileKey, cachedContext)
      fileContextParseCacheRef.current.delete(oldFileKey)
    }

    clearAutoSaveTimer(oldFileKey)
    setPreviewFileKey((prev) => (prev === oldFileKey ? newFileKey : prev))
    
    try {
      const freshContents = await window.electron.readFile(datapackDir, newRelativePath)
      
      setOpenedFiles((prev) => {
        const filtered = prev.filter((f) => createFileKey(f.datapackDir, f.relativePath) !== oldFileKey)
        const newFile: OpenedFile = {
          datapackDir,
          relativePath: newRelativePath,
          fileName: newFileName,
          content: freshContents,
        }
        filtered.splice(openedFileIndex, 0, newFile)
        return filtered
      })

      setModifiedFiles((prev) => {
        const next = new Set(prev)
        const wasModified = next.delete(oldFileKey)
        if (wasModified) {
          next.add(newFileKey)
        }
        return next
      })

      setFileDiagnosticSummaries((prev) => {
        if (!(oldFileKey in prev)) return prev
        const next = { ...prev }
        const summary = next[oldFileKey]
        delete next[oldFileKey]
        next[newFileKey] = summary
        return next
      })

      if (wasActive) {
        await openFile(newFileKey, { initialContent: freshContents })
      }

      fileEditorStatesRef.current.delete(oldFileKey)
      
    } catch (error) {
      console.error("Failed to read renamed file:", error)
      await dialog.showAlert("Error", `Failed to read renamed file: ${error instanceof Error ? error.message : "Unknown error"}`)
    }

    return true
  }

  const confirmFileDelete = async (datapackDir: string, relativePath: string): Promise<boolean> => {
    const fileKey = createFileKey(datapackDir, relativePath)
    if (modifiedFiles.has(fileKey)) {
      // Deleting a file discards unsaved changes by design.
      removeFileFromModifiedFiles(fileKey)
    }

    return true
  }

  const closeDeletedFileTab = async (datapackDir: string, relativePath: string): Promise<void> => {
    const fileKey = createFileKey(datapackDir, relativePath)
    const openedFileIndex = openedFiles.findIndex((f) => createFileKey(f.datapackDir, f.relativePath) === fileKey)

    if (openedFileIndex === -1) {
      // File wasn't open, nothing to do
      return
    }

    // Close the file
    clearAutoSaveTimer(fileKey)
    fileEditorStatesRef.current.delete(fileKey)
    
    // Remove from opened files and modified files
    const updatedFiles = openedFiles.filter((f) => createFileKey(f.datapackDir, f.relativePath) !== fileKey)
    removeFileFromOpenAndModified(fileKey)
    removeFileFromDiagnosticSummaries(fileKey)

    // If the deleted file was active, switch to another file
    if (activeFile === fileKey) {
      if (updatedFiles.length > 0) {
        // Try to open the next tab (same index), or previous tab if no next tab exists
        const nextIndex = openedFileIndex < updatedFiles.length ? openedFileIndex : updatedFiles.length - 1
        const nextFile = updatedFiles[nextIndex]
        const newActive = createFileKey(nextFile.datapackDir, nextFile.relativePath)
        await openFile(newActive)
      } else {
        await openFile(null)
      }
    }

  }

  const openFile = async (fileKey: string | null, options?: { initialContent?: string }) => {
    const requestId = openFileRequestIdRef.current + 1
    openFileRequestIdRef.current = requestId

    const view = viewRef.current
    if (!view) {
      const nextDatapackDir = fileKey ? parseFileKey(fileKey).datapackDir : null
      setActiveDatapackContext(nextDatapackDir)
      setActiveFile(fileKey)
      activeFileRef.current = fileKey
      setDiagnosticSummaryFromCache(fileKey)
      focusFileInExplorer(fileKey)
      return
    }

    persistActiveEditorState()
    setActiveFile(fileKey)
    activeFileRef.current = fileKey
    const nextDatapackDir = fileKey ? parseFileKey(fileKey).datapackDir : null
    setActiveDatapackContext(nextDatapackDir)
    setDiagnosticSummaryFromCache(fileKey)
    focusFileInExplorer(fileKey)
    
    if (!fileKey) {
      view.setState(createEditorState("", null))
      setCursorMarkerInfo(getCursorMarkerInfo(view.state))
      return
    }
    
    // Parse file key to get datapack dir and relative path
    const { datapackDir, relativePath } = parseFileKey(fileKey)
    
    // Find the opened file to get cached content
    const openedFile = openedFilesRef.current.find((f) => createFileKey(f.datapackDir, f.relativePath) === fileKey)
    
    const hasInitialContent = options?.initialContent !== undefined
    let contents = hasInitialContent ? (options?.initialContent ?? "") : ""
    
    // Use cached content if available, otherwise read from disk
    if (!hasInitialContent && openedFile?.content !== undefined) {
      contents = openedFile.content
    } else if (!hasInitialContent) {
      try {
        contents = await window.electron.readFile(datapackDir, relativePath)
        if (openFileRequestIdRef.current !== requestId) return
      } catch (error) {
        if (openFileRequestIdRef.current !== requestId) return
        console.error("Failed to read file:", error)
        await dialog.showAlert("Error", `Failed to read file: ${error instanceof Error ? error.message : "Unknown error"}`)
        return
      }
    }

    if (openFileRequestIdRef.current !== requestId) return
    
    const cachedState = fileEditorStatesRef.current.get(fileKey)
    if (cachedState) {
      if (openFileRequestIdRef.current !== requestId) return
      view.setState(cachedState)
      setCursorMarkerInfo(getCursorMarkerInfo(view.state))
      return
    }

    const newState = createEditorState(contents, fileKey)
    fileEditorStatesRef.current.set(fileKey, newState)
    view.setState(newState)
    setCursorMarkerInfo(getCursorMarkerInfo(view.state))
  }

  const handleExplorerSelect = async (datapackDir: string, pathKey: string, isFile: boolean, mode: 'preview' | 'pinned' = 'preview') => {
    setExplorerSelectedPathsByDatapack((prev) => {
      const next: Record<string, string | null> = {}
      for (const key of Object.keys(prev)) {
        next[key] = null
      }
      next[datapackDir] = pathKey
      return next
    })

    setExplorerSelectedFileKeysByDatapack((prev) => {
      const next: Record<string, string | null> = {}
      for (const key of Object.keys(prev)) {
        next[key] = null
      }
      next[datapackDir] = null
      return next
    })

    if (!isFile) return

    const rootName = getPathLeafName(datapackDir)
    const normalizedKey = trimLeadingSlashes(normalizePathSeparators(pathKey))
    const rootPrefix = rootName ? `${rootName}/` : ""
    const relativePath = normalizedKey === rootName
      ? ""
      : normalizedKey.startsWith(rootPrefix)
        ? normalizedKey.slice(rootPrefix.length)
        : normalizedKey

    const trimmedRelative = trimLeadingSlashes(relativePath)
    const fileName = trimmedRelative.split("/").pop() || ""
    if (!trimmedRelative || !fileName.includes(".")) return

    // Create file key for tracking
    const fileKey = createFileKey(datapackDir, trimmedRelative)
    setExplorerSelectedFileKeysByDatapack((prev) => ({
      ...prev,
      [datapackDir]: fileKey,
    }))
    
    // Replace the current preview tab only when opening a new file via preview click.
    const shouldOpenAsPreview = mode === 'preview'
    const currentPreviewFileKey = previewFileKeyRef.current
    const existingFile = openedFilesRef.current.find((f) => createFileKey(f.datapackDir, f.relativePath) === fileKey)
    const isAlreadyOpen = !!existingFile
    const isCurrentPreview = currentPreviewFileKey === fileKey

    if (
      shouldOpenAsPreview
      && currentPreviewFileKey
      && currentPreviewFileKey !== fileKey
      && !isAlreadyOpen
      && !modifiedFilesRef.current.has(currentPreviewFileKey)
    ) {
      clearAutoSaveTimer(currentPreviewFileKey)
      fileEditorStatesRef.current.delete(currentPreviewFileKey)
      removeFileFromDiagnosticSummaries(currentPreviewFileKey)
      setOpenedFiles((prev) => prev.filter((f) => createFileKey(f.datapackDir, f.relativePath) !== currentPreviewFileKey))
    }

    let loadedContent: string | undefined
    if (!existingFile) {
      // Load content from disk for new files
      try {
        const content = await window.electron.readFile(datapackDir, trimmedRelative)
        loadedContent = content
        setOpenedFiles((prev) => {
          const alreadyOpen = prev.some((f) => createFileKey(f.datapackDir, f.relativePath) === fileKey)
          if (alreadyOpen) return prev
          return [...prev, { datapackDir, relativePath: trimmedRelative, fileName, content }]
        })
      } catch (error) {
        console.error("Failed to read file:", error)
        await dialog.showAlert("Error", `Failed to read file: ${error instanceof Error ? error.message : "Unknown error"}`)
        return
      }
    }
    
    if (shouldOpenAsPreview && (!isAlreadyOpen || isCurrentPreview)) {
      setPreviewFileKey(fileKey)
    } else if (!shouldOpenAsPreview) {
      setPreviewFileKey((prev) => (prev === fileKey ? null : prev))
    }

    // Set as active and load content
    await openFile(fileKey, loadedContent !== undefined ? { initialContent: loadedContent } : undefined)

    if (mode === 'pinned') {
      viewRef.current?.focus()
    }
  }

  const clearAutoSaveTimer = (fileKey: string) => {
    const timerId = autoSaveTimersRef.current.get(fileKey)
    if (timerId !== undefined) {
      window.clearTimeout(timerId)
      autoSaveTimersRef.current.delete(fileKey)
    }
  }

  const { markInternalSaveForWatcherSuppress } = useExternalFileWatcher({
    openedFiles,
    openedFilesRef,
    onExternalFileChange: handleExternalFileChange,
    onExternalFileDeleted: handleExternalFileDeleted,
    onExternalStructureChanged: handleExternalStructureChanged,
  })

  useEffect(() => {
    const handleDatapackOpenRequest = async (filePath: string) => {
      if (!filePath || !filePath.toLowerCase().endsWith('.mpp-datapack')) return

      if (!workspaceInfo.dir || !workspaceInfo.name) {
        pendingExternalDatapackPathRef.current = filePath
        return
      }

      pendingExternalDatapackPathRef.current = null
      await addDatapackMetadataToWorkspace(filePath)
    }

    if (!didConsumeDatapackLaunchPathRef.current) {
      didConsumeDatapackLaunchPathRef.current = true
      void window.electron.datapackConsumeLaunchPath().then(async (launchDatapackPath) => {
        if (launchDatapackPath) {
          await handleDatapackOpenRequest(launchDatapackPath)
        }
      })
    }

    if (pendingExternalDatapackPathRef.current && workspaceInfo.dir && workspaceInfo.name) {
      const pendingPath = pendingExternalDatapackPathRef.current
      void handleDatapackOpenRequest(pendingPath)
    }

    const unsubscribe = window.electron.onDatapackOpenRequested((filePath) => {
      void handleDatapackOpenRequest(filePath)
    })

    return () => {
      unsubscribe()
    }
  }, [workspaceInfo.dir, workspaceInfo.name, datapacks, refreshDatapacks])

  useEffect(() => {
    let isDisposed = false

    const syncDirectoryWatches = async () => {
      const desiredByDatapackDir = new Map<string, string>()
      for (const datapack of datapacks) {
        desiredByDatapackDir.set(datapack.dir, `dir-watch|${datapack.dir}`)
      }

      for (const [datapackDir, watchId] of directoryWatchIdsRef.current.entries()) {
        if (desiredByDatapackDir.has(datapackDir)) continue
        try {
          await window.electron.watchDirectoryStop(watchId)
        } catch (error) {
          console.error("Failed to stop datapack directory watch:", error)
        } finally {
          directoryWatchIdsRef.current.delete(datapackDir)
        }
      }

      for (const [datapackDir, watchId] of desiredByDatapackDir.entries()) {
        if (isDisposed) return
        if (directoryWatchIdsRef.current.has(datapackDir)) continue

        try {
          await window.electron.watchDirectoryStart(watchId, datapackDir)
          directoryWatchIdsRef.current.set(datapackDir, watchId)
        } catch (error) {
          console.error("Failed to start datapack directory watch:", error)
        }
      }
    }

    void syncDirectoryWatches()

    return () => {
      isDisposed = true
    }
  }, [datapacks])

  useEffect(() => {
    const unsubscribe = window.electron.onDirectoryExternalChange((event) => {
      const watchIdPrefix = 'dir-watch|'
      if (!event.watchId.startsWith(watchIdPrefix)) return

      const datapackDir = event.watchId.slice(watchIdPrefix.length)
      const trackedDatapackDirs = datapacksRef.current.map((datapack) => datapack.dir)
      if (!trackedDatapackDirs.includes(datapackDir)) return

      if (directoryRefreshTimerRef.current !== null) {
        window.clearTimeout(directoryRefreshTimerRef.current)
      }

      directoryRefreshTimerRef.current = window.setTimeout(() => {
        directoryRefreshTimerRef.current = null
        void refreshDatapacks(trackedDatapackDirs)
      }, 120)
    })

    return () => {
      unsubscribe()
      if (directoryRefreshTimerRef.current !== null) {
        window.clearTimeout(directoryRefreshTimerRef.current)
        directoryRefreshTimerRef.current = null
      }
    }
  }, [refreshDatapacks])

  useEffect(() => {
    return () => {
      const stopDirectoryWatches = async () => {
        for (const watchId of directoryWatchIdsRef.current.values()) {
          try {
            await window.electron.watchDirectoryStop(watchId)
          } catch (error) {
            console.error("Failed to stop datapack directory watch during cleanup:", error)
          }
        }
        directoryWatchIdsRef.current.clear()
      }

      void stopDirectoryWatches()
    }
  }, [])

  const saveFile = async (fileKey: string, contents: string): Promise<boolean> => {
    const { datapackDir, relativePath } = parseFileKey(fileKey)

    try {
      markInternalSaveForWatcherSuppress(fileKey)
      await window.electron.saveFile(datapackDir, relativePath, contents)
      
      // Update cached content
      setOpenedFiles((prev) => 
        prev.map((f) => 
          createFileKey(f.datapackDir, f.relativePath) === fileKey
            ? { ...f, content: contents }
            : f
        )
      )
      
      // Clear modified state for this file
      removeFileFromModifiedFiles(fileKey)

      if (activeFileRef.current === fileKey) {
        setDiagnosticSummaryFromCache(fileKey)
      }

      // Clear any pending autosave
      clearAutoSaveTimer(fileKey)
      return true
    } catch (error) {
      console.error("Failed to save file:", error)
      await dialog.showAlert("Error", `Failed to save file: ${error instanceof Error ? error.message : "Unknown error"}`)
      return false
    }
  }

  const saveCurrentFile = async (): Promise<boolean> => {
    if (!activeFile || !viewRef.current) return false
    const contents = viewRef.current.state.doc.toString()
    const didSave = await saveFile(activeFile, contents)
    if (didSave) {
      const openedFile = openedFiles.find((f) => createFileKey(f.datapackDir, f.relativePath) === activeFile)
      showToastEvent(`Saved: ${openedFile?.fileName ?? "file"}`)
    }
    return didSave
  }

  const saveFileInternal = async (fileKey: string): Promise<boolean> => {
    const openedFile = openedFiles.find((f) => createFileKey(f.datapackDir, f.relativePath) === fileKey)
    if (openedFile) {
      return await saveFile(fileKey, openedFile.content)
    }
    return false
  }

  const scheduleAutoSave = (fileKey: string, contents: string) => {
    if (!isAutoSaveEnabledRef.current) return
    if (isDialogOpenRef.current) return // Pause auto-save while dialog is open

    // Clear existing timer for this file
    clearAutoSaveTimer(fileKey)

    // Schedule new autosave after 1000ms
    const timerId = window.setTimeout(() => {
      saveFile(fileKey, contents)
    }, 1000)

    autoSaveTimersRef.current.set(fileKey, timerId)
  }

  async function saveAllFiles(): Promise<boolean> {
    const filesToSave: Array<{ fileKey: string; contents: string }> = []

    // Collect all modified files with their cached content
    for (const fileKey of modifiedFiles) {
      const openedFile = openedFiles.find((f) => createFileKey(f.datapackDir, f.relativePath) === fileKey)
      if (openedFile) {
        filesToSave.push({ 
          fileKey, 
          contents: openedFile.content 
        })
      }
    }

    // Save all files using the shared saveFile function
    const savePromises = filesToSave.map(({ fileKey, contents }) =>
      saveFile(fileKey, contents)
    )

    try {
      const saveResults = await Promise.all(savePromises)
      const didSaveAll = saveResults.every(Boolean)
      if (didSaveAll && filesToSave.length > 0) {
        showToastEvent(`Saved ${filesToSave.length} file${filesToSave.length === 1 ? "" : "s"}`)
      }
      return didSaveAll
    } catch (error) {
      console.error("Failed to save all files:", error)
      await dialog.showAlert("Error", `Failed to save all files: ${error instanceof Error ? error.message : "Unknown error"}`)
      return false
    }
  }

  const refreshOpenedFileFromDisk = async (fileKey: string, clearModifiedState: boolean): Promise<boolean> => {
    const openedFile = openedFilesRef.current.find((file) => createFileKey(file.datapackDir, file.relativePath) === fileKey)
    if (!openedFile) return false

    const { datapackDir, relativePath } = parseFileKey(fileKey)

    try {
      const diskContents = await window.electron.readFile(datapackDir, relativePath)
      const latestOpenedFile = openedFilesRef.current.find((file) => createFileKey(file.datapackDir, file.relativePath) === fileKey)
      if (!latestOpenedFile) return false

      const shouldSkipUpdate = latestOpenedFile.content === diskContents && (!clearModifiedState || !modifiedFilesRef.current.has(fileKey))
      if (shouldSkipUpdate) return true

      setOpenedFiles((prev) =>
        prev.map((file) =>
          createFileKey(file.datapackDir, file.relativePath) === fileKey
            ? { ...file, content: diskContents }
            : file,
        ),
      )

      if (clearModifiedState) {
        removeFileFromModifiedFiles(fileKey)
        clearAutoSaveTimer(fileKey)
      }

      fileEditorStatesRef.current.delete(fileKey)

      if (activeFileRef.current === fileKey && viewRef.current) {
        const refreshedState = createEditorState(diskContents, fileKey)
        fileEditorStatesRef.current.set(fileKey, refreshedState)
        viewRef.current.setState(refreshedState)
        setCursorMarkerInfo(getCursorMarkerInfo(refreshedState))
        viewRef.current.focus()
      }

      scheduleContextReload(datapackDir)
      return true
    } catch (error) {
      console.error("Failed to refresh file from disk:", error)
      await dialog.showAlert("Error", `Failed to refresh file from disk: ${error instanceof Error ? error.message : "Unknown error"}`)
      return false
    }
  }

  async function handleExternalFileChange(fileKey: string) {
    const openedFile = openedFilesRef.current.find((file) => createFileKey(file.datapackDir, file.relativePath) === fileKey)
    if (!openedFile) return

    if (!modifiedFilesRef.current.has(fileKey)) {
      await refreshOpenedFileFromDisk(fileKey, false)
      return
    }

    try {
      const { datapackDir, relativePath } = parseFileKey(fileKey)
      const diskContents = await window.electron.readFile(datapackDir, relativePath)
      const latestOpenedFile = openedFilesRef.current.find((file) => createFileKey(file.datapackDir, file.relativePath) === fileKey)
      if (!latestOpenedFile) return

      if (latestOpenedFile.content === diskContents) {
        removeFileFromModifiedFiles(fileKey)
        clearAutoSaveTimer(fileKey)
        markInternalSaveForWatcherSuppress(fileKey)
        return
      }
    } catch {
      // Fall through to dialog when we cannot reliably compare content.
    }

    const fileName = openedFile.fileName || "This file"
    const choice = await new Promise<"keep" | "discard">((resolve) => {
      dialog.openDialog({
        title: "External File Change",
        message: `${fileName} was modified outside the app. Keep your in-app changes or discard them and refresh from disk?`,
        buttons: [
          {
            label: "Keep In-App Changes",
            onClick: () => resolve("keep"),
          },
          {
            label: "Discard and Refresh",
            onClick: () => resolve("discard"),
          },
        ],
      })
    })

    if (choice === "discard") {
      await refreshOpenedFileFromDisk(fileKey, true)
    }
  }

  async function handleExternalStructureChanged(datapackDir: string) {
    const trackedDatapackDirs = datapacks.map((datapack) => datapack.dir)
    if (trackedDatapackDirs.length === 0) return
    if (!trackedDatapackDirs.includes(datapackDir)) return

    await refreshDatapacks(trackedDatapackDirs)
  }

  async function handleExternalFileDeleted(fileKey: string) {
    const existingOpenedFiles = openedFilesRef.current
    const closingIndex = existingOpenedFiles.findIndex((file) => createFileKey(file.datapackDir, file.relativePath) === fileKey)
    if (closingIndex === -1) return

    clearAutoSaveTimer(fileKey)
    fileEditorStatesRef.current.delete(fileKey)
    removeFileFromDiagnosticSummaries(fileKey)

    const updatedFiles = existingOpenedFiles.filter((file) => createFileKey(file.datapackDir, file.relativePath) !== fileKey)
    removeFileFromOpenAndModified(fileKey)

    if (activeFileRef.current === fileKey) {
      if (updatedFiles.length > 0) {
        const nextIndex = closingIndex < updatedFiles.length ? closingIndex : updatedFiles.length - 1
        const nextFile = updatedFiles[nextIndex]
        const nextFileKey = createFileKey(nextFile.datapackDir, nextFile.relativePath)
        await openFile(nextFileKey)
      } else {
        await openFile(null)
      }
    }
  }

  const closeTab = async (fileKey: string): Promise<boolean> => {
    // Check if file is modified and confirm close
    if (modifiedFiles.has(fileKey)) {
      const fileName = openedFiles.find((f) => createFileKey(f.datapackDir, f.relativePath) === fileKey)?.fileName || "this file"
      const choice = await dialog.showUnsavedConfirm("Close File?", `${fileName} has unsaved changes. What would you like to do?`)
      if (choice === "cancel") return false
      if (choice === "save") {
        const didSave = await saveFileInternal(fileKey)
        if (!didSave) return false
      }
      if (choice === "discard") {
        removeFileFromModifiedFiles(fileKey)
      }
    }

    // Clear any pending autosave timer
    clearAutoSaveTimer(fileKey)
    fileEditorStatesRef.current.delete(fileKey)

    // Find the index of the file being closed
    const closingIndex = openedFiles.findIndex((f) => createFileKey(f.datapackDir, f.relativePath) === fileKey)
    const updatedFiles = openedFiles.filter((f) => createFileKey(f.datapackDir, f.relativePath) !== fileKey)
    removeFileFromOpenAndModified(fileKey)
    
    if (activeFile === fileKey) {
      if (updatedFiles.length > 0) {
        // Try to open the next tab (same index), or previous tab if no next tab exists
        const nextIndex = closingIndex < updatedFiles.length ? closingIndex : updatedFiles.length - 1
        const nextFile = updatedFiles[nextIndex]
        const newActive = createFileKey(nextFile.datapackDir, nextFile.relativePath)
        await openFile(newActive)
      } else {
        await openFile(null)
      }
    }

    return true
  }

  // Keep refs in sync with state so they can be used in event listeners and closures
  const activeFileRef = useRef(activeFile)
  useEffect(() => {
    activeFileRef.current = activeFile
  }, [activeFile])

  useEffect(() => {
    datapacksRef.current = datapacks
  }, [datapacks])

  useEffect(() => {
    workspaceDirRef.current = workspaceInfo.dir
  }, [workspaceInfo.dir])

  useEffect(() => {
    const activeDatapackDir = activeFileRef.current ? parseFileKey(activeFileRef.current).datapackDir : null
    let selectedDatapack = datapacksRef.current[0]
    if (activeDatapackDir) {
      selectedDatapack = datapacksRef.current.find((entry) => entry.dir === activeDatapackDir) ?? selectedDatapack
    }
    const nextVersion = selectedDatapack?.minecraftVersion?.trim() || FALLBACK_MINECRAFT_VERSION

    setMinecraftDataVersion((currentVersion) => currentVersion === nextVersion ? currentVersion : nextVersion)
  }, [activeFile, datapacks])

  const runMinecraftDataBootstrap = async () => {
    const runId = minecraftDataBootstrapRunIdRef.current + 1
    minecraftDataBootstrapRunIdRef.current = runId
    setMinecraftDataBootstrapTargetVersion(minecraftDataVersion)
    setMinecraftDataBootstrapProgressPercent(5)
    setMinecraftDataBootstrapProgressMessage(`Checking local cache for Minecraft ${minecraftDataVersion}...`)
    setIsMinecraftDataBootstrapOpen(true)

    try {
      await window.electron.minecraftDataEnsure(minecraftDataVersion)
      const schemaLoaded = await loadMcfunctionCommandSchema(minecraftDataVersion)
      if (!schemaLoaded) {
        throw new Error(`Failed to load command schema for Minecraft ${minecraftDataVersion}.`)
      }
      await loadMinecraftData(minecraftDataVersion)
      if (lastShownJavaVersionErrorRef.current) {
        lastShownJavaVersionErrorRef.current = null
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const errorSignature = `${minecraftDataVersion}|${errorMessage}`
      if (lastShownJavaVersionErrorRef.current !== errorSignature) {
        lastShownJavaVersionErrorRef.current = errorSignature
        dialog.openDialog({
          title: 'Minecraft Version Preparation Failed',
          message: errorMessage,
          buttons: [
            {
              label: 'OK',
              onClick: () => undefined,
            },
          ],
        })
      }
      console.error("Failed to load mcfunction command schema:", error)
    } finally {
      if (minecraftDataBootstrapRunIdRef.current === runId) {
        setIsMinecraftDataBootstrapOpen(false)
      }
    }
  }

  const handlePreferenceAction = async (actionId: string) => {
    if (actionId === 'retryMinecraftDataBootstrap') {
      if (isMinecraftDataBootstrapOpen) return
      await runMinecraftDataBootstrap()
    }
  }

  useEffect(() => {
    void runMinecraftDataBootstrap()
  }, [minecraftDataVersion])

  useEffect(() => {
    const relativePaths = datapacks.flatMap((datapack) => datapack.paths)
    setWorkspaceResourcePathsFromRelativePaths(relativePaths)
  }, [datapacks])

  useEffect(() => {
    const activeDatapackDirs = new Set(datapacks.map((datapack) => datapack.dir))
    for (const datapackDir of explorerContainerRefs.current.keys()) {
      if (!activeDatapackDirs.has(datapackDir)) {
        explorerContainerRefs.current.delete(datapackDir)
      }
    }
  }, [datapacks])

  const buildOpenedModifiedContentMap = () => {
    const openedModifiedContentByFileKey = new Map<string, string>()

    for (const file of openedFilesRef.current) {
      const fileKey = createFileKey(file.datapackDir, file.relativePath)
      if (!modifiedFilesRef.current.has(fileKey)) continue
      openedModifiedContentByFileKey.set(fileKey, file.content)
    }

    return openedModifiedContentByFileKey
  }

  const buildDatapackContextIndexAsync = async (
    datapack: DatapackEntry,
    scanRunId: number,
    openedModifiedContentByFileKey: ReadonlyMap<string, string>,
    seenMcfunctionFileKeys?: Set<string>,
  ) => {
    let mergedIndex = parseMcfunctionContextIndex("")
    const mcfunctionContents: string[] = []

    for (const relativePathRaw of datapack.paths) {
      if (contextScanRunIdRef.current !== scanRunId) return null

      const relativePath = relativePathRaw.replace(/\\/g, "/").replace(/^\/+/, "")
      if (!relativePath.toLowerCase().endsWith(".mcfunction")) continue

      const fileKey = createFileKey(datapack.dir, relativePath)
      seenMcfunctionFileKeys?.add(fileKey)
      let content: string | null = null

      const openedModifiedContent = openedModifiedContentByFileKey.get(fileKey)
      if (openedModifiedContent !== undefined) {
        content = openedModifiedContent
      } else {
        try {
          content = await window.electron.readFile(datapack.dir, relativePath)
        } catch {
          content = null
        }
      }

      if (!content) continue

      const cachedContext = fileContextParseCacheRef.current.get(fileKey)
      const fileContext = cachedContext?.content === content
        ? cachedContext.contextIndex
        : parseMcfunctionContextIndex(content)

      if (!cachedContext || cachedContext.content !== content) {
        fileContextParseCacheRef.current.set(fileKey, {
          content,
          contextIndex: fileContext,
        })
      }

      mergedIndex = mergeMcfunctionContextIndexes(mergedIndex, fileContext)
      mcfunctionContents.push(content)
    }

    // Per-file parsing only links a holder to an objective when both appear in the same
    // file, so objectives declared in one file (e.g. load.mcfunction) and used elsewhere
    // produce no binding. Re-resolve bindings across the whole datapack against the merged
    // objective set so every scoreboard usage shows up in the inspector.
    mergedIndex.objectivesByHolder = resolveDatapackObjectiveBindings(mcfunctionContents, mergedIndex)

    return mergedIndex
  }

  const pruneFileContextParseCache = (validFileKeys: ReadonlySet<string>, targetDatapackDir?: string) => {
    for (const cachedFileKey of fileContextParseCacheRef.current.keys()) {
      if (targetDatapackDir) {
        const cachedDatapackDir = parseFileKey(cachedFileKey).datapackDir
        if (cachedDatapackDir !== targetDatapackDir) continue
      }

      if (!validFileKeys.has(cachedFileKey)) {
        fileContextParseCacheRef.current.delete(cachedFileKey)
      }
    }
  }

  const refreshActiveEditorLint = () => {
    if (!viewRef.current) return

    window.requestAnimationFrame(() => {
      if (viewRef.current) {
        forceLinting(viewRef.current)
      }
    })
  }

  const reloadAllContextsAsync = async () => {
    const currentDatapacks = datapacksRef.current
    if (currentDatapacks.length === 0) {
      clearDatapackContextIndexes()
      fileContextParseCacheRef.current.clear()
      setActiveDatapackContext(null)
      return
    }

    const datapackDirs = currentDatapacks.map((datapack) => datapack.dir)
    pruneDatapackContextIndexes(datapackDirs)

    const scanRunId = contextScanRunIdRef.current + 1
    contextScanRunIdRef.current = scanRunId
    const openedModifiedContentByFileKey = buildOpenedModifiedContentMap()
    const seenMcfunctionFileKeys = new Set<string>()

    for (const datapack of currentDatapacks) {
      if (contextScanRunIdRef.current !== scanRunId) return

      const mergedIndex = await buildDatapackContextIndexAsync(
        datapack,
        scanRunId,
        openedModifiedContentByFileKey,
        seenMcfunctionFileKeys,
      )
      if (!mergedIndex) return

      setDatapackContextIndex(datapack.dir, mergedIndex)
    }

    pruneFileContextParseCache(seenMcfunctionFileKeys)

    const activeDatapackDir = activeFileRef.current
      ? parseFileKey(activeFileRef.current).datapackDir
      : null
    setActiveDatapackContext(activeDatapackDir)

    refreshActiveEditorLint()
  }

  const reloadDatapackContextAsync = async (datapackDir: string) => {
    const scanRunId = contextScanRunIdRef.current + 1
    contextScanRunIdRef.current = scanRunId
    const openedModifiedContentByFileKey = buildOpenedModifiedContentMap()
    const seenMcfunctionFileKeys = new Set<string>()

    const datapack = datapacksRef.current.find(entry => entry.dir === datapackDir)
    if (!datapack) {
      setDatapackContextIndex(datapackDir, null)
      pruneFileContextParseCache(seenMcfunctionFileKeys, datapackDir)

      const activeDatapackDir = activeFileRef.current
        ? parseFileKey(activeFileRef.current).datapackDir
        : null
      setActiveDatapackContext(activeDatapackDir)
      refreshActiveEditorLint()
      return
    }

    const mergedIndex = await buildDatapackContextIndexAsync(
      datapack,
      scanRunId,
      openedModifiedContentByFileKey,
      seenMcfunctionFileKeys,
    )
    if (!mergedIndex) return

    setDatapackContextIndex(datapack.dir, mergedIndex)
    pruneFileContextParseCache(seenMcfunctionFileKeys, datapackDir)

    const activeDatapackDir = activeFileRef.current
      ? parseFileKey(activeFileRef.current).datapackDir
      : null
    setActiveDatapackContext(activeDatapackDir)

    refreshActiveEditorLint()
  }

  const clearContextReloadTimer = () => {
    if (contextReloadTimerRef.current !== null) {
      window.clearTimeout(contextReloadTimerRef.current)
      contextReloadTimerRef.current = null
    }
  }

  const scheduleContextReload = (datapackDir?: string, sourceFileKey?: string) => {
    const requestVersion = contextRefreshRequestedVersionRef.current + 1
    contextRefreshRequestedVersionRef.current = requestVersion

    if (sourceFileKey && modifiedFilesRef.current.has(sourceFileKey)) {
      fileContextRefreshRequiredVersionRef.current.set(sourceFileKey, requestVersion)
    }

    clearContextReloadTimer()

    contextReloadTimerRef.current = window.setTimeout(() => {
      void queueContextsThenDiagnosticsReload(datapackDir)
      contextReloadTimerRef.current = null
    }, 1000)
  }

  const mergeContextDiagnosticsTargets = (
    existingTarget: string | null | undefined,
    incomingTarget: string | undefined,
  ): string | null | undefined => {
    const normalizedIncoming = incomingTarget ?? undefined
    if (existingTarget === undefined || normalizedIncoming === undefined) {
      return undefined
    }

    if (existingTarget === null) {
      return normalizedIncoming ?? null
    }

    if (normalizedIncoming === null) {
      return existingTarget
    }

    if (existingTarget === normalizedIncoming) {
      return existingTarget
    }

    return undefined
  }

  const queueContextsThenDiagnosticsReload = async (datapackDir?: string) => {
    queuedContextDiagnosticsTargetRef.current = mergeContextDiagnosticsTargets(
      queuedContextDiagnosticsTargetRef.current,
      datapackDir,
    )

    if (contextDiagnosticsIsRunningRef.current) {
      return
    }

    let drainedSuccessfully = false
    contextDiagnosticsIsRunningRef.current = true
    setDiagnosticRefreshStatus((prev) => ({
      ...prev,
      visible: true,
      percent: 0,
      label: 'Refreshing diagnostics...',
    }))
    try {
      while (queuedContextDiagnosticsTargetRef.current !== null) {
        const nextTarget = queuedContextDiagnosticsTargetRef.current
        queuedContextDiagnosticsTargetRef.current = null
        await reloadContextsThenDiagnosticsAsync(nextTarget === null ? undefined : nextTarget)
      }
      drainedSuccessfully = true
    } finally {
      if (drainedSuccessfully) {
        contextRefreshCompletedVersionRef.current = contextRefreshRequestedVersionRef.current
      }
      contextDiagnosticsIsRunningRef.current = false
      setDiagnosticRefreshStatus((prev) => ({
        ...prev,
        visible: false,
      }))
    }
  }

  const reloadContextsThenDiagnosticsAsync = async (datapackDir?: string) => {
    const pipelineRunId = contextDiagnosticsPipelineRunIdRef.current + 1
    contextDiagnosticsPipelineRunIdRef.current = pipelineRunId

    if (datapackDir) {
      await reloadDatapackContextAsync(datapackDir)
    } else {
      await reloadAllContextsAsync()
    }
    if (contextDiagnosticsPipelineRunIdRef.current !== pipelineRunId) return

    await reloadAllDiagnosticsAsync(datapackDir)
    setInspectorContextRevision((prev) => prev + 1)
  }

  const resolveDatapackMinecraftVersion = (datapackDir: string): string => {
    const datapack = datapacksRef.current.find((entry) => entry.dir === datapackDir)
    const normalized = datapack?.minecraftVersion?.trim()
    return normalized || FALLBACK_MINECRAFT_VERSION
  }

  const ensureDiagnosticsResourcesForVersion = async (version: string): Promise<boolean> => {
    try {
      await window.electron.minecraftDataEnsure(version)
      const schemaLoaded = await loadMcfunctionCommandSchema(version)
      if (!schemaLoaded) {
        throw new Error(`Failed to load command schema for Minecraft ${version}.`)
      }
      await loadMinecraftData(version)
      return true
    } catch (error) {
      console.error(`Failed to prepare diagnostics resources for Minecraft ${version}:`, error)
      return false
    }
  }

  const refreshActiveEditorForLoadedVersion = () => {
    const activeFileKey = activeFileRef.current
    const view = viewRef.current
    if (!activeFileKey || !view) {
      return
    }

    const { relativePath, datapackDir } = parseFileKey(activeFileKey)
    const language = detectEditorLanguage(relativePath)
    if (language.id !== "mcfunction") {
      refreshActiveEditorLint()
      return
    }

    const activeOpenedFile = openedFilesRef.current.find((file) =>
      createFileKey(file.datapackDir, file.relativePath) === activeFileKey,
    )
    if (!activeOpenedFile) {
      refreshActiveEditorLint()
      return
    }

    // Rebuilding EditorState clears undo history. Keep current state and re-lint instead.
    setActiveDatapackContext(datapackDir)
    setCursorMarkerInfo(getCursorMarkerInfo(view.state))
    refreshActiveEditorLint()
  }

  const restoreActiveEditorVersionResourcesAsync = async (shouldCancel: () => boolean): Promise<void> => {
    const activeDatapackDir = activeFileRef.current
      ? parseFileKey(activeFileRef.current).datapackDir
      : null
    if (!activeDatapackDir) {
      return
    }

    const activeVersion = resolveDatapackMinecraftVersion(activeDatapackDir)
    const restored = await ensureDiagnosticsResourcesForVersion(activeVersion)
    if (!restored || shouldCancel()) {
      return
    }

    refreshActiveEditorForLoadedVersion()
  }

  const reloadAllDiagnosticsAsync = async (scanDatapackDir?: string) => {
    const currentWorkspaceDir = workspaceDirRef.current
    const currentDatapacks = datapacksRef.current

    if (!currentWorkspaceDir || currentDatapacks.length === 0) {
      setDiagnosticRefreshStatus((prev) => ({
        ...prev,
        visible: false,
      }))
      setFileDiagnosticSummaries((prev) => {
        const preserved: Record<string, DiagnosticSummary> = {}
        for (const [fileKey, summary] of Object.entries(prev)) {
          if (modifiedFilesRef.current.has(fileKey)) {
            preserved[fileKey] = summary
          }
        }
        return preserved
      })
      return
    }

    const scanRunId = diagnosticsScanRunIdRef.current + 1
    diagnosticsScanRunIdRef.current = scanRunId

    const shouldCancel = () => diagnosticsScanRunIdRef.current !== scanRunId

    if (scanDatapackDir) {
      const targetVersion = resolveDatapackMinecraftVersion(scanDatapackDir)
      setDiagnosticRefreshStatus({
        visible: true,
        percent: 15,
        label: `Refreshing diagnostics...`,
      })
      const resourcesReady = await ensureDiagnosticsResourcesForVersion(targetVersion)
      if (shouldCancel()) return
      if (!resourcesReady) return

      setDiagnosticRefreshStatus((prev) => ({
        ...prev,
        percent: 50,
        label: `Scanning diagnostics...`,
      }))

      const nextSummaries = await runGlobalDiagnosticsScan({
        datapacks: currentDatapacks,
        openedFiles: openedFilesRef.current,
        modifiedFileKeys: modifiedFilesRef.current,
        readFile: (datapackDir, relativePath) => window.electron.readFile(datapackDir, relativePath),
        targetDatapackDirs: [scanDatapackDir],
        shouldCancel,
      })

      if (!nextSummaries) return
      if (shouldCancel()) return

      setDiagnosticRefreshStatus((prev) => ({
        ...prev,
        percent: 90,
        label: `Finalizing diagnostics...`,
      }))

      setFileDiagnosticSummaries((prev) => {
        const next = { ...prev }

        for (const fileKey of Object.keys(next)) {
          const fileDatapackDir = parseFileKey(fileKey).datapackDir
          if (fileDatapackDir !== scanDatapackDir) continue
          if (modifiedFilesRef.current.has(fileKey)) continue
          delete next[fileKey]
        }

        for (const [fileKey, summary] of Object.entries(nextSummaries)) {
          next[fileKey] = summary
        }

        for (const [fileKey, summary] of Object.entries(prev)) {
          if (!modifiedFilesRef.current.has(fileKey)) continue
          const fileDatapackDir = parseFileKey(fileKey).datapackDir
          if (fileDatapackDir === scanDatapackDir) continue
          next[fileKey] = summary
        }

        return next
      })

      await restoreActiveEditorVersionResourcesAsync(shouldCancel)
      return
    }

    const datapackDirsByVersion = new Map<string, string[]>()
    for (const datapack of currentDatapacks) {
      const normalizedVersion = datapack.minecraftVersion?.trim() || FALLBACK_MINECRAFT_VERSION
      const existing = datapackDirsByVersion.get(normalizedVersion)
      if (existing) {
        existing.push(datapack.dir)
      } else {
        datapackDirsByVersion.set(normalizedVersion, [datapack.dir])
      }
    }

    const orderedVersions = Array.from(datapackDirsByVersion.keys())
    const loadedVersionIndex = orderedVersions.indexOf(minecraftDataVersion)
    if (loadedVersionIndex > 0) {
      const [loadedVersion] = orderedVersions.splice(loadedVersionIndex, 1)
      orderedVersions.unshift(loadedVersion)
    }

    const mergedSummaries: Record<string, DiagnosticSummary> = {}
    const scannedDatapackDirs = new Set<string>()
    const totalVersions = Math.max(orderedVersions.length, 1)

    for (const [index, version] of orderedVersions.entries()) {
      const resourcesReady = await ensureDiagnosticsResourcesForVersion(version)
      if (shouldCancel()) return
      if (!resourcesReady) {
        continue
      }

      setDiagnosticRefreshStatus({
        visible: true,
        percent: Math.round((index / totalVersions) * 100),
        label: `Refreshing diagnostics...`,
      })

      const targetDirs = datapackDirsByVersion.get(version) ?? []
      if (targetDirs.length === 0) continue

      const versionSummaries = await runGlobalDiagnosticsScan({
        datapacks: currentDatapacks,
        openedFiles: openedFilesRef.current,
        modifiedFileKeys: modifiedFilesRef.current,
        readFile: (datapackDir, relativePath) => window.electron.readFile(datapackDir, relativePath),
        targetDatapackDirs: targetDirs,
        shouldCancel,
      })

      if (!versionSummaries) return
      if (shouldCancel()) return

      setDiagnosticRefreshStatus({
        visible: true,
        percent: Math.round(((index + 0.75) / totalVersions) * 100),
        label: `Scanning diagnostics...`,
      })

      for (const [fileKey, summary] of Object.entries(versionSummaries)) {
        mergedSummaries[fileKey] = summary
      }

      for (const datapackDir of targetDirs) {
        scannedDatapackDirs.add(datapackDir)
      }
    }

    if (shouldCancel()) return

    setDiagnosticRefreshStatus((prev) => ({
      ...prev,
      percent: 100,
      label: 'Finalizing diagnostics...',
    }))

    setFileDiagnosticSummaries((prev) => {
      const next = { ...prev }

      for (const fileKey of Object.keys(next)) {
        const fileDatapackDir = parseFileKey(fileKey).datapackDir
        if (!scannedDatapackDirs.has(fileDatapackDir)) continue
        if (modifiedFilesRef.current.has(fileKey)) continue
        delete next[fileKey]
      }

      for (const [fileKey, summary] of Object.entries(mergedSummaries)) {
        next[fileKey] = summary
      }

      return next
    })

    await restoreActiveEditorVersionResourcesAsync(shouldCancel)
    return
  }

  useEffect(() => {
    clearContextReloadTimer()
    void queueContextsThenDiagnosticsReload()

    return () => {
      clearContextReloadTimer()
      queuedContextDiagnosticsTargetRef.current = null
    }
  }, [workspaceInfo.dir, datapacks])

  const createEditorState = (doc: string, fileKey: string | null = activeFileRef.current) => {
    const relativePath = fileKey ? parseFileKey(fileKey).relativePath : null
    const language = detectEditorLanguage(relativePath)

    if (!language.supportsDiagnostics) {
      setDiagnosticSummary(defaultDiagnosticSummary)
      if (fileKey) {
        removeFileFromDiagnosticSummaries(fileKey)
      }
    }

    const handleDiagnosticSummaryChange = (summary: DiagnosticSummary) => {
      const isUnsavedFile = Boolean(fileKey && modifiedFilesRef.current.has(fileKey))

      if (fileKey && !isUnsavedFile) {
        setFileDiagnosticSummaries((prev) => ({
          ...prev,
          [fileKey]: summary,
        }))
      }

      if (activeFileRef.current === fileKey) {
        if (!fileKey || !isUnsavedFile) {
          setDiagnosticSummaryFromCache(fileKey)
          return
        }

        const requiredRefreshVersion = fileContextRefreshRequiredVersionRef.current.get(fileKey) ?? 0
        if (contextRefreshCompletedVersionRef.current >= requiredRefreshVersion) {
          setDiagnosticSummary(summary)
        }
      }
    }

    return EditorState.create({
      doc,
      extensions: [
        portylDarkTheme,
        ...codeMirrorSetupExtensions,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.selectionSet || update.docChanged) {
            setCursorMarkerInfo(getCursorMarkerInfo(update.state))
          }

          const hasUserDocEdit = update.docChanged && update.transactions.some((transaction) => {
            const userEvent = transaction.annotation(Transaction.userEvent)
            return typeof userEvent === "string" && userEvent.length > 0
          })

          if (hasUserDocEdit && activeFileRef.current) {
            const fileKey = activeFileRef.current
            const newContent = update.state.doc.toString()
            modifiedFilesRef.current = new Set(modifiedFilesRef.current)
            modifiedFilesRef.current.add(fileKey)
            setModifiedFiles((prev) => new Set(prev).add(fileKey))

            setOpenedFiles((prev) =>
              prev.map((f) =>
                createFileKey(f.datapackDir, f.relativePath) === fileKey
                  ? { ...f, content: newContent }
                  : f
              )
            )

            scheduleAutoSave(fileKey, newContent)
            scheduleContextReload(parseFileKey(fileKey).datapackDir, fileKey)
          }
        }),
        EditorView.domEventHandlers({
          focus: () => {
            isEditorFocusedRef.current = true
            window.requestAnimationFrame(() => {
              scrollTabIntoView(activeFileRef.current, "smooth")
              focusFileInExplorer(activeFileRef.current)
            })
          },
          blur: () => {
            isEditorFocusedRef.current = false
          },
        }),
        ...getLanguageProcessingExtensions(language.id, handleDiagnosticSummaryChange),
      ],
    })
  }

  const persistActiveEditorState = () => {
    const currentFileKey = activeFileRef.current
    const view = viewRef.current
    if (!currentFileKey || !view) return
    fileEditorStatesRef.current.set(currentFileKey, view.state)
  }

  const scrollTabIntoView = (fileKey: string | null, behavior: ScrollBehavior = "smooth") => {
    if (!fileKey) return

    const activeTabElement = tabElementRefs.current.get(fileKey)
    if (!activeTabElement) return

    activeTabElement.scrollIntoView({
      behavior,
      block: "nearest",
      inline: "nearest",
    })
  }

  useEffect(() => {
    isAutoSaveEnabledRef.current = isAutoSaveEnabled
  }, [isAutoSaveEnabled])

  useEffect(() => {
    openedFilesRef.current = openedFiles
  }, [openedFiles])

  useEffect(() => {
    previewFileKeyRef.current = previewFileKey
  }, [previewFileKey])

  useEffect(() => {
    modifiedFilesRef.current = modifiedFiles
  }, [modifiedFiles])

  useEffect(() => {
    fileDiagnosticSummariesRef.current = fileDiagnosticSummaries
  }, [fileDiagnosticSummaries])

  useEffect(() => {
    if (previewFileKey && modifiedFiles.has(previewFileKey)) {
      setPreviewFileKey(null)
    }
  }, [modifiedFiles, previewFileKey])

  useEffect(() => {
    if (!previewFileKey) return
    const exists = openedFiles.some((file) => createFileKey(file.datapackDir, file.relativePath) === previewFileKey)
    if (!exists) {
      setPreviewFileKey(null)
    }
  }, [openedFiles, previewFileKey])

  // Handle workspace tab restoration on workspace load
  useEffect(() => {
    const restoreWorkspaceTabs = async () => {
      if (!workspaceInfo.dir) return

      isRestoringTabsRef.current = true
      try {
        const savedValue = await window.electron.workspaceGetPreference(OPEN_TABS_PREFERENCE_KEY)
        const session = parseWorkspaceTabSession(savedValue)

        if (!session || session.openedFiles.length === 0) {
          setOpenedFiles([])
          await openFile(null)
          lastSavedTabSessionSignatureRef.current = JSON.stringify({ openedFiles: [], activeFile: null })
          return
        }

        const restoredOpenedFiles: OpenedFile[] = []
        for (const file of session.openedFiles) {
          try {
            const content = await window.electron.readFile(file.datapackDir, file.relativePath)
            restoredOpenedFiles.push({
              datapackDir: file.datapackDir,
              relativePath: file.relativePath,
              fileName: file.relativePath.split("/").pop() || file.relativePath,
              content,
            })
          } catch {
            // Skip files that no longer exist or cannot be read
          }
        }

        if (restoredOpenedFiles.length === 0) {
          setOpenedFiles([])
          await openFile(null)
          lastSavedTabSessionSignatureRef.current = JSON.stringify({ openedFiles: [], activeFile: null })
          return
        }

        setOpenedFiles(restoredOpenedFiles)
        setModifiedFiles(new Set())
        setFileDiagnosticSummaries({})

        const availableKeys = new Set(
          restoredOpenedFiles.map((file) => createFileKey(file.datapackDir, file.relativePath))
        )
        const nextActiveFile = session.activeFile && availableKeys.has(session.activeFile)
          ? session.activeFile
          : createFileKey(restoredOpenedFiles[0].datapackDir, restoredOpenedFiles[0].relativePath)

        await openFile(nextActiveFile)

        lastSavedTabSessionSignatureRef.current = JSON.stringify({
          openedFiles: restoredOpenedFiles.map((file) => ({
            datapackDir: file.datapackDir,
            relativePath: file.relativePath,
          })),
          activeFile: nextActiveFile,
        })
      } catch (error) {
        console.error("Failed to restore workspace tabs:", error)
        await dialog.showAlert("Error", `Failed to restore workspace tabs: ${error instanceof Error ? error.message : "Unknown error"}`)
        setOpenedFiles([])
        await openFile(null)
      } finally {
        isRestoringTabsRef.current = false
      }
    }

    restoreWorkspaceTabs()
  }, [workspaceInfo.dir])

  useEffect(() => {
    const restoreExplorerExpanded = async () => {
      if (!workspaceInfo.dir) {
        setExplorerExpandedPathsByDatapack({})
        return
      }

      isRestoringExplorerRef.current = true
      try {
        const savedValue = await window.electron.workspaceGetPreference(EXPLORER_EXPANDED_PREFERENCE_KEY)
        const parsed = parseWorkspaceExplorerExpanded(savedValue)
        setExplorerExpandedPathsByDatapack(parsed ?? {})
      } catch (error) {
        console.error("Failed to restore explorer expansion state:", error)
        await dialog.showAlert("Error", `Failed to restore explorer expansion state: ${error instanceof Error ? error.message : "Unknown error"}`)
        setExplorerExpandedPathsByDatapack({})
      } finally {
        isRestoringExplorerRef.current = false
      }
    }

    restoreExplorerExpanded()
  }, [workspaceInfo.dir])

  useEffect(() => {
    const restoreExplorerTagFilter = async () => {
      if (!workspaceInfo.dir) {
        setSelectedExplorerTags(new Set())
        setExplorerTagMatchMode("any")
        return
      }

      isRestoringExplorerTagFilterRef.current = true
      try {
        const savedValue = await window.electron.workspaceGetPreference(EXPLORER_TAG_FILTER_PREFERENCE_KEY)
        const parsed = parseWorkspaceExplorerTagFilter(savedValue)
        if (parsed) {
          setSelectedExplorerTags(parsed.selectedTags)
          setExplorerTagMatchMode(parsed.matchAny ? "any" : "exact")
        } else {
          setSelectedExplorerTags(new Set())
          setExplorerTagMatchMode("any")
        }
      } catch (error) {
        console.error("Failed to restore explorer tag filter state:", error)
        await dialog.showAlert("Error", `Failed to restore explorer tag filter state: ${error instanceof Error ? error.message : "Unknown error"}`)
        setSelectedExplorerTags(new Set())
        setExplorerTagMatchMode("any")
      } finally {
        isRestoringExplorerTagFilterRef.current = false
      }
    }

    restoreExplorerTagFilter()
  }, [workspaceInfo.dir])

  useEffect(() => {
    const restoreInspectorSectionExpansion = async () => {
      if (!workspaceInfo.dir) {
        setInspectorSectionExpansionById({})
        return
      }

      isRestoringInspectorSectionExpansionRef.current = true
      try {
        const savedValue = await window.electron.workspaceGetPreference(INSPECTOR_SECTION_EXPANDED_PREFERENCE_KEY)
        const parsed = parseWorkspaceInspectorSectionExpansion(savedValue)
        setInspectorSectionExpansionById(parsed ?? {})
      } catch (error) {
        console.error("Failed to restore inspector section expansion state:", error)
        await dialog.showAlert("Error", `Failed to restore inspector section expansion state: ${error instanceof Error ? error.message : "Unknown error"}`)
        setInspectorSectionExpansionById({})
      } finally {
        isRestoringInspectorSectionExpansionRef.current = false
      }
    }

    restoreInspectorSectionExpansion()
  }, [workspaceInfo.dir])

  useEffect(() => {
    const persistWorkspaceTabs = async () => {
      if (!workspaceInfo.dir) return
      if (isRestoringTabsRef.current) return

      const session: WorkspaceTabSession = {
        openedFiles: openedFiles.map((file) => ({
          datapackDir: file.datapackDir,
          relativePath: file.relativePath,
        })),
        activeFile,
      }

      const signature = JSON.stringify(session)
      if (signature === lastSavedTabSessionSignatureRef.current) return

      lastSavedTabSessionSignatureRef.current = signature
      try {
        await window.electron.workspaceUpdatePreference(OPEN_TABS_PREFERENCE_KEY, session)
      } catch (error) {
        console.error("Failed to save workspace tab session:", error)
        await dialog.showAlert("Error", `Failed to save workspace tab session: ${error instanceof Error ? error.message : "Unknown error"}`)
      }
    }

    persistWorkspaceTabs()
  }, [workspaceInfo.dir, openedFiles, activeFile])

  useEffect(() => {
    const persistExplorerExpanded = async () => {
      if (!workspaceInfo.dir) return
      if (isRestoringExplorerRef.current) return

      const payload: Record<string, string[]> = {}
      for (const [dir, paths] of Object.entries(explorerExpandedPathsByDatapack)) {
        payload[dir] = Array.from(paths)
      }

      try {
        await window.electron.workspaceUpdatePreference(EXPLORER_EXPANDED_PREFERENCE_KEY, payload)
      } catch (error) {
        console.error("Failed to save explorer expansion state:", error)
        await dialog.showAlert("Error", `Failed to save explorer expansion state: ${error instanceof Error ? error.message : "Unknown error"}`)
      }
    }

    persistExplorerExpanded()
  }, [workspaceInfo.dir, explorerExpandedPathsByDatapack])

  useEffect(() => {
    const persistExplorerTagFilter = async () => {
      if (!workspaceInfo.dir) return
      if (isRestoringExplorerTagFilterRef.current) return

      const payload = {
        selectedTags: Array.from(selectedExplorerTags).sort((left, right) => left.localeCompare(right)),
        matchAny: explorerTagMatchMode === "any",
      }

      try {
        await window.electron.workspaceUpdatePreference(EXPLORER_TAG_FILTER_PREFERENCE_KEY, payload)
      } catch (error) {
        console.error("Failed to save explorer tag filter state:", error)
        await dialog.showAlert("Error", `Failed to save explorer tag filter state: ${error instanceof Error ? error.message : "Unknown error"}`)
      }
    }

    persistExplorerTagFilter()
  }, [workspaceInfo.dir, selectedExplorerTags, explorerTagMatchMode])
  useEffect(() => {
    const persistInspectorSectionExpansion = async () => {
      if (!workspaceInfo.dir) return
      if (isRestoringInspectorSectionExpansionRef.current) return

      try {
        await window.electron.workspaceUpdatePreference(
          INSPECTOR_SECTION_EXPANDED_PREFERENCE_KEY,
          inspectorSectionExpansionById,
        )
      } catch (error) {
        console.error("Failed to save inspector section expansion state:", error)
        await dialog.showAlert("Error", `Failed to save inspector section expansion state: ${error instanceof Error ? error.message : "Unknown error"}`)
      }
    }

    persistInspectorSectionExpansion()
  }, [workspaceInfo.dir, inspectorSectionExpansionById])

  // Pause auto-save while dialogs are open to prevent saves during user confirmation prompts
  // Resume auto-save when dialog closes to continue saving modified files
  useEffect(() => {
    const wasOpen = isDialogOpenRef.current
    isDialogOpenRef.current = dialog.isOpen
    
    if (dialog.isOpen) {
      // Clear all auto-save timers when dialog opens
      autoSaveTimersRef.current.forEach((timerId) => window.clearTimeout(timerId))
      autoSaveTimersRef.current.clear()
    } else if (wasOpen && !dialog.isOpen) {
      // Dialog just closed - restart auto-save for all modified files
      modifiedFiles.forEach((fileKey) => {
        const openedFile = openedFiles.find((f) => createFileKey(f.datapackDir, f.relativePath) === fileKey)
        if (openedFile) {
          scheduleAutoSave(fileKey, openedFile.content)
        }
      })
    }
  }, [dialog.isOpen, modifiedFiles, openedFiles])

  useEffect(() => {
    if (!editorRef.current) return

    const state = createEditorState("")

    const view = new EditorView({
      state,
      parent: editorRef.current,
    })

    viewRef.current = view
    setCursorMarkerInfo(getCursorMarkerInfo(view.state))

    return () => {
      view.destroy()
      // Clear all autosave timers on unmount
      autoSaveTimersRef.current.forEach((timerId) => window.clearTimeout(timerId))
      autoSaveTimersRef.current.clear()
      clearContextReloadTimer()
      fileEditorStatesRef.current.clear()
      fileContextParseCacheRef.current.clear()
      explorerContainerRefs.current.clear()
    }
  }, [])

  useEffect(() => {
    ;window.electron.isFullScreen().then(setIsFullScreen)

    const unsubscribeFullscreenChange = window.electron.onFullscreenChange((isFullScreen: boolean) => {
      setIsFullScreen(isFullScreen)
    })

    const unsubscribeTitlebarContextMenu = window.electron.onTitlebarContextMenu?.((position: { x: number; y: number }) => {
      contextMenuRequest.openAt(position.x, position.y, { items: titlebarContextItems })
    })

    return () => {
      if (typeof unsubscribeFullscreenChange === "function") {
        unsubscribeFullscreenChange()
      }
      if (typeof unsubscribeTitlebarContextMenu === "function") {
        unsubscribeTitlebarContextMenu()
      }
    }
  }, [])

  useEffect(() => {
    const unsubscribeQuitRequested = window.electron.onQuitRequested(() => {
      void handleQuitWithConfirm(true)
    })

    return () => {
      if (typeof unsubscribeQuitRequested === "function") {
        unsubscribeQuitRequested()
      }
    }
  }, [handleQuitWithConfirm])

  // Keyboard shortcuts
  useEffect(() => {
    const hasBlockingOverlayOpen = () => {
      const hasOpenMenu = document.querySelector('[data-overlay-menu="true"]') !== null
      const hasOpenDialog = document.querySelector('[data-overlay-dialog="true"]') !== null
      return hasOpenMenu || hasOpenDialog
    }

    const handler = (_event: unknown, action: ShortcutAction) => {
      if (hasBlockingOverlayOpen()) return

      switch (action) {
        case "quit":
          handleQuitWithConfirm()
          break
        case "open":
          handleOpenWorkspaceWithConfirm()
          break
        case "save":
          if (activeFile && modifiedFiles.has(activeFile)) saveCurrentFile()
          break
        case "saveAll":
          if (modifiedFiles.size > 0) saveAllFiles()
          break
        case "close":
          if (activeFile) closeTab(activeFile)
          break
      }
    }

    const unsubscribe = window.electron.onShortcut(handler)
    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe()
      }
    }
  }, [activeFile, modifiedFiles, handleOpenWorkspaceWithConfirm, handleQuitWithConfirm, saveCurrentFile, saveAllFiles, closeTab])

  useEffect(() => {
    const isExplorerFocused = () => {
      const activeElement = document.activeElement
      if (!activeElement) return false

      for (const containerRef of explorerContainerRefs.current.values()) {
        const container = containerRef.current
        if (container && (container === activeElement || container.contains(activeElement))) {
          return true
        }
      }

      return false
    }

    const handleKeyDown = async (event: KeyboardEvent) => {
      if ((event.key !== 'F2' && event.key !== 'Delete') || event.defaultPrevented) return
      if (isDialogOpenRef.current) return
      if (!isExplorerFocused()) return

      const fileKey = activeFileRef.current
      if (!fileKey) return

      const { datapackDir, relativePath } = parseFileKey(fileKey)
      const openedFile = openedFilesRef.current.find((file) => createFileKey(file.datapackDir, file.relativePath) === fileKey)
      const currentName = openedFile?.fileName || relativePath.split('/').filter(Boolean).pop() || 'this file'
      const fullPath = `${datapackDir}/${relativePath}`.replace(/\//g, "\\")

      event.preventDefault()

      if (event.key === 'F2') {
        await renamePathWithPrompt({
          fullPath,
          currentName,
          promptRename: dialog.showPrompt,
          showError: dialog.showAlert,
          preRenameCheck: () => handleFileRenamed(datapackDir, relativePath, ''),
          onRenamed: async (newName) => {
            await handleFileRenamed(datapackDir, relativePath, newName)
            await refreshDatapacks(datapacksRef.current.map((datapack) => datapack.dir))
          },
        })
        return
      }

      await deletePathWithConfirm({
        fullPath,
        itemName: currentName,
        itemType: "file",
        confirmDelete: dialog.showConfirm,
        showError: dialog.showAlert,
        preDeleteCheck: () => confirmFileDelete(datapackDir, relativePath),
        onDeleted: async () => {
          await closeDeletedFileTab(datapackDir, relativePath)
          await refreshDatapacks(datapacksRef.current.map((datapack) => datapack.dir))
        },
      })
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [dialog.showPrompt, dialog.showConfirm, dialog.showAlert, handleFileRenamed, confirmFileDelete, refreshDatapacks])

  useEffect(() => {
    const loadWorkspaceDatapacks = async () => {
      if (!workspaceInfo.dir) return
      try {
        const metadataPaths = await handleGetDatapacks()
        await refreshWorkspaceDatapacks(metadataPaths)
      } catch (error) {
        console.error("Failed to load workspace datapacks:", error)
        await dialog.showAlert("Error", `Failed to load workspace datapacks: ${error instanceof Error ? error.message : "Unknown error"}`)
      }
    }

    loadWorkspaceDatapacks()
  }, [workspaceInfo.dir])

  const activeRelativePath = activeFile ? parseFileKey(activeFile).relativePath : null
  const activeLanguage = detectEditorLanguage(activeRelativePath)
  const showDiagnosticSummary = activeLanguage.supportsDiagnostics
  const activeFileRelativePathLabel = activeRelativePath
    ? getPathSegments(activeRelativePath).join(" > ")
    : "No file open"

  const fileNameCounts = openedFiles.reduce((counts, file) => {
    counts.set(file.fileName, (counts.get(file.fileName) ?? 0) + 1)
    return counts
  }, new Map<string, number>())

  const getDuplicateTabFolderLabel = (file: OpenedFile): string | null => {
    if ((fileNameCounts.get(file.fileName) ?? 0) < 2) return null

    const datapackName = getPathLeafName(file.datapackDir)
    const dirs = file.relativePath.split("/").filter(Boolean).slice(0, -1)
    const segments = [datapackName, ...dirs].filter(Boolean)

    const siblings = openedFiles.filter((candidate) => candidate.fileName === file.fileName)
    if (siblings.length < 2) return null

    const siblingSegments = siblings.map((candidate) => {
      const candidateDatapack = getPathLeafName(candidate.datapackDir)
      const candidateDirs = candidate.relativePath.split("/").filter(Boolean).slice(0, -1)
      return [candidateDatapack, ...candidateDirs].filter(Boolean)
    })

    for (let i = 0; i < segments.length; i += 1) {
      const value = segments[i]
      const differs = siblingSegments.some((candidate) => candidate[i] !== value)
      if (differs) return `../${value}`
    }

    const fallback = segments[segments.length - 1]
    return fallback ? `../${fallback}` : null
  }

  const handleTabsWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const tabs = tabsRef.current
    if (!tabs) return

    const horizontalDelta = event.deltaX !== 0 ? event.deltaX : event.deltaY
    if (horizontalDelta === 0) return

    const scrollFactor = 0.5
    tabs.scrollLeft += horizontalDelta * scrollFactor
    event.preventDefault()
  }

  const getExplorerContainerRef = (datapackDir: string) => {
    const existing = explorerContainerRefs.current.get(datapackDir)
    if (existing) return existing
    const created = React.createRef<HTMLDivElement | null>()
    explorerContainerRefs.current.set(datapackDir, created)
    return created
  }

  const buildExpandedPathsForFile = (rootName: string, relativePath: string) => {
    const normalizedRelative = trimLeadingSlashes(normalizePathSeparators(relativePath))
    const segments = getPathSegments(normalizedRelative)
    const next = new Set<string>()
    if (!rootName) return next
    next.add(rootName)
    let current = rootName
    for (let i = 0; i < segments.length - 1; i += 1) {
      current = `${current}/${segments[i]}`
      next.add(current)
    }
    return next
  }

  const focusFileInExplorer = (fileKey: string | null) => {
    if (!fileKey) return
    const { datapackDir, relativePath } = parseFileKey(fileKey)
    const rootName = getPathLeafName(datapackDir)
    if (!rootName) return

    const normalizedRelative = trimLeadingSlashes(normalizePathSeparators(relativePath))
    const pathKey = normalizedRelative ? `${rootName}/${normalizedRelative}` : rootName
    const requiredExpanded = buildExpandedPathsForFile(rootName, normalizedRelative)

    setExplorerSelectedPathsByDatapack((prev) => {
      const next: Record<string, string | null> = {}
      for (const key of Object.keys(prev)) {
        next[key] = null
      }
      next[datapackDir] = pathKey
      return next
    })

    setExplorerSelectedFileKeysByDatapack((prev) => {
      const next: Record<string, string | null> = {}
      for (const key of Object.keys(prev)) {
        next[key] = null
      }
      next[datapackDir] = fileKey
      return next
    })

    setExplorerExpandedPathsByDatapack((prev) => {
      const existing = prev[datapackDir] ?? new Set<string>()
      const next = new Set(existing)
      requiredExpanded.forEach((value) => next.add(value))
      return {
        ...prev,
        [datapackDir]: next,
      }
    })

    setExplorerSelectionRevealNonceByDatapack((prev) => ({
      ...prev,
      [datapackDir]: (prev[datapackDir] ?? 0) + 1,
    }))
  }

  const registerTabElement = (fileKey: string, element: HTMLDivElement | null) => {
    if (element) {
      tabElementRefs.current.set(fileKey, element)
      return
    }

    tabElementRefs.current.delete(fileKey)
  }

  const handleTabRightClick = (event: React.MouseEvent, fileKey: string) => {
    contextMenuRequest.openForEvent(event, { items: createTabContextItems(fileKey) })
  }

  const handleTitlebarRightClick = (event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    contextMenuRequest.openForEvent(event, { items: titlebarContextItems })
  }

  const handleDatapackTreeContextMenu = (event: React.MouseEvent, items: MenuItem[]) => {
    contextMenuRequest.openForEvent(event, { items })
  }

  const getOpenedFileKeys = () =>
    openedFiles.map((file) => createFileKey(file.datapackDir, file.relativePath))

  const pinPreviewTab = (fileKey: string) => {
    setPreviewFileKey((prev) => (prev === fileKey ? null : prev))
  }

  const reorderOpenedFiles = (draggedFileKey: string, targetFileKey: string, position: "before" | "after") => {
    const draggedIndex = openedFiles.findIndex(
      (f) => createFileKey(f.datapackDir, f.relativePath) === draggedFileKey
    )
    const targetIndex = openedFiles.findIndex(
      (f) => createFileKey(f.datapackDir, f.relativePath) === targetFileKey
    )

    if (draggedIndex === -1 || targetIndex === -1) return

    const newFiles = [...openedFiles]
    const [draggedFile] = newFiles.splice(draggedIndex, 1)

    const insertIndex = position === "after"
      ? draggedIndex < targetIndex
        ? targetIndex
        : targetIndex + 1
      : draggedIndex < targetIndex
        ? targetIndex - 1
        : targetIndex

    newFiles.splice(insertIndex, 0, draggedFile)
    setOpenedFiles(newFiles)
  }

  const getDatapackMetadataPath = (datapackDir: string) => {
    const normalizedDir = datapackDir.replace(/\\/g, "/").replace(/\/+$/, "")
    return `${normalizedDir}/.mpp-datapack`
  }

  const reorderDatapacks = (entries: DatapackEntry[], draggedDir: string, targetDir: string, position: "before" | "after") => {
    const draggedIndex = entries.findIndex((entry) => entry.dir === draggedDir)
    const targetIndex = entries.findIndex((entry) => entry.dir === targetDir)

    if (draggedIndex === -1 || targetIndex === -1) return entries
    if (draggedIndex === targetIndex) return entries

    const destinationIndex = position === "after"
      ? targetIndex + 1
      : targetIndex
    const normalizedInsertIndex = destinationIndex > draggedIndex
      ? destinationIndex - 1
      : destinationIndex

    if (normalizedInsertIndex === draggedIndex) {
      return entries
    }

    const nextEntries = [...entries]
    const [draggedEntry] = nextEntries.splice(draggedIndex, 1)

    const insertIndex = normalizedInsertIndex

    nextEntries.splice(insertIndex, 0, draggedEntry)
    return nextEntries
  }

  const collapseDatapacks = (predicate?: (entry: DatapackEntry) => boolean) => {
    setExplorerExpandedPathsByDatapack((prev) => {
      const next: Record<string, Set<string>> = { ...prev }

      for (const datapack of datapacksRef.current) {
        if (predicate && !predicate(datapack)) continue
        next[datapack.dir] = new Set<string>()
      }

      return next
    })
  }

  const handleCollapseAllDatapacks = () => {
    collapseDatapacks()
  }

  const handleCollapseDisabledDatapacks = () => {
    collapseDatapacks(isDatapackEntryDisabled)
  }

  const persistDatapackOrder = async (entries: DatapackEntry[]) => {
    const normalizeMetadataPath = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
    const metadataPaths = entries.map((entry) => getDatapackMetadataPath(entry.dir))
    const savedPaths = await handleSetDatapacks(metadataPaths)
    return savedPaths.length === metadataPaths.length
      && savedPaths.every((savedPath, index) => normalizeMetadataPath(savedPath) === normalizeMetadataPath(metadataPaths[index]))
  }

  const handleDatapackReorder = async (draggedDir: string, targetDir: string, position: "before" | "after") => {
    const previousEntries = datapacksRef.current
    const nextEntries = reorderDatapacks(previousEntries, draggedDir, targetDir, position)

    if (nextEntries === previousEntries) {
      return
    }

    setDatapacks(nextEntries)

    const didPersist = await persistDatapackOrder(nextEntries)
    if (didPersist) return

    setDatapacks(previousEntries)
    await dialog.showAlert("Error", "Failed to save datapack order in workspace")
  }

  const handleDatapackDropToEnd = async (draggedDir: string) => {
    const entries = datapacksRef.current
    const lastDatapack = entries[entries.length - 1]
    if (!lastDatapack || lastDatapack.dir === draggedDir) return
    await handleDatapackReorder(draggedDir, lastDatapack.dir, "after")
  }

  const closeTabsSequentially = async (fileKeys: string[]): Promise<boolean> => {
    for (const fileKey of fileKeys) {
      const didClose = await closeTab(fileKey)
      if (!didClose) return false
    }
    return true
  }

  const closeOtherTabs = async (targetFileKey: string) => {
    const fileKeysToClose = getOpenedFileKeys().filter((fileKey) => fileKey !== targetFileKey)
    await closeTabsSequentially(fileKeysToClose)
  }

  const closeTabsToTheRight = async (targetFileKey: string) => {
    const openedFileKeys = getOpenedFileKeys()
    const targetIndex = openedFileKeys.indexOf(targetFileKey)
    if (targetIndex === -1) return

    const fileKeysToClose = openedFileKeys.slice(targetIndex + 1)
    await closeTabsSequentially(fileKeysToClose)
  }

  const closeSavedTabs = async () => {
    const fileKeysToClose = getOpenedFileKeys().filter((fileKey) => !modifiedFiles.has(fileKey))
    await closeTabsSequentially(fileKeysToClose)
  }

  const closeAllTabs = async () => {
    const fileKeysToClose = getOpenedFileKeys()
    await closeTabsSequentially(fileKeysToClose)
  }

  const copyTabPath = async (fileKey: string) => {
    const { datapackDir, relativePath } = parseFileKey(fileKey)
    const fullPath = `${datapackDir}/${relativePath}`.replace(/\//g, "\\")
    try {
      await navigator.clipboard.writeText(fullPath)
      showToastEvent("Copied full path")
    } catch (error) {
      console.error("Failed to copy path:", error)
      await dialog.showAlert("Error", `Failed to copy path: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }

  const copyTabRelativePath = async (fileKey: string) => {
    const { relativePath } = parseFileKey(fileKey)
    try {
      await navigator.clipboard.writeText(relativePath)
      showToastEvent("Copied relative path")
    } catch (error) {
      console.error("Failed to copy relative path:", error)
      await dialog.showAlert("Error", `Failed to copy relative path: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }

  const revealInFileExplorer = async (fileKey: string) => {
    const { datapackDir, relativePath } = parseFileKey(fileKey)
    const fullPath = `${datapackDir}/${relativePath}`.replace(/\//g, "\\")
    try {
      await window.electron.revealInFileExplorer(fullPath)
    } catch (error) {
      console.error("Failed to reveal in file explorer:", error)
      await dialog.showAlert("Error", `Failed to reveal file in explorer: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }

  const renameTabFile = async (fileKey: string) => {
    const { datapackDir, relativePath } = parseFileKey(fileKey)
    const openedFile = openedFiles.find((file) => createFileKey(file.datapackDir, file.relativePath) === fileKey)
    const currentName = openedFile?.fileName || relativePath.split('/').filter(Boolean).pop() || 'this file'

    const fullPath = `${datapackDir}/${relativePath}`.replace(/\//g, "\\")
    await renamePathWithPrompt({
      fullPath,
      currentName,
      promptRename: dialog.showPrompt,
      showError: dialog.showAlert,
      preRenameCheck: () => handleFileRenamed(datapackDir, relativePath, ''),
      onRenamed: async (newName) => {
        await handleFileRenamed(datapackDir, relativePath, newName)
        await refreshDatapacks(datapacksRef.current.map((datapack) => datapack.dir))
      },
    })
  }

  const deleteTabFile = async (fileKey: string) => {
    const { datapackDir, relativePath } = parseFileKey(fileKey)
    const openedFile = openedFiles.find((file) => createFileKey(file.datapackDir, file.relativePath) === fileKey)
    const currentName = openedFile?.fileName || relativePath.split('/').filter(Boolean).pop() || 'this file'

    const fullPath = `${datapackDir}/${relativePath}`.replace(/\//g, "\\")
    await deletePathWithConfirm({
      fullPath,
      itemName: currentName,
      itemType: "file",
      confirmDelete: dialog.showConfirm,
      showError: dialog.showAlert,
      preDeleteCheck: () => confirmFileDelete(datapackDir, relativePath),
      onDeleted: async () => {
        await closeDeletedFileTab(datapackDir, relativePath)
        await refreshDatapacks(datapacksRef.current.map((datapack) => datapack.dir))
      },
    })
  }

  const openedFileKeys = getOpenedFileKeys()
  const hasSavedTabs = openedFileKeys.some((fileKey) => !modifiedFiles.has(fileKey))
  const hasAnyOpenTabs = openedFileKeys.length > 0
  const disabledDatapackCount = datapacks.filter(isDatapackEntryDisabled).length

  const createTabContextItems = (targetFileKey: string): MenuItem[] => {
    const contextTabIndex = openedFileKeys.indexOf(targetFileKey)
    const hasTabsToRight = contextTabIndex >= 0 && contextTabIndex < openedFileKeys.length - 1
    const hasOtherTabs = contextTabIndex >= 0 && openedFileKeys.length > 1

    return [
      {
        label: "Close",
        disabled: contextTabIndex === -1,
        onClick: () => {
          if (contextTabIndex === -1) return
          void closeTab(targetFileKey)
        },
        shortcut: "Ctrl+W",
      },
      {
        label: "Close Others",
        disabled: !hasOtherTabs,
        onClick: () => {
          if (contextTabIndex === -1) return
          void closeOtherTabs(targetFileKey)
        },
      },
      {
        label: "Close to the Right",
        disabled: !hasTabsToRight,
        onClick: () => {
          if (contextTabIndex === -1) return
          void closeTabsToTheRight(targetFileKey)
        },
      },
      {
        label: "Close Saved",
        disabled: !hasSavedTabs,
        onClick: () => {
          void closeSavedTabs()
        },
      },
      {
        label: "Close All",
        disabled: !hasAnyOpenTabs,
        onClick: () => {
          void closeAllTabs()
        },
      },
      {},
      {
        label: "Copy Path",
        disabled: contextTabIndex === -1,
        onClick: () => {
          if (contextTabIndex === -1) return
          void copyTabPath(targetFileKey)
        },
      },
      {
        label: "Copy Relative Path",
        disabled: contextTabIndex === -1,
        onClick: () => {
          if (contextTabIndex === -1) return
          void copyTabRelativePath(targetFileKey)
        },
      },
      {},
      {
        label: "Rename",
        shortcut: "F2",
        disabled: contextTabIndex === -1,
        onClick: () => {
          if (contextTabIndex === -1) return
          void renameTabFile(targetFileKey)
        },
      },
      {
        label: "Delete",
        shortcut: "Del",
        disabled: contextTabIndex === -1,
        onClick: () => {
          if (contextTabIndex === -1) return
          void deleteTabFile(targetFileKey)
        },
      },
      {},
      {
        label: "Reveal in File Explorer",
        disabled: contextTabIndex === -1,
        onClick: () => {
          if (contextTabIndex === -1) return
          void revealInFileExplorer(targetFileKey)
        },
      }
    ]
  }

  const titlebarContextItems: MenuItem[] = [
    {
      label: "Restore",
      onClick: () => {
        if (isFullScreen) {
          ;window.electron.toggleFullscreen()
        }
      },
      disabled: !isFullScreen,
    },
    {
      label: "Minimize",
      onClick: () => {
        ;window.electron.minimize()
      },
    },
    {
      label: "Maximize",
      onClick: () => {
        if (!isFullScreen) {
          ;window.electron.toggleFullscreen()
        }
      },
      disabled: isFullScreen,
    },
    {},
    {
      label: "Close",
      shortcut: "Alt+F4",
      onClick: handleQuitWithConfirm,
    },
  ]

  useEffect(() => {
    if (!activeFile) return

    const animationFrameId = window.requestAnimationFrame(() => {
      scrollTabIntoView(activeFile, "smooth")
    })

    return () => {
      window.cancelAnimationFrame(animationFrameId)
    }
  }, [activeFile, openedFiles])

  const hasDatapackDragPayload = (event: React.DragEvent): boolean => {
    if (draggingDatapackDir) return true
    return event.dataTransfer.types.includes(DATAPACK_DRAG_PAYLOAD_MIME)
  }

  const hasTreeDragPayload = (event: React.DragEvent): boolean => {
    return event.dataTransfer.types.includes(TREE_DRAG_PAYLOAD_MIME)
  }

  const explorerTagOptions = React.useMemo(() => {
    const tagsByKey = new Map<string, string>()

    for (const datapack of datapacks) {
      if (!Array.isArray(datapack.tags)) continue

      for (const rawTag of datapack.tags) {
        const normalizedTag = rawTag.trim()
        if (!normalizedTag) continue

        const key = normalizedTag.toLowerCase()
        if (!tagsByKey.has(key)) {
          tagsByKey.set(key, normalizedTag)
        }
      }
    }

    return Array.from(tagsByKey.values()).sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" }),
    )
  }, [datapacks])

  useEffect(() => {
    if (selectedExplorerTags.size === 0) return

    const validKeys = new Set(explorerTagOptions.map((tag) => tag.toLowerCase()))
    const nextSelected = new Set(Array.from(selectedExplorerTags).filter((tag) => validKeys.has(tag)))
    if (nextSelected.size !== selectedExplorerTags.size) {
      setSelectedExplorerTags(nextSelected)
    }
  }, [selectedExplorerTags, explorerTagOptions])

  const filteredDatapacks = React.useMemo(() => {
    if (selectedExplorerTags.size === 0) {
      return datapacks
    }

    return datapacks.filter((datapack) => {
      const datapackTags = new Set((datapack.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))
      if (datapackTags.size === 0) return false

      if (explorerTagMatchMode === "any") {
        for (const selectedTag of selectedExplorerTags) {
          if (datapackTags.has(selectedTag)) return true
        }
        return false
      }

      // Strict mode requires all selected tags to exist; additional datapack tags are allowed.
      for (const selectedTag of selectedExplorerTags) {
        if (!datapackTags.has(selectedTag)) return false
      }
      return true
    })
  }, [datapacks, selectedExplorerTags, explorerTagMatchMode])

  const explorerTagMenuItems = React.useMemo<MenuItem[]>(() => {
    const items: MenuItem[] = [
      {
        label: "Clear Selection",
        onClick: () => setSelectedExplorerTags(new Set()),
      },
      {},
      {
        label: "Match Any",
        toggleable: true,
        toggled: explorerTagMatchMode === "any",
        onToggle: (nextState) => {
          setExplorerTagMatchMode(nextState ? "any" : "exact")
        },
      },
    ]

    if (explorerTagOptions.length > 0) {
      items.push({})
      for (const tag of explorerTagOptions) {
        const tagKey = tag.toLowerCase()
        items.push({
          label: tag,
          toggleable: true,
          toggled: selectedExplorerTags.has(tagKey),
          onToggle: (nextState) => {
            setSelectedExplorerTags((prev) => {
              const next = new Set(prev)
              if (nextState) {
                next.add(tagKey)
              } else {
                next.delete(tagKey)
              }
              return next
            })
          },
        })
      }
    }

    return items
  }, [explorerTagOptions, selectedExplorerTags, explorerTagMatchMode])

  const explorerTagFilterLabel = React.useMemo(() => {
    const selectedCount = selectedExplorerTags.size
    if (selectedCount === 0) {
      return "All tags"
    }

    if (selectedCount === 1) {
      const [singleTag] = Array.from(selectedExplorerTags)
      const displayTag = explorerTagOptions.find((tag) => tag.toLowerCase() === singleTag) ?? singleTag
      const maxLength = 20
      if (displayTag.length <= maxLength) {
        return displayTag
      }
      return `${displayTag.slice(0, maxLength - 1)}...`
    }

    const modeLabel = explorerTagMatchMode === "any" ? "ANY" : "EXACT"
    return `${selectedCount} tags (${modeLabel})`
  }, [selectedExplorerTags, explorerTagOptions, explorerTagMatchMode])

  const resolveDraggedDatapackDir = (event: React.DragEvent): string | null => {
    const fromMime = event.dataTransfer.getData(DATAPACK_DRAG_PAYLOAD_MIME)
    if (fromMime) return fromMime
    if (draggingDatapackDir) return draggingDatapackDir
    const fromText = event.dataTransfer.getData("text/plain")
    return fromText || null
  }

  const leftPanelTabs: PanelTab[] = [
    {
      id: "explorer",
      title: "Explorer",
      icon: "codicon-file-directory",
      visible: visibleLeftPanelTabs.has("explorer"),
      content: (
        <div>
          <div className="explorer-filter-floating-row">
            <DropdownMenu
              label={
                <div className="explorer-filter-pillbox-label" title="Filter datapacks by tags">
                  <span className="codicon codicon-filter text-xs" />
                  <span className="explorer-filter-pillbox-text">{explorerTagFilterLabel}</span>
                  <span className="codicon codicon-chevron-down text-[10px]" />
                </div>
              }
              items={explorerTagMenuItems}
              isOpen={isExplorerTagFilterMenuOpen}
              setIsOpen={setIsExplorerTagFilterMenuOpen}
              horizontalAlign="center"
              buttonClassName={`explorer-filter-pillbox-button ${selectedExplorerTags.size > 0 ? "explorer-filter-pillbox-button-active" : ""}`}
              disabled={explorerTagOptions.length === 0}
            />
          </div>

          <div className="space-y-4">
          {filteredDatapacks.length ? (
            <>
          {filteredDatapacks.map((datapack) => {
            const showTopIndicator = dragOverDatapackDir === datapack.dir && dragOverDatapackPosition === "before"
            const showBottomIndicator = dragOverDatapackDir === datapack.dir && dragOverDatapackPosition === "after"
            const isDraggingDatapack = draggingDatapackDir === datapack.dir
            const datapackLabel = datapack.displayName || datapack.name

            return (
              <div
                key={datapack.dir}
                draggable
                onDragStart={(event) => {
                  const targetElement = event.target as HTMLElement | null
                  const isTreeEntryDrag = !!targetElement?.closest('[data-tree-entry-draggable="true"]')
                  if (isTreeEntryDrag) {
                    return
                  }

                  const containerElement = event.currentTarget as HTMLElement
                  const rootElement = containerElement.querySelector<HTMLElement>('[data-datapack-tree-root="true"]')
                  const isRootDragStart = !!rootElement && rootElement.matches(':hover')
                  if (!isRootDragStart) {
                    event.preventDefault()
                    return
                  }

                  event.dataTransfer.effectAllowed = "move"
                  event.dataTransfer.setData(DATAPACK_DRAG_PAYLOAD_MIME, datapack.dir)
                  event.dataTransfer.setData("text/plain", datapack.dir)
                  setDraggingDatapackDir(datapack.dir)
                  setIsDragOverDatapackEndZone(false)

                  if (datapackDragGhostRef.current) {
                    datapackDragGhostRef.current.remove()
                    datapackDragGhostRef.current = null
                  }

                  const ghost = document.createElement("div")
                  ghost.className = "px-2 py-1 bg-codemirror-600 rounded border border-codemirror-400 text-sm text-codemirror-100 whitespace-nowrap"
                  ghost.textContent = datapackLabel

                  if (datapack.packVersion) {
                    const versionLabel = document.createElement("span")
                    versionLabel.className = "text-xs text-codemirror-300 italic ml-1"
                    versionLabel.textContent = `v${datapack.packVersion}`
                    ghost.appendChild(versionLabel)
                  }

                  ghost.style.position = "fixed"
                  ghost.style.top = "-1000px"
                  ghost.style.left = "-1000px"
                  ghost.style.pointerEvents = "none"
                  document.body.appendChild(ghost)
                  datapackDragGhostRef.current = ghost

                  event.dataTransfer.setDragImage(ghost, 0, 0)
                }}
                onDragEnd={() => {
                  setDraggingDatapackDir(null)
                  setDragOverDatapackDir(null)
                  setDragOverDatapackPosition(null)
                  setIsDragOverDatapackEndZone(false)

                  if (datapackDragGhostRef.current) {
                    datapackDragGhostRef.current.remove()
                    datapackDragGhostRef.current = null
                  }
                }}
                onDragOver={(event) => {
                  if (hasTreeDragPayload(event)) {
                    setDragOverDatapackDir(null)
                    setDragOverDatapackPosition(null)
                    setIsDragOverDatapackEndZone(false)
                    return
                  }

                  if (!hasDatapackDragPayload(event)) {
                    return
                  }

                  event.preventDefault()
                  event.dataTransfer.dropEffect = "move"
                  setIsDragOverDatapackEndZone(false)
                  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
                  const midpoint = rect.top + rect.height / 2
                  const nextPosition = event.clientY < midpoint ? "before" : "after"

                  if (dragOverDatapackDir !== datapack.dir || dragOverDatapackPosition !== nextPosition) {
                    setDragOverDatapackDir(datapack.dir)
                    setDragOverDatapackPosition(nextPosition)
                  }
                }}
                onDragLeave={(event) => {
                  const relatedTarget = event.relatedTarget as Node | null
                  if (relatedTarget && (event.currentTarget as HTMLElement).contains(relatedTarget)) {
                    return
                  }
                  setDragOverDatapackDir(null)
                  setDragOverDatapackPosition(null)
                }}
                onDrop={(event) => {
                  if (hasTreeDragPayload(event)) {
                    setDragOverDatapackDir(null)
                    setDragOverDatapackPosition(null)
                    setIsDragOverDatapackEndZone(false)
                    return
                  }

                  const draggedDir = resolveDraggedDatapackDir(event)
                  if (!draggedDir) {
                    return
                  }

                  event.preventDefault()
                  if (draggedDir && draggedDir !== datapack.dir) {
                    const position = dragOverDatapackPosition === "after" ? "after" : "before"
                    void handleDatapackReorder(draggedDir, datapack.dir, position)
                  }

                  setDragOverDatapackDir(null)
                  setDragOverDatapackPosition(null)
                  setDraggingDatapackDir(null)
                  setIsDragOverDatapackEndZone(false)
                }}
                className={`relative ${isDraggingDatapack ? "opacity-10" : ""}`}
              >
                {showTopIndicator && (
                  <div className="absolute left-0 right-0 top-0 h-0.5 bg-codemirror-100 pointer-events-none" />
                )}

                <DatapackTree
                  paths={datapack.paths}
                  folderName={datapack.name}
                  rootId={datapack.id}
                  rootName={datapack.displayName}
                  rootPackVersion={datapack.packVersion}
                  rootPackFormatVersion={datapack.packFormatVersionMax}
                  minecraftVersion={datapack.minecraftVersion}
                  rootTags={datapack.tags}
                  basePath={datapack.dir}
                  className="mt-2"
                  externalSelectedPath={explorerSelectedPathsByDatapack[datapack.dir]}
                  externalSelectedFileKey={explorerSelectedFileKeysByDatapack[datapack.dir]}
                  externalSelectionRevealNonce={explorerSelectionRevealNonceByDatapack[datapack.dir]}
                  externalExpandedPaths={explorerExpandedPathsByDatapack[datapack.dir] ?? EMPTY_EXPANDED_PATHS}
                  onExpandedPathsChange={(paths) =>
                    setExplorerExpandedPathsByDatapack((prev) => ({
                      ...prev,
                      [datapack.dir]: paths,
                    }))
                  }
                  treeContainerRef={getExplorerContainerRef(datapack.dir)}
                  onFolderCreated={handleRefreshExplorer}
                  onRefreshRequested={handleRefreshExplorer}
                  onRemoveFromWorkspaceRequested={() => handleRemoveDatapack(datapack.dir)}
                  onSelect={(pathKey, isFile, selectMode) => handleExplorerSelect(datapack.dir, pathKey, isFile, selectMode)}
                  onFileRenamed={(oldRelativePath, newName) => handleFileRenamed(datapack.dir, oldRelativePath, newName)}
                  onFileDeleted={async (relativePath) => {
                    await closeDeletedFileTab(datapack.dir, relativePath)
                    return true
                  }}
                  onContextMenuRequest={handleDatapackTreeContextMenu}
                  modifiedFileKeys={modifiedFiles}
                  fileDiagnosticSummaries={fileDiagnosticSummaries}
                />

                {showBottomIndicator && (
                  <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-codemirror-100 pointer-events-none" />
                )}
              </div>
            )
          })}

          <div
            onDragOver={(event) => {
              if (hasTreeDragPayload(event)) {
                event.preventDefault()
                event.dataTransfer.dropEffect = "none"
                setDragOverDatapackDir(null)
                setDragOverDatapackPosition(null)
                setIsDragOverDatapackEndZone(false)
                return
              }

              if (!hasDatapackDragPayload(event)) return
              event.preventDefault()
              event.dataTransfer.dropEffect = "move"
              setDragOverDatapackDir(null)
              setDragOverDatapackPosition(null)
              setIsDragOverDatapackEndZone(true)
            }}
            onDragLeave={(event) => {
              const relatedTarget = event.relatedTarget as Node | null
              if (relatedTarget && (event.currentTarget as HTMLElement).contains(relatedTarget)) {
                return
              }
              setIsDragOverDatapackEndZone(false)
            }}
            onDrop={(event) => {
              if (hasTreeDragPayload(event)) {
                event.preventDefault()
                setDraggingDatapackDir(null)
                setDragOverDatapackDir(null)
                setDragOverDatapackPosition(null)
                setIsDragOverDatapackEndZone(false)
                return
              }

              const draggedDir = resolveDraggedDatapackDir(event)
              if (!draggedDir) return
              event.preventDefault()
              if (draggedDir) {
                void handleDatapackDropToEnd(draggedDir)
              }
              setDraggingDatapackDir(null)
              setDragOverDatapackDir(null)
              setDragOverDatapackPosition(null)
              setIsDragOverDatapackEndZone(false)
            }}
            className="relative h-5 mt-1"
          >
            {isDragOverDatapackEndZone && (
              <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-codemirror-100 pointer-events-none" />
            )}
          </div>
            </>
          ) : datapacks.length ? (
            <div className="text-sm text-codemirror-300">No datapacks match the selected tag</div>
          ) : (
            <>
              <div className="text-sm text-codemirror-300">No datapacks added</div>
              <div className="flex flex-col items-center m-4 button" onClick={handleAddDatapackToWorkspace}>
                <div className="text-sm text-codemirror-100">Add Datapack to Workspace</div>
              </div>
            </>
          )}
          </div>
        </div>
      )
    }
  ]

  const inspectorDatapack = getInspectorDatapack()

  const rightPanelTabs: PanelTab[] = [
    {
      id: "preferences",
      title: "Preferences",
      icon: "codicon-settings",
      visible: visibleRightPanelTabs.has("preferences"),
      content: (
        <PreferencesPanel
          preferences={appPreferences}
          schema={defaultPreferencesSchema}
          onPreferenceChange={handlePreferenceChange}
          onPreferenceAction={handlePreferenceAction}
          isLoading={isPreferencesLoading}
        />
      )
    },
    {
      id: "inspector",
      title: "Inspector",
      icon: "codicon-eye",
      visible: visibleRightPanelTabs.has("inspector"),
      content: (
        <DatapackInspectorPanel
          datapack={inspectorDatapack}
          contextRevision={inspectorContextRevision}
          onMetadataChange={(fieldKey, value) => {
            if (!inspectorDatapack) return
            void handleInspectorMetadataChange(inspectorDatapack.dir, fieldKey, value)
          }}
          sectionExpansionById={inspectorSectionExpansionById}
          onSectionExpansionChange={(sectionId, expanded) => {
            setInspectorSectionExpansionById((prev) => ({
              ...prev,
              [sectionId]: expanded,
            }))
          }}
        />
      )
    }
  ]

  const bottomPanelTabs: PanelTab[] = [
    {
      id: "debug",
      title: "Debug Output",
      icon: "codicon-bug",
      visible: visibleBottomPanelTabs.has("debug"),
      content: <div className="text-sm text-codemirror-300">Debug output will appear here</div>
    }
  ]

  const orderedLeftPanelTabs = orderTabsByList(leftPanelTabs, leftPanelTabOrder)
  const orderedRightPanelTabs = orderTabsByList(rightPanelTabs, rightPanelTabOrder)
  const orderedBottomPanelTabs = orderTabsByList(bottomPanelTabs, bottomPanelTabOrder)

  const footerVersionLabel = React.useMemo(() => {
    const targetDatapack = resolveDatapackForMinecraftVersionSelection()
    const resolvedMinecraftVersion = targetDatapack?.minecraftVersion?.trim() || minecraftDataVersion
    const resolvedPackFormatFromDatapack = targetDatapack?.packFormatVersionMax
    const resolvedPackFormat = typeof resolvedPackFormatFromDatapack === 'number' && Number.isFinite(resolvedPackFormatFromDatapack)
      ? resolvedPackFormatFromDatapack
      : (() => {
          const mappedPackFormat = resolvePackFormatFromMinecraftVersion(resolvedMinecraftVersion)
          const parsedPackFormat = mappedPackFormat ? Number.parseFloat(mappedPackFormat) : undefined
          return typeof parsedPackFormat === 'number' && Number.isFinite(parsedPackFormat)
            ? parsedPackFormat
            : undefined
        })()

    if (typeof resolvedPackFormat === 'number' && Number.isFinite(resolvedPackFormat)) {
      return `MC ${resolvedMinecraftVersion} - Pack ${resolvedPackFormat}`
    }

    return `MC ${resolvedMinecraftVersion}`
  }, [activeFile, datapacks, minecraftDataVersion])

  return (
    <div className="w-full h-full flex flex-col select-none">

      {/* Title Bar */}
      <div className="flex flex-row h-9 bg-codemirror-700 text-sm text-codemirror-100 border-b border-codemirror-600" style={TITLEBAR_DRAG_STYLE}>

        {/* App Icon */}
        <div className="px-4 py-2 font-bold" onContextMenu={handleTitlebarRightClick}>
          <img src={iconPath} alt="MCFunction++" style={{ height: "20px", width: "20px" }} />
        </div>
        
        {/* Title Bar Buttons */}
        <div className="flex flex-row flex-1" style={TITLEBAR_NO_DRAG_STYLE}>

          <DropdownMenu 
            label="App"
            items={[
              { label: "Preferences", onClick: undefined, disabled: true },
              {},
              { label: "Report Bug", onClick: handleOpenBugReport },
              {},
              { label: "Website", onClick: undefined, disabled: true },
              { label: "Help", onClick: undefined, disabled: true },
              { label: "Credits", onClick: undefined, disabled: true },
              {},
              { label: "Exit", shortcut: "Ctrl+Q", onClick: handleQuitWithConfirm }
            ] as MenuItem[]}
            isOpen={isHeaderMenuOneOpen}
            setIsOpen={setIsHeaderMenuOneOpen}
            disabled={dialog.isOpen}
          />

          <DropdownMenu 
            label="Workspace"
            items={[
              { label: "New Workspace", onClick: handleNewWorkspaceWithConfirm },
              { label: "Open Workspace", shortcut: "Ctrl+O", onClick: handleOpenWorkspaceWithConfirm },
              { label: "Open Default Workspace", onClick: handleOpenDefaultWorkspaceWithConfirm },
              { label: "Save Workspace As", onClick: handleSaveWorkspaceAs },
              {},
              { label: "Add Datapack to Workspace", onClick: handleAddDatapackToWorkspace },
              {
                label: "Remove Datapack from Workspace",
                children: datapacks.length > 0
                  ? datapacks.map((datapack) => ({
                      label: `${datapack.displayName}${datapack.packVersion ? ` (v${datapack.packVersion})` : ""}`,
                      onClick: () => handleRemoveDatapack(datapack.dir)
                    }))
                  : [{ label: "No datapacks loaded", disabled: true }]
              }
            ] as MenuItem[]}
            isOpen={isHeaderMenuTwoOpen}
            setIsOpen={setIsHeaderMenuTwoOpen}
            disabled={dialog.isOpen}
          />

          <DropdownMenu 
            label="Editor"
            items={[
              { label: "Close", shortcut: "Ctrl+W", onClick: () => activeFile && closeTab(activeFile), disabled: !activeFile },
              { label: "Save", shortcut: "Ctrl+S", onClick: saveCurrentFile, disabled: !activeFile || !modifiedFiles.has(activeFile) },
              { label: "Save All", shortcut: "Ctrl+Shift+S", onClick: saveAllFiles, disabled: modifiedFiles.size === 0 },
              {},
              { label: "Auto-Save", toggleable: true, toggled: isAutoSaveEnabled, onToggle: toggleAutoSave },
              { label: "Word Wrap", onClick: undefined, disabled: true }
            ] as MenuItem[]}
            isOpen={isHeaderMenuThreeOpen}
            setIsOpen={setIsHeaderMenuThreeOpen}
            disabled={dialog.isOpen}
          />

          <DropdownMenu 
            label="Build"
            items={[
              { label: "Build Datapack", onClick: undefined, disabled: true }
            ] as MenuItem[]}
            isOpen={isHeaderMenuFourOpen}
            setIsOpen={setIsHeaderMenuFourOpen}
            disabled={dialog.isOpen}
          />

          <DropdownMenu 
            label="Export"
            items={[
              { label: "Export Datapack", onClick: undefined, disabled: true }
            ] as MenuItem[]}
            isOpen={isHeaderMenuFiveOpen}
            setIsOpen={setIsHeaderMenuFiveOpen}
            disabled={dialog.isOpen}
          />

          <DropdownMenu 
            label="Panels"
            items={[
              { 
                label: "Explorer",
                toggleable: true,
                toggled: visibleLeftPanelTabs.has("explorer"),
                onToggle: (nextState) => handleToggleLeftTab("explorer", nextState)
              },
              { 
                label: "Preferences",
                toggleable: true,
                toggled: visibleRightPanelTabs.has("preferences"),
                onToggle: (nextState) => handleToggleRightTab("preferences", nextState)
              },
              { 
                label: "Debug Output",
                toggleable: true,
                toggled: visibleBottomPanelTabs.has("debug"),
                onToggle: (nextState) => handleToggleBottomTab("debug", nextState)
              },
              { 
                label: "Inspector",
                toggleable: true,
                toggled: visibleRightPanelTabs.has("inspector"),
                onToggle: (nextState) => handleToggleRightTab("inspector", nextState)
              }
            ] as MenuItem[]}
            isOpen={isHeaderMenuSixOpen}
            setIsOpen={setIsHeaderMenuSixOpen}
            disabled={dialog.isOpen}
          />

          <div className="flex-1" style={TITLEBAR_DRAG_STYLE} onContextMenu={handleTitlebarRightClick}></div>

          {/* Window Control Buttons */}
          <Tooltip content="Minimize">
            <div
              onClick={() => window.electron.minimize()}
              className="header-button pt-2.5 pb-2 codicon codicon-chrome-minimize"
            />
          </Tooltip>
          <Tooltip content={`${isFullScreen ? "Restore" : "Maximize"}`}>
            <div
              onClick={() => window.electron.toggleFullscreen()}
              className={`header-button pt-2.5 pb-2 codicon ${isFullScreen ? "codicon-chrome-restore" : "codicon-chrome-maximize"}`}
            />
          </Tooltip>
          <Tooltip content="Close">
            <div
              onClick={() => {
                void handleQuitWithConfirm()
              }}
              className="header-button hover:bg-rose-600 pt-2.5 pb-2 codicon codicon-chrome-close"
            />
          </Tooltip>

        </div>
      </div>

      {/* App */}
      <div className="flex flex-row flex-1 overflow-hidden flex-nowrap">

        {/* Left Panel */}
        {visibleLeftPanelTabs.size > 0 && (
          <>
            <Panel
              width={leftSection.width}
              position="left"
              activeTabId={activeLeftTabId}
              onTabChange={setActiveLeftTabId}
              onTabReorder={handleReorderLeftTab}
              menuItems={[
                { label: "Refresh All Datapacks", onClick: handleRefreshExplorer },
                {},
                {
                  label: "Collapse",
                  children: [
                    {
                      label: "Collapse Disabled Datapacks",
                      onClick: handleCollapseDisabledDatapacks,
                      disabled: disabledDatapackCount === 0,
                    },
                    {
                      label: "Collapse All Datapacks",
                      onClick: handleCollapseAllDatapacks,
                      disabled: datapacks.length === 0,
                    },
                  ],
                },
              ] as MenuItem[]}
              tabs={orderedLeftPanelTabs}
            />

            {/* Left Panel Resize Handle */}
            <ResizeHandle onMouseDown={leftSection.handleMouseDown} orientation="horizontal" />
          </>
        )}

        {/* Center Section: Main Editor + Bottom Panel */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0">

          {/* Main Center Panel */}
          <div className="flex-1 min-w-0 bg-codemirror-default flex flex-col min-h-0 relative"
            onClick={() => viewRef.current?.focus()}>

          {/* Editor */}
          <div className="flex-1 flex flex-col min-h-0">

            {/* Tabs Bar */}
            <div 
              ref={tabsRef}
              onWheel={handleTabsWheel}
              className="flex overflow-x-auto overflow-y-hidden bg-codemirror-700 border-b border-codemirror-600 select-none"
            >
              {openedFiles.map((file, idx) => {
                const fileKey = createFileKey(file.datapackDir, file.relativePath)
                const isActive = activeFile === fileKey
                const isPreview = previewFileKey === fileKey
                const duplicateFolderLabel = getDuplicateTabFolderLabel(file)
                const tabDiagnosticSummary = fileDiagnosticSummaries[fileKey]
                const tabHasDiagnosticError = (tabDiagnosticSummary?.errors ?? 0) > 0
                const tabHasDiagnosticWarning = !tabHasDiagnosticError && (tabDiagnosticSummary?.warnings ?? 0) > 0
                const isDragging = draggingFileKey === fileKey
                const showLeftIndicator = dragOverFileKey === fileKey && dragOverPosition === "before"
                const showRightIndicator = dragOverFileKey === fileKey && dragOverPosition === "after"
                return (
                  <div className="relative flex" key={fileKey}>

                    {showLeftIndicator && (
                      <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-codemirror-100 pointer-events-none" />
                    )}

                    <div
                      ref={(element) => registerTabElement(fileKey, element)}
                      draggable
                      onContextMenu={(event) => handleTabRightClick(event, fileKey)}
                      onClick={() => {
                        void openFile(fileKey)
                      }}
                      onDoubleClick={() => {
                        pinPreviewTab(fileKey)
                        viewRef.current?.focus()
                      }}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move"
                        event.dataTransfer.setData("text/plain", fileKey)
                        setDraggingFileKey(fileKey)
                        pinPreviewTab(fileKey)

                        // Clean up old ghost if it exists
                        if (dragGhostRef.current) {
                          dragGhostRef.current.remove()
                          dragGhostRef.current = null
                        }

                        // Create custom ghost image
                        const ghost = document.createElement("div")
                        ghost.className = `
                          px-2 py-1
                          bg-codemirror-600 rounded
                          border border-codemirror-400
                          text-sm text-codemirror-100
                          flex items-center whitespace-nowrap`
                        ghost.textContent = file.fileName
                        ghost.style.position = "fixed"
                        ghost.style.top = "-1000px"
                        ghost.style.left = "-1000px"
                        ghost.style.pointerEvents = "none"

                        if (duplicateFolderLabel) {
                          const label = document.createElement("span")
                          label.className = "text-xs text-codemirror-300 italic ml-1"
                          label.textContent = duplicateFolderLabel
                          ghost.appendChild(label)
                        }

                        document.body.appendChild(ghost)
                        dragGhostRef.current = ghost

                        event.dataTransfer.setDragImage(ghost, 0, 0)
                        //event.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2)
                      }}
                      onDragEnd={() => {
                        setDraggingFileKey(null)
                        setDragOverFileKey(null)
                        setDragOverPosition(null)
                        
                        if (dragGhostRef.current) {
                          dragGhostRef.current.remove()
                          dragGhostRef.current = null
                        }
                      }}
                      onDragOver={(event) => {
                        event.preventDefault()
                        event.dataTransfer.dropEffect = "move"
                        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
                        const midpoint = rect.left + rect.width / 2
                        const position = event.clientX < midpoint ? "before" : "after"
                        setDragOverFileKey(fileKey)
                        setDragOverPosition(position)
                      }}
                      onDragLeave={() => {
                        setDragOverFileKey(null)
                        setDragOverPosition(null)
                      }}
                      onDrop={(event) => {
                        event.preventDefault()
                        const draggedKey = event.dataTransfer.getData("text/plain")
                        if (draggedKey && draggedKey !== fileKey) {
                          reorderOpenedFiles(draggedKey, fileKey, dragOverPosition === "after" ? "after" : "before")
                        }
                        setDragOverFileKey(null)
                        setDragOverPosition(null)
                        setDraggingFileKey(null)
                      }}
                      className={`
                        flex flex-row items-center gap-1 px-2 py-1
                        border-r border-codemirror-600
                        whitespace-nowrap
                        cursor-pointer
                        ${isDragging ? "opacity-10" : ""}
                        ${isActive
                          ? "bg-codemirror-select hover:bg-codemirror-highlight text-codemirror-50"
                          : "hover:bg-codemirror-highlight text-codemirror-300"
                        }
                      `}
                    >

                      <span className={`text-sm ${isPreview ? 'italic' : ''}`}>{file.fileName}</span>

                      {/* Duplicate Disambiguation Label */}
                      {duplicateFolderLabel && (
                        <span className="text-xs text-codemirror-300 italic ml-1">{duplicateFolderLabel}</span>
                      )}

                      <div className="flex flex-row items-center gap-0.5 ml-1">
                        {/* Indicators */}
                        {tabHasDiagnosticError &&
                          <div className={`codicon codicon-error text-red-400`}/>
                        }
                        {tabHasDiagnosticWarning &&
                          <div className={`codicon codicon-warning text-amber-400`}/>
                        }
                        {modifiedFiles.has(fileKey) &&
                          <div className={`codicon codicon-circle-filled -mr-0.5 text-orange-300`}/>
                        }
                      </div>

                      {/* Close Button */}
                      <div
                        onClick={(e) => {
                          e.stopPropagation()
                          closeTab(fileKey)
                        }}
                        className={`codicon codicon-close p-1
                          text-codemirror-200 hover:text-codemirror-50
                          cursor-pointer`}
                      />

                    </div>

                    {showRightIndicator && (
                      <div className="absolute right-0 top-0 bottom-0 w-0.5 bg-codemirror-100 pointer-events-none" />
                    )}

                  </div>
                )
              })}
            </div>

            {/* Active File Path Bar */}
            <div
              className="h-6 px-2
              bg-codemirror-700
              border-b border-codemirror-600
              text-codemirror-300 text-xs
              flex items-center"
            >
              <span className="truncate">{activeFileRelativePathLabel}</span>
            </div>

            {/* CodeMirror Editor */}
            <div className="flex-1 min-h-0 overflow-auto" ref={editorRef} />

          </div>

          {openedFiles.length === 0 && (<>
            <div className="absolute inset-0 flex-1 bg-codemirror-default" />
            <div className="absolute inset-0 flex items-center justify-center select-none pointer-events-none">
              <img src={iconPath} alt="MCFunction++"
                style={{ height: "150px", width: "150px", opacity: 0.05 }} />
            </div>
          </>)}

          </div>

        {/* Bottom Panel Resize Handle */}
        {visibleBottomPanelTabs.size > 0 && (
          <ResizeHandle onMouseDown={bottomSection.handleMouseDown} orientation="vertical" />
        )}

        {/* Bottom Panel */}
        {visibleBottomPanelTabs.size > 0 && (
          <Panel 
            height={bottomSection.height}
            position="bottom"
            activeTabId={activeBottomTabId}
            onTabChange={setActiveBottomTabId}
            onTabReorder={handleReorderBottomTab}
            tabs={orderedBottomPanelTabs}
          />
        )}

        </div>

        {/* Right Panel Resize Handle */}
        {visibleRightPanelTabs.size > 0 && (
          <ResizeHandle onMouseDown={rightSection.handleMouseDown} orientation="horizontal" />
        )}
        
        {/* Right Panel */}
        {visibleRightPanelTabs.size > 0 && (
          <Panel 
            width={rightSection.width} 
            position="right" 
            activeTabId={activeRightTabId}
            onTabChange={setActiveRightTabId}
            onTabReorder={handleReorderRightTab}
            menuItems={getRightMenuItems()}
            tabs={orderedRightPanelTabs}
          />
        )}

      </div>
      
      {/* Footer */}
      <div className="h-7.5 border-t border-codemirror-600
        bg-codemirror-700 text-codemirror-100
        flex flex-row items-center
      ">

        <div className="footer-element">Made by touchportyl</div>

        <Tooltip content={appUpdateTooltipContent}>
          <div
            className={`footer-element ${isManualUpdateCheckInProgress ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-codemirror-highlight"}`}
            onClick={() => {
              if (isManualUpdateCheckInProgress) return
              void handleManualUpdateCheck()
            }}
          >
            {hasPendingAppUpdate && <span className="codicon codicon-warning text-amber-300" />}
            {appVersionLabel}
          </div>
        </Tooltip>

        <Tooltip content="Select MC Version" disabled={isMinecraftVersionMenuOpen}>
          <DropdownMenu
            label={<>{footerVersionLabel}</>}
            items={minecraftVersionMenuItems}
            isOpen={isMinecraftVersionMenuOpen}
            setIsOpen={setIsMinecraftVersionMenuOpen}
            className="h-full"
            buttonClassName="footer-element footer-button cursor-pointer hover:bg-codemirror-highlight"
            horizontalAlign="center"
          />
        </Tooltip>

        <div className="flex-1"/>

        {activeFile && (<>

          {/* Diagnostic Refresh Status */}
          {diagnosticRefreshStatus.visible && (
            <Tooltip content={diagnosticRefreshStatus.label}>
              <div className="footer-element footer-button ml-auto min-w-72 max-w-120 gap-3 cursor-default hover:bg-transparent">
                <div className="text-[11px] text-codemirror-200 whitespace-nowrap">{diagnosticRefreshStatus.label}</div>
                <div className="h-2 flex-1 overflow-hidden rounded bg-codemirror-600">
                  <div
                    className="h-full bg-cyan-300 transition-[width] duration-200 ease-out"
                    style={{ width: `${Math.max(0, Math.min(100, diagnosticRefreshStatus.percent))}%` }}
                  />
                </div>
                <div className="text-[10px] text-codemirror-300 whitespace-nowrap">{Math.round(Math.max(0, Math.min(100, diagnosticRefreshStatus.percent)))}%</div>
              </div>
            </Tooltip>
          )}

          {/* Diagnostics */}
          {showDiagnosticSummary && (
            <Tooltip content={`${diagnosticSummary.errors} error${diagnosticSummary.errors === 1 ? "" : "s"}, ${diagnosticSummary.warnings} warning${diagnosticSummary.warnings === 1 ? "" : "s"}`}>
              <div className="footer-element">
                <span className="codicon codicon-error"></span>{diagnosticSummary.errors}
                <span className="codicon codicon-warning"></span>{diagnosticSummary.warnings}
              </div>
            </Tooltip>
          )}
        
          {/* Line/Column */}
          <div className="footer-element">Ln {cursorMarkerInfo.line}, Col {cursorMarkerInfo.column} {cursorMarkerInfo.selectedCharacters ? `(${cursorMarkerInfo.selectedCharacters} selected)` : ""}</div>

          {/* Language */}
          <div className="footer-element">
            <span className={`codicon ${activeLanguage.codicon}`}></span>
            {activeLanguage.label}
          </div>

        </>)}

      </div>

      {/* Shared Context Menu (single-instance) */}
      <ContextMenu
        items={contextMenuRequest.items}
        x={contextMenuRequest.contextMenu.position.x}
        y={contextMenuRequest.contextMenu.position.y}
        isOpen={contextMenuRequest.isVisible}
        onClose={contextMenuRequest.close}
      />

      <Dialog
        isOpen={isMinecraftDataBootstrapOpen}
        title={minecraftDataBootstrapMode === 'multi'
          ? `Preparing ${minecraftDataBootstrapBatchVersions.length} Minecraft Version${minecraftDataBootstrapBatchVersions.length === 1 ? '' : 's'}`
          : `Preparing Minecraft ${minecraftDataBootstrapTargetVersion}`}
        message={minecraftDataBootstrapMode === 'multi'
          ? 'Preparing cache and diagnostics resources across datapack versions.'
          : `Preparing cache and source data for Minecraft ${minecraftDataBootstrapTargetVersion}.`}
        progressPercent={minecraftDataBootstrapProgressPercent}
        progressLabel={minecraftDataBootstrapProgressMessage}
        progressItems={minecraftDataBootstrapMode === 'multi'
          ? minecraftDataBootstrapBatchVersions.map((version) => {
              const entry = minecraftDataBootstrapBatchProgress[version] ?? createInitialBatchProgressEntry()
              return {
                key: version,
                label: `Minecraft ${version}`,
                percent: entry.percent,
                message: entry.message,
                status: entry.status,
              }
            })
          : undefined}
        buttons={[]}
        onClose={() => undefined}
        dismissible={false}
      />

      {/* Dialogs (stacked) */}
      {dialog.dialogPropsStack?.map((dialogProps, index) => (
        <Dialog key={`dialog-${index}`} {...dialogProps} />
      ))}

      <ToastStack />
    </div>
  )
}

function App() {
  return (
    <div className="h-screen bg-codemirror-700 font-sans">
      <CodeEditor />
    </div>
  )
}

const rootElement = document.getElementById("root") as HTMLElement
const root = ReactDOM.createRoot(rootElement)

root.render(<App />)