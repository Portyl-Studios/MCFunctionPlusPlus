import React, { useEffect, useRef, useState } from "react"
import ReactDOM from "react-dom/client"

import { EditorState } from "@codemirror/state"
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
import { lintKeymap } from "@codemirror/lint"
import { portylDarkTheme } from "./themes/portyl-dark"
import "./index.css"
import { Section, ResizeHandle, useResizableSection } from "./section"
import { Panel, type PanelTab } from "./panel"
import { DropdownMenu, type MenuItem } from "./dropdownmenu"
import { useWorkspace } from "./use-workspace"
import iconPath from "../../assets/icon.png"
import { DatapackTree } from "./datapacktree"
import { Dialog } from "./overlays/dialog"
import { useDialogRequest } from "./overlays/dialog-request"
import { ContextMenu } from "./overlays/contextmenu"
import { useContextMenuRequest } from "./overlays/contextmenu-request"
import { getDirFromPath, toRelativePaths, createFileKey, parseFileKey } from "./utils"
import {
  loadMcfunctionCommandSchema,
  loadMinecraftData,
  setWorkspaceResourcePathsFromRelativePaths,
} from "./mcfunction-language"
import { detectEditorLanguage, getLanguageProcessingExtensions, type DiagnosticSummary } from "./language-handler"
import { runGlobalDiagnosticsScan } from "./diagnostics/global-diagnostics"
import { Tooltip } from "./overlays/tooltip"

type DatapackEntry = {
  dir: string
  name: string
  paths: string[]
  id?: string
  displayName?: string
  packVersion?: string
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

const OPEN_TABS_PREFERENCE_KEY = "openTabs"
const EXPLORER_EXPANDED_PREFERENCE_KEY = "explorerExpandedPaths"

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
  
  // Panel tab visibility state
  const [visibleLeftPanelTabs, setVisibleLeftPanelTabs] = useState<Set<string>>(new Set(["explorer"]))
  const [visibleRightPanelTabs, setVisibleRightPanelTabs] = useState<Set<string>>(new Set(["preferences", "settings"]))
  const [visibleBottomPanelTabs, setVisibleBottomPanelTabs] = useState<Set<string>>(new Set(["debug"]))

  // Panel tab order state
  const [leftPanelTabOrder, setLeftPanelTabOrder] = useState<string[]>(["explorer"])
  const [rightPanelTabOrder, setRightPanelTabOrder] = useState<string[]>(["preferences", "settings"])
  const [bottomPanelTabOrder, setBottomPanelTabOrder] = useState<string[]>(["debug"])
  
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
        const panelPrefs = await (window as any).electron.preferencesGet('panels')
        if (panelPrefs) {
          if (panelPrefs.leftPanelTabOrder) setLeftPanelTabOrder(panelPrefs.leftPanelTabOrder)
          if (panelPrefs.rightPanelTabOrder) setRightPanelTabOrder(panelPrefs.rightPanelTabOrder)
          if (panelPrefs.bottomPanelTabOrder) setBottomPanelTabOrder(panelPrefs.bottomPanelTabOrder)
          if (panelPrefs.visibleLeftPanelTabs) setVisibleLeftPanelTabs(new Set(panelPrefs.visibleLeftPanelTabs))
          if (panelPrefs.visibleRightPanelTabs) setVisibleRightPanelTabs(new Set(panelPrefs.visibleRightPanelTabs))
          if (panelPrefs.visibleBottomPanelTabs) setVisibleBottomPanelTabs(new Set(panelPrefs.visibleBottomPanelTabs))
          if (panelPrefs.activeLeftTabId) setActiveLeftTabId(panelPrefs.activeLeftTabId)
          if (panelPrefs.activeRightTabId) setActiveRightTabId(panelPrefs.activeRightTabId)
          if (panelPrefs.activeBottomTabId) setActiveBottomTabId(panelPrefs.activeBottomTabId)
          if (panelPrefs.leftPanelWidth) setLeftPanelWidth(panelPrefs.leftPanelWidth)
          if (panelPrefs.rightPanelWidth) setRightPanelWidth(panelPrefs.rightPanelWidth)
          if (panelPrefs.bottomPanelHeight) setBottomPanelHeight(panelPrefs.bottomPanelHeight)
        }
      } catch (error) {
        console.error('Failed to load panel preferences:', error)
        await dialog.showAlert('Error', `Failed to load panel preferences: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    loadPanelPreferences()
  }, [])

  // Save panel preferences when they change
  useEffect(() => {
    const savePanelPreferences = async () => {
      try {
        await (window as any).electron.preferencesSet('panels', {
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
        await dialog.showAlert('Error', `Failed to save panel preferences: ${error instanceof Error ? error.message : 'Unknown error'}`)
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
    } else if (activeRightTabId === "settings") {
      return [
        { label: "Settings Option", onClick: undefined }
      ]
    }
    return []
  }
  
  const [datapacks, setDatapacks] = useState<DatapackEntry[]>([])
  const [isHeaderMenuOneOpen, setIsHeaderMenuOneOpen] = useState(false)
  const [isHeaderMenuTwoOpen, setIsHeaderMenuTwoOpen] = useState(false)
  const [isHeaderMenuThreeOpen, setIsHeaderMenuThreeOpen] = useState(false)
  const [isHeaderMenuFourOpen, setIsHeaderMenuFourOpen] = useState(false)
  const [isHeaderMenuFiveOpen, setIsHeaderMenuFiveOpen] = useState(false)
  const [isHeaderMenuSixOpen, setIsHeaderMenuSixOpen] = useState(false)
  const [isFullScreen, setIsFullScreen] = useState(false)
  const [openedFiles, setOpenedFiles] = useState<OpenedFile[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [modifiedFiles, setModifiedFiles] = useState<Set<string>>(new Set())
  const [fileDiagnosticSummaries, setFileDiagnosticSummaries] = useState<Record<string, DiagnosticSummary>>({})
  const [cursorMarkerInfo, setCursorMarkerInfo] = useState<CursorMarkerInfo>(defaultCursorMarkerInfo)
  const [diagnosticSummary, setDiagnosticSummary] = useState<DiagnosticSummary>(defaultDiagnosticSummary)
  const tabsRef = useRef<HTMLDivElement>(null)
  const tabElementRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [isAutoSaveEnabled, setIsAutoSaveEnabled] = useState(false)
  const isRestoringTabsRef = useRef(false)
  const isRestoringExplorerRef = useRef(false)
  const lastSavedTabSessionSignatureRef = useRef("")
  const fileEditorStatesRef = useRef<Map<string, EditorState>>(new Map())
  const contextMenuRequest = useContextMenuRequest()
  
  // File tab drag-and-drop state
  const [draggingFileKey, setDraggingFileKey] = useState<string | null>(null)
  const [dragOverFileKey, setDragOverFileKey] = useState<string | null>(null)
  const [dragOverPosition, setDragOverPosition] = useState<"before" | "after" | null>(null)
  const dragGhostRef = useRef<HTMLDivElement | null>(null)

  const [explorerSelectedPathsByDatapack, setExplorerSelectedPathsByDatapack] = useState<Record<string, string | null>>({})
  const [explorerSelectedFileKeysByDatapack, setExplorerSelectedFileKeysByDatapack] = useState<Record<string, string | null>>({})
  const [explorerExpandedPathsByDatapack, setExplorerExpandedPathsByDatapack] = useState<Record<string, Set<string>>>({})
  const explorerContainerRefs = useRef<Map<string, React.RefObject<HTMLDivElement | null>>>(new Map())
  
  // Refs are used to access current state values inside closures (e.g., editor listeners)
  // without triggering re-renders or stale closure issues
  const isAutoSaveEnabledRef = useRef(isAutoSaveEnabled)
  // Track auto-save timers per file using fileKey format: "datapackDir|relativePath"
  const autoSaveTimersRef = useRef<Map<string, number>>(new Map())
  const diagnosticsScanRunIdRef = useRef(0)
  const dialog = useDialogRequest()
  const isDialogOpenRef = useRef(dialog.isOpen)
  const openedFilesRef = useRef(openedFiles)
  const modifiedFilesRef = useRef(modifiedFiles)
  const {
    workspaceInfo,
    handleOpenWorkspace,
    handleSaveWorkspace,
    handleSaveWorkspaceAs,
    handleNewWorkspace,
    handleOpenDefaultWorkspace,
    handleGetDatapacks,
  } = useWorkspace()

  // Load auto-save preference from workspace
  useEffect(() => {
    const loadAutoSavePreference = async () => {
      try {
        const savedValue = await (window as any).electron.workspaceGetPreference("autoSave")
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
      await (window as any).electron.workspaceUpdatePreference("autoSave", enabled)
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

  const loadDatapackEntry = async (datapackDir: string): Promise<DatapackEntry | null> => {
    try {
      const files = await (window as any).electron.listFiles(datapackDir)
      const paths = Array.isArray(files) ? files : []
      const name = datapackDir.split(/[\\/]/).pop() || "datapack"
      let id: string | undefined
      let displayName: string | undefined
      let packVersion: string | undefined
      try {
        const metadataRaw = await (window as any).electron.readFile(datapackDir, ".mpp-datapack")
        const parsed = JSON.parse(metadataRaw)
        if (parsed && typeof parsed.id === "string") {
          id = parsed.id
        }
        if (parsed && typeof parsed.name === "string") {
          displayName = parsed.name
        }
        if (parsed && typeof parsed.packVersion === "string") {
          packVersion = parsed.packVersion
        }
      } catch {
        id = undefined
        displayName = undefined
        packVersion = undefined
      }
      return {
        dir: datapackDir,
        name,
        paths: toRelativePaths(datapackDir, paths),
        id,
        displayName,
        packVersion,
      }
    } catch {
      return null
    }
  }

  const refreshDatapacks = async (dirs: string[]) => {
    const uniqueDirs = Array.from(new Set(dirs.filter(Boolean)))
    const entries = await Promise.all(uniqueDirs.map((dir) => loadDatapackEntry(dir)))
    setDatapacks(entries.filter((entry): entry is DatapackEntry => !!entry))
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
              await saveAllFiles()
              await workspaceChangeAction()
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

  const handleQuitWithConfirm = async () => {
    // If no unsaved files, double confirm quit to prevent accidental exits
    if (modifiedFiles.size === 0) {
      const confirmed = await dialog.showConfirm("Quit", "Are you sure you want to quit?")
      if (confirmed) {
        ;(window as any).electron.quit()
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
              await saveAllFiles()
              ;(window as any).electron.quit()
              resolve()
            },
          },
          {
            label: "Discard",
            onClick: () => {
              ;(window as any).electron.quit()
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



  const handleRefreshExplorer = async () => {
    if (!datapacks.length) return
    await refreshDatapacks(datapacks.map((datapack) => datapack.dir))
  }

  const handleAddDatapack = async () => {
    const folder = await (window as any).electron.pickFolder()
    if (!folder) return

    try {
      await (window as any).electron.addDatapackExisting(folder)
      const existingDirs = datapacks.map((datapack) => datapack.dir)
      await refreshDatapacks([...existingDirs, folder])
    } catch (error) {
      console.error("Failed to add datapack:", error)
      await dialog.showAlert("Error", `Failed to add datapack: ${error instanceof Error ? error.message : "Unknown error"}`)
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
      await (window as any).electron.workspaceRemoveDatapack(metadataPath)
      
      // Refresh the datapack list
      const updatedDirs = datapacks.filter((dp) => dp.dir !== datapackDir).map((dp) => dp.dir)
      await refreshDatapacks(updatedDirs)
    } catch (error) {
      console.error("Failed to remove datapack:", error)
      await dialog.showAlert("Error", `Failed to remove datapack: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }

  const removeFileFromOpenedFiles = (fileKey: string) => {
    setOpenedFiles((prev) => prev.filter((f) => createFileKey(f.datapackDir, f.relativePath) !== fileKey))
  }

  const removeFileFromModifiedFiles = (fileKey: string) => {
    setModifiedFiles((prev) => {
      const next = new Set(prev)
      next.delete(fileKey)
      return next
    })
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
  }

  const handleFileRenamed = async (datapackDir: string, oldRelativePath: string, newName: string): Promise<boolean> => {
    const oldFileKey = createFileKey(datapackDir, oldRelativePath)
    
    // Pre-rename check: if newName is empty, just validate unsaved changes
    if (!newName) {
      if (!modifiedFiles.has(oldFileKey)) return true
      
      const openedFile = openedFiles.find((f) => createFileKey(f.datapackDir, f.relativePath) === oldFileKey)
      const fileName = openedFile?.fileName || "this file"
      
      const choice = await dialog.showUnsavedConfirm("Rename File?", `${fileName} has unsaved changes. What would you like to do?`)
      if (choice === "cancel") return false
      if (choice === "save") await saveFileInternal(oldFileKey)
      if (choice === "discard") {
        removeFileFromModifiedFiles(oldFileKey)
      }
      return true
    }

    // Post-rename: update the open file
    const openedFileIndex = openedFiles.findIndex((f) => createFileKey(f.datapackDir, f.relativePath) === oldFileKey)
    if (openedFileIndex === -1) return true // File wasn"t open
    
    // Calculate new relative path
    const newRelativePath = oldRelativePath.split("/").slice(0, -1).concat(newName).join("/")
    const newFileKey = createFileKey(datapackDir, newRelativePath)
    const wasActive = activeFile === oldFileKey

    const cachedState = fileEditorStatesRef.current.get(oldFileKey)
    if (cachedState) {
      fileEditorStatesRef.current.set(newFileKey, cachedState)
    }

    clearAutoSaveTimer(oldFileKey)
    
    try {
      const freshContents = await (window as any).electron.readFile(datapackDir, newRelativePath)
      
      setOpenedFiles((prev) => {
        const filtered = prev.filter((f) => createFileKey(f.datapackDir, f.relativePath) !== oldFileKey)
        const newFile: OpenedFile = {
          datapackDir,
          relativePath: newRelativePath,
          fileName: newName,
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
        await openFile(newFileKey)
      }

      fileEditorStatesRef.current.delete(oldFileKey)
      
    } catch (error) {
      console.error("Failed to read renamed file:", error)
      await dialog.showAlert("Error", `Failed to read renamed file: ${error instanceof Error ? error.message : "Unknown error"}`)
    }

    return true
  }

  const handleFileDeleted = async (datapackDir: string, relativePath: string): Promise<boolean> => {
    const fileKey = createFileKey(datapackDir, relativePath)
    const openedFileIndex = openedFiles.findIndex((f) => createFileKey(f.datapackDir, f.relativePath) === fileKey)
    
    if (openedFileIndex === -1) {
      // File wasn"t open, nothing to do
      return true
    }

    // Check if the file is modified
    if (modifiedFiles.has(fileKey)) {
      const fileName = openedFiles.find((f) => createFileKey(f.datapackDir, f.relativePath) === fileKey)?.fileName || "this file"
      const choice = await dialog.showUnsavedConfirm("Delete File?", `${fileName} has unsaved changes. What would you like to do?`)
      if (choice === "cancel") return false
      if (choice === "save") await saveFileInternal(fileKey)
      if (choice === "discard") {
        removeFileFromModifiedFiles(fileKey)
      }
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

    return true
  }

  const openFile = async (fileKey: string | null) => {
    const view = viewRef.current
    if (!view) {
      setActiveFile(fileKey)
      activeFileRef.current = fileKey
      setDiagnosticSummary(fileKey ? (fileDiagnosticSummaries[fileKey] ?? defaultDiagnosticSummary) : defaultDiagnosticSummary)
      focusFileInExplorer(fileKey)
      return
    }

    persistActiveEditorState()
    setActiveFile(fileKey)
    activeFileRef.current = fileKey
    setDiagnosticSummary(fileKey ? (fileDiagnosticSummaries[fileKey] ?? defaultDiagnosticSummary) : defaultDiagnosticSummary)
    focusFileInExplorer(fileKey)
    
    if (!fileKey) {
      view.setState(createEditorState("", null))
      setCursorMarkerInfo(getCursorMarkerInfo(view.state))
      return
    }
    
    // Parse file key to get datapack dir and relative path
    const { datapackDir, relativePath } = parseFileKey(fileKey)
    
    // Find the opened file to get cached content
    const openedFile = openedFiles.find((f) => createFileKey(f.datapackDir, f.relativePath) === fileKey)
    
    let contents = ""
    
    // Use cached content if available, otherwise read from disk
    if (openedFile?.content !== undefined) {
      contents = openedFile.content
    } else {
      try {
        contents = await (window as any).electron.readFile(datapackDir, relativePath)
      } catch (error) {
        console.error("Failed to read file:", error)
        await dialog.showAlert("Error", `Failed to read file: ${error instanceof Error ? error.message : "Unknown error"}`)
        return
      }
    }
    
    const cachedState = fileEditorStatesRef.current.get(fileKey)
    if (cachedState) {
      view.setState(cachedState)
      setCursorMarkerInfo(getCursorMarkerInfo(view.state))
      view.focus()
      return
    }

    const newState = createEditorState(contents, fileKey)
    fileEditorStatesRef.current.set(fileKey, newState)
    view.setState(newState)
    setCursorMarkerInfo(getCursorMarkerInfo(view.state))
    view.focus()
  }

  const handleExplorerSelect = async (datapackDir: string, pathKey: string, isFile: boolean) => {
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

    const rootName = datapackDir.split(/[\\/]/).pop() || ""
    const normalizedKey = pathKey.replace(/\\/g, "/")
    const rootPrefix = rootName ? `${rootName}/` : ""
    const relativePath = normalizedKey === rootName
      ? ""
      : normalizedKey.startsWith(rootPrefix)
        ? normalizedKey.slice(rootPrefix.length)
        : normalizedKey

    const trimmedRelative = relativePath.replace(/^\/+/, "")
    const fileName = trimmedRelative.split("/").pop() || ""
    if (!trimmedRelative || !fileName.includes(".")) return

    // Create file key for tracking
    const fileKey = createFileKey(datapackDir, trimmedRelative)
    setExplorerSelectedFileKeysByDatapack((prev) => ({
      ...prev,
      [datapackDir]: fileKey,
    }))
    
    // Check if file is already open
    const existingFile = openedFiles.find((f) => createFileKey(f.datapackDir, f.relativePath) === fileKey)
    if (!existingFile) {
      // Load content from disk for new files
      try {
        const content = await (window as any).electron.readFile(datapackDir, trimmedRelative)
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
    
    // Set as active and load content
    await openFile(fileKey)
  }

  const clearAutoSaveTimer = (fileKey: string) => {
    const timerId = autoSaveTimersRef.current.get(fileKey)
    if (timerId !== undefined) {
      window.clearTimeout(timerId)
      autoSaveTimersRef.current.delete(fileKey)
    }
  }

  const saveFile = async (fileKey: string, contents: string) => {
    const { datapackDir, relativePath } = parseFileKey(fileKey)

    try {
      await (window as any).electron.saveFile(datapackDir, relativePath, contents)
      
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

      // Clear any pending autosave
      clearAutoSaveTimer(fileKey)
    } catch (error) {
      console.error("Failed to save file:", error)
      await dialog.showAlert("Error", `Failed to save file: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }

  const saveCurrentFile = async () => {
    if (!activeFile || !viewRef.current) return
    const contents = viewRef.current.state.doc.toString()
    await saveFile(activeFile, contents)
  }

  const saveFileInternal = async (fileKey: string) => {
    const openedFile = openedFiles.find((f) => createFileKey(f.datapackDir, f.relativePath) === fileKey)
    if (openedFile) {
      await saveFile(fileKey, openedFile.content)
    }
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

  const saveAllFiles = async () => {
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
      await Promise.all(savePromises)
    } catch (error) {
      console.error("Failed to save all files:", error)
      await dialog.showAlert("Error", `Failed to save all files: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }

  const closeTab = async (fileKey: string): Promise<boolean> => {
    // Check if file is modified and confirm close
    if (modifiedFiles.has(fileKey)) {
      const fileName = openedFiles.find((f) => createFileKey(f.datapackDir, f.relativePath) === fileKey)?.fileName || "this file"
      const choice = await dialog.showUnsavedConfirm("Close File?", `${fileName} has unsaved changes. What would you like to do?`)
      if (choice === "cancel") return false
      if (choice === "save") await saveFileInternal(fileKey)
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
    void (async () => {
      try {
        await loadMcfunctionCommandSchema("1.21.11")
        await loadMinecraftData("1.21.11")
      } catch (error) {
        console.error("Failed to load mcfunction command schema:", error)
      }
    })()
  }, [])

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
      if (fileKey) {
        setFileDiagnosticSummaries((prev) => ({
          ...prev,
          [fileKey]: summary,
        }))
      }

      if (activeFileRef.current === fileKey) {
        setDiagnosticSummary(summary)
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

          if (update.docChanged && activeFileRef.current) {
            const fileKey = activeFileRef.current
            const newContent = update.state.doc.toString()

            setModifiedFiles((prev) => new Set(prev).add(fileKey))

            setOpenedFiles((prev) =>
              prev.map((f) =>
                createFileKey(f.datapackDir, f.relativePath) === fileKey
                  ? { ...f, content: newContent }
                  : f
              )
            )

            scheduleAutoSave(fileKey, newContent)
          }
        }),
        EditorView.domEventHandlers({
          focus: () => {
            window.requestAnimationFrame(() => {
              scrollTabIntoView(activeFileRef.current, "smooth")
              focusFileInExplorer(activeFileRef.current)
            })
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
    modifiedFilesRef.current = modifiedFiles
  }, [modifiedFiles])

  useEffect(() => {
    if (!workspaceInfo.dir || datapacks.length === 0) {
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

    void (async () => {
      const nextSummaries = await runGlobalDiagnosticsScan({
        datapacks,
        openedFiles: openedFilesRef.current,
        modifiedFileKeys: modifiedFilesRef.current,
        readFile: (datapackDir, relativePath) => (window as any).electron.readFile(datapackDir, relativePath),
        shouldCancel: () => diagnosticsScanRunIdRef.current !== scanRunId,
      })

      if (!nextSummaries) return
      if (diagnosticsScanRunIdRef.current !== scanRunId) return

      setFileDiagnosticSummaries((prev) => {
        const preservedModified: Record<string, DiagnosticSummary> = {}
        for (const [fileKey, summary] of Object.entries(prev)) {
          if (modifiedFilesRef.current.has(fileKey)) {
            preservedModified[fileKey] = summary
          }
        }
        return {
          ...nextSummaries,
          ...preservedModified,
        }
      })
    })()
  }, [workspaceInfo.dir, datapacks])

  // Handle workspace tab restoration on workspace load
  useEffect(() => {
    const restoreWorkspaceTabs = async () => {
      if (!workspaceInfo.dir) return

      isRestoringTabsRef.current = true
      try {
        const savedValue = await (window as any).electron.workspaceGetPreference(OPEN_TABS_PREFERENCE_KEY)
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
            const content = await (window as any).electron.readFile(file.datapackDir, file.relativePath)
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
        const savedValue = await (window as any).electron.workspaceGetPreference(EXPLORER_EXPANDED_PREFERENCE_KEY)
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
        await (window as any).electron.workspaceUpdatePreference(OPEN_TABS_PREFERENCE_KEY, session)
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
        await (window as any).electron.workspaceUpdatePreference(EXPLORER_EXPANDED_PREFERENCE_KEY, payload)
      } catch (error) {
        console.error("Failed to save explorer expansion state:", error)
        await dialog.showAlert("Error", `Failed to save explorer expansion state: ${error instanceof Error ? error.message : "Unknown error"}`)
      }
    }

    persistExplorerExpanded()
  }, [workspaceInfo.dir, explorerExpandedPathsByDatapack])

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
      fileEditorStatesRef.current.clear()
    }
  }, [])

  useEffect(() => {
    ;(window as any).electron.isFullScreen().then(setIsFullScreen)

    ;(window as any).electron.onFullscreenChange((isFullScreen: boolean) => {
      setIsFullScreen(isFullScreen)
    })

    const unsubscribeTitlebarContextMenu = (window as any).electron.onTitlebarContextMenu?.((position: { x: number; y: number }) => {
      contextMenuRequest.openAt(position.x, position.y, { items: titlebarContextItems })
    })

    return () => {
      if (typeof unsubscribeTitlebarContextMenu === "function") {
        unsubscribeTitlebarContextMenu()
      }
    }
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (_: any, action: string) => {
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

    const unsubscribe = (window as any).electron.onShortcut(handler)
    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe()
      }
    }
  }, [activeFile, modifiedFiles, handleOpenWorkspaceWithConfirm, handleQuitWithConfirm, saveCurrentFile, saveAllFiles, closeTab])

  useEffect(() => {
    const loadWorkspaceDatapacks = async () => {
      if (!workspaceInfo.dir) return
      try {
        const metadataPaths = await handleGetDatapacks()
        const datapackDirs = metadataPaths.map((metadataPath: string) => getDirFromPath(metadataPath))
        await refreshDatapacks(datapackDirs)
      } catch (error) {
        console.error("Failed to load workspace datapacks:", error)
        await dialog.showAlert("Error", `Failed to load workspace datapacks: ${error instanceof Error ? error.message : "Unknown error"}`)
      }
    }

    loadWorkspaceDatapacks()
  }, [workspaceInfo.dir])

  useEffect(() => {
    const relativePaths = datapacks.flatMap(datapack => datapack.paths)
    setWorkspaceResourcePathsFromRelativePaths(relativePaths)
  }, [datapacks])

  const activeRelativePath = activeFile ? parseFileKey(activeFile).relativePath : null
  const activeLanguage = detectEditorLanguage(activeRelativePath)
  const showDiagnosticSummary = activeLanguage.supportsDiagnostics
  const activeFileRelativePathLabel = activeRelativePath
    ? activeRelativePath
      .replace(/\\/g, "/")
      .split("/")
      .filter(Boolean)
      .join(" > ")
    : "No file open"

  const fileNameCounts = openedFiles.reduce((counts, file) => {
    counts.set(file.fileName, (counts.get(file.fileName) ?? 0) + 1)
    return counts
  }, new Map<string, number>())

  const getDuplicateTabFolderLabel = (file: OpenedFile): string | null => {
    if ((fileNameCounts.get(file.fileName) ?? 0) < 2) return null

    const datapackName = file.datapackDir.split(/[\\/]/).filter(Boolean).pop() || ""
    const dirs = file.relativePath.split("/").filter(Boolean).slice(0, -1)
    const segments = [datapackName, ...dirs].filter(Boolean)

    const siblings = openedFiles.filter((candidate) => candidate.fileName === file.fileName)
    if (siblings.length < 2) return null

    const siblingSegments = siblings.map((candidate) => {
      const candidateDatapack = candidate.datapackDir.split(/[\\/]/).filter(Boolean).pop() || ""
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
    const normalizedRelative = relativePath.replace(/\\/g, "/").replace(/^\/+/, "")
    const segments = normalizedRelative.split("/").filter(Boolean)
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
    const rootName = datapackDir.split(/[\\/]/).pop() || ""
    if (!rootName) return

    const normalizedRelative = relativePath.replace(/\\/g, "/").replace(/^\/+/, "")
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
    } catch (error) {
      console.error("Failed to copy path:", error)
      await dialog.showAlert("Error", `Failed to copy path: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }

  const copyTabRelativePath = async (fileKey: string) => {
    const { relativePath } = parseFileKey(fileKey)
    try {
      await navigator.clipboard.writeText(relativePath)
    } catch (error) {
      console.error("Failed to copy relative path:", error)
      await dialog.showAlert("Error", `Failed to copy relative path: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }

  const revealInFileExplorer = async (fileKey: string) => {
    const { datapackDir, relativePath } = parseFileKey(fileKey)
    const fullPath = `${datapackDir}/${relativePath}`.replace(/\//g, "\\")
    try {
      await (window as any).electron.revealInFileExplorer(fullPath)
    } catch (error) {
      console.error("Failed to reveal in file explorer:", error)
      await dialog.showAlert("Error", `Failed to reveal file in explorer: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }

  const openedFileKeys = getOpenedFileKeys()
  const hasSavedTabs = openedFileKeys.some((fileKey) => !modifiedFiles.has(fileKey))
  const hasAnyOpenTabs = openedFileKeys.length > 0

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
          ;(window as any).electron.toggleFullscreen()
        }
      },
      disabled: !isFullScreen,
    },
    {
      label: "Minimize",
      onClick: () => {
        ;(window as any).electron.minimize()
      },
    },
    {
      label: "Maximize",
      onClick: () => {
        if (!isFullScreen) {
          ;(window as any).electron.toggleFullscreen()
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

  const leftPanelTabs: PanelTab[] = [
    {
      id: "explorer",
      title: "Explorer",
      icon: "codicon-file-directory",
      visible: visibleLeftPanelTabs.has("explorer"),
      content: datapacks.length ? (
        <div className="space-y-4">
          {datapacks.map((datapack) => (
            <DatapackTree
              key={datapack.dir}
              paths={datapack.paths}
              folderName={datapack.name}
              rootId={datapack.id}
              rootName={datapack.displayName}
              rootPackVersion={datapack.packVersion}
              basePath={datapack.dir}
              className="mt-2"
              externalSelectedPath={explorerSelectedPathsByDatapack[datapack.dir]}
              externalSelectedFileKey={explorerSelectedFileKeysByDatapack[datapack.dir]}
              externalExpandedPaths={explorerExpandedPathsByDatapack[datapack.dir]}
              onExpandedPathsChange={(paths) =>
                setExplorerExpandedPathsByDatapack((prev) => ({
                  ...prev,
                  [datapack.dir]: paths,
                }))
              }
              treeContainerRef={getExplorerContainerRef(datapack.dir)}
              onFolderCreated={handleRefreshExplorer}
              onSelect={(pathKey, isFile) => handleExplorerSelect(datapack.dir, pathKey, isFile)}
              onFileRenamed={(oldRelativePath, newName) => handleFileRenamed(datapack.dir, oldRelativePath, newName)}
              onFileDeleted={(relativePath) => handleFileDeleted(datapack.dir, relativePath)}
              onContextMenuRequest={handleDatapackTreeContextMenu}
              modifiedFileKeys={modifiedFiles}
              fileDiagnosticSummaries={fileDiagnosticSummaries}
            />
          ))}
        </div>
      ) : (
        <>
          <div className="text-sm text-codemirror-300">No datapacks added</div>
          <div className="flex flex-col items-center m-4 button" onClick={handleAddDatapack}>
            <div className="text-sm text-codemirror-100">Add Existing Datapack</div>
          </div>
        </>
      )
    }
  ]

  const rightPanelTabs: PanelTab[] = [
    {
      id: "preferences",
      title: "Preferences",
      icon: "codicon-settings",
      visible: visibleRightPanelTabs.has("preferences"),
      content: workspaceInfo.dir ? (
        <div className="text-sm text-codemirror-300">
          <div className="font-mono break-words">{workspaceInfo.dir}</div>
        </div>
      ) : (
        <div className="text-sm text-codemirror-300">No folder selected</div>
      )
    },
    {
      id: "settings",
      title: "Settings",
      icon: "codicon-gear",
      visible: visibleRightPanelTabs.has("settings"),
      content: (
        <div className="text-sm text-codemirror-300">Application settings will appear here</div>
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

  return (
    <div className="w-full h-full flex flex-col select-none">

      {/* Title Bar */}
      <div className="flex flex-row h-[36px] bg-codemirror-700 text-sm text-codemirror-100 border-b border-codemirror-600" style={{ WebkitAppRegion: "drag" } as any}>

        {/* App Icon */}
        <div className="px-4 py-2 font-bold" onContextMenu={handleTitlebarRightClick}>
          <img src={iconPath} alt="MCFunction++" style={{ height: "20px", width: "20px" }} />
        </div>
        
        {/* Title Bar Buttons */}
        <div className="flex flex-row flex-1" style={{ WebkitAppRegion: "no-drag" } as any}>

          <DropdownMenu 
            label="App"
            items={[
              { label: "Preferences", onClick: undefined, disabled: true },
              {},
              { label: "Report Bug", onClick: undefined, disabled: true },
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
              { label: "Save Workspace", onClick: handleSaveWorkspace },
              { label: "Save Workspace As", onClick: handleSaveWorkspaceAs },
              {},
              { label: "Add Existing Datapack", onClick: handleAddDatapack },
              {
                label: "Remove Datapack",
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
                label: "Settings",
                toggleable: true,
                toggled: visibleRightPanelTabs.has("settings"),
                onToggle: (nextState) => handleToggleRightTab("settings", nextState)
              }
            ] as MenuItem[]}
            isOpen={isHeaderMenuSixOpen}
            setIsOpen={setIsHeaderMenuSixOpen}
            disabled={dialog.isOpen}
          />

          <div className="flex-1" style={{ WebkitAppRegion: "drag" } as any} onContextMenu={handleTitlebarRightClick}></div>
          
          {/* Window Control Buttons */}
          <Tooltip content="Minimize">
            <div
              onClick={() => (window as any).electron.minimize()} 
              className="header-button pt-2.5 pb-2 codicon codicon-chrome-minimize"
            />
          </Tooltip>
          <Tooltip content={`${isFullScreen ? "Restore" : "Maximize"}`}>
            <div
              onClick={() => (window as any).electron.toggleFullscreen()}
              className={`header-button pt-2.5 pb-2 codicon ${isFullScreen ? "codicon-chrome-restore" : "codicon-chrome-maximize"}`}
            />
          </Tooltip>
          <Tooltip content="Close">
            <div
              onClick={handleQuitWithConfirm}
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
                {label: "Refresh", onClick: handleRefreshExplorer}
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
                const duplicateFolderLabel = getDuplicateTabFolderLabel(file)
                const isDragging = draggingFileKey === fileKey
                const showLeftIndicator = dragOverFileKey === fileKey && dragOverPosition === "before"
                const showRightIndicator = dragOverFileKey === fileKey && dragOverPosition === "after"
                return (
                  <div className="relative flex" key={fileKey}>
                    {showLeftIndicator && (
                      <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-codemirror-100 pointer-events-none" />
                    )}
                    <div
                      ref={(element) => registerTabElement(fileKey, element)}
                      draggable
                      onContextMenu={(event) => handleTabRightClick(event, fileKey)}
                      onClick={() => {
                        openFile(fileKey)
                      }}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move"
                        event.dataTransfer.setData("text/plain", fileKey)
                        setDraggingFileKey(fileKey)

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

                        if (modifiedFiles.has(fileKey)) {
                          const indicator = document.createElement("div")
                          indicator.className = `codicon codicon-circle-filled text-orange-300 ml-2`
                          ghost.appendChild(indicator)
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
                        flex items-center gap-2 px-2 py-1
                        border-r border-codemirror-600
                        whitespace-nowrap
                        cursor-pointer
                        ${isDragging ? "opacity-10" : ""}
                        ${isActive
                          ? "bg-codemirror-default text-codemirror-100"
                          : "hover:bg-codemirror-highlight text-codemirror-300"
                        }
                      `}
                    >
                    <span className="text-sm">{file.fileName}</span>

                    {/* Duplicate Disambiguation Label */}
                    {duplicateFolderLabel && (
                      <span className="text-xs text-codemirror-300 italic">{duplicateFolderLabel}</span>
                    )}

                    {/* Indicators */}
                    {modifiedFiles.has(fileKey) &&
                      <div className={`codicon codicon-circle-filled text-orange-300`}/>
                    }

                    {/* Close Button */}
                    <div
                      onClick={(e) => {
                        e.stopPropagation()
                        closeTab(fileKey)
                      }}
                      className={`codicon codicon-close
                        p-1
                        text-codemirror-200 hover:text-codemirror-50
                        cursor-pointer`}
                    />
                    </div>
                    {showRightIndicator && (
                      <div className="absolute right-0 top-0 bottom-0 w-[2px] bg-codemirror-100 pointer-events-none" />
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
      <div className="h-[30px] border-t border-codemirror-600
        bg-codemirror-700 text-codemirror-100
        flex flex-row items-center
      ">

        <div className="footer-element">Made by touchportyl</div>

        <div className="flex-1"/>

        {activeFile && (<>

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

      {/* Dialog */}
      {dialog.dialogProps && (
        <Dialog {...dialog.dialogProps} />
      )}
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