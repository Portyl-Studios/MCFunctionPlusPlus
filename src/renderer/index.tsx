import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'

import { EditorState } from '@codemirror/state'
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
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { foldGutter, foldKeymap, indentOnInput, syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language'
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { lintKeymap } from '@codemirror/lint'
import { json } from '@codemirror/lang-json'
import { oneDark } from '@codemirror/theme-one-dark'
import './index.css'
import { Panel, ResizeHandle, useResizablePanel } from './panel'
import { DropdownMenu, type MenuItem } from './dropdownmenu'
import { useWorkspace } from './use-workspace'
import iconPath from '../../assets/icon.png'
import { DatapackTree } from './datapacktree'
import { Dialog, useDialog } from './dialog'
import { ContextMenu, useContextMenu } from './contextmenu'
import { getDirFromPath, toRelativePaths, createFileKey, parseFileKey } from './utils'

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

const OPEN_TABS_PREFERENCE_KEY = 'openTabs'

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
  autocompletion(),
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
  const leftPanel = useResizablePanel({ initialWidth: 350, position: 'left' })
  const rightPanel = useResizablePanel({ initialWidth: 350, position: 'right' })
  const [datapacks, setDatapacks] = useState<DatapackEntry[]>([])
  const [isHeaderMenuOneOpen, setIsHeaderMenuOneOpen] = useState(false)
  const [isHeaderMenuTwoOpen, setIsHeaderMenuTwoOpen] = useState(false)
  const [isHeaderMenuThreeOpen, setIsHeaderMenuThreeOpen] = useState(false)
  const [isHeaderMenuFourOpen, setIsHeaderMenuFourOpen] = useState(false)
  const [isFullScreen, setIsFullScreen] = useState(false)
  const [openedFiles, setOpenedFiles] = useState<OpenedFile[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [modifiedFiles, setModifiedFiles] = useState<Set<string>>(new Set())
  const tabsRef = useRef<HTMLDivElement>(null)
  const tabElementRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [isAutoSaveEnabled, setIsAutoSaveEnabled] = useState(false)
  const isRestoringTabsRef = useRef(false)
  const lastSavedTabSessionSignatureRef = useRef('')
  const fileEditorStatesRef = useRef<Map<string, EditorState>>(new Map())
  const tabContextMenu = useContextMenu()
  const [tabContextFileKey, setTabContextFileKey] = useState<string | null>(null)
  // Refs are used to access current state values inside closures (e.g., editor listeners)
  // without triggering re-renders or stale closure issues
  const isAutoSaveEnabledRef = useRef(isAutoSaveEnabled)
  // Track auto-save timers per file using fileKey format: "datapackDir|relativePath"
  const autoSaveTimersRef = useRef<Map<string, number>>(new Map())
  const dialog = useDialog()
  const isDialogOpenRef = useRef(dialog.isOpen)
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
        const savedValue = await (window as any).electron.workspaceGetPreference('autoSave')
        if (typeof savedValue === 'boolean') {
          setIsAutoSaveEnabled(savedValue)
        }
      } catch (error) {
        console.error('Failed to load auto-save preference:', error)
        await dialog.showAlert('Error', `Failed to load auto-save preference: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    loadAutoSavePreference()
  }, [workspaceInfo.dir])

  // Save auto-save preference when it changes
  const toggleAutoSave = async (enabled: boolean) => {
    setIsAutoSaveEnabled(enabled)
    try {
      await (window as any).electron.workspaceUpdatePreference('autoSave', enabled)
    } catch (error) {
      console.error('Failed to save auto-save preference:', error)
      await dialog.showAlert('Error', `Failed to save auto-save preference: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const parseWorkspaceTabSession = (value: unknown): WorkspaceTabSession | null => {
    if (!value || typeof value !== 'object') return null

    const maybeSession = value as { openedFiles?: unknown; activeFile?: unknown }
    if (!Array.isArray(maybeSession.openedFiles)) return null

    const openedFiles = maybeSession.openedFiles
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null
        const maybeFile = entry as { datapackDir?: unknown; relativePath?: unknown }
        if (typeof maybeFile.datapackDir !== 'string' || typeof maybeFile.relativePath !== 'string') {
          return null
        }
        return {
          datapackDir: maybeFile.datapackDir,
          relativePath: maybeFile.relativePath,
        }
      })
      .filter((entry): entry is WorkspaceTabSessionFile => !!entry)

    const activeFile = typeof maybeSession.activeFile === 'string'
      ? maybeSession.activeFile
      : null

    return {
      openedFiles,
      activeFile,
    }
  }

  const loadDatapackEntry = async (datapackDir: string): Promise<DatapackEntry | null> => {
    try {
      const files = await (window as any).electron.listFiles(datapackDir)
      const paths = Array.isArray(files) ? files : []
      const name = datapackDir.split(/[\\/]/).pop() || 'datapack'
      let id: string | undefined
      let displayName: string | undefined
      let packVersion: string | undefined
      try {
        const metadataRaw = await (window as any).electron.readFile(datapackDir, '.mpp-datapack')
        const parsed = JSON.parse(metadataRaw)
        if (parsed && typeof parsed.id === 'string') {
          id = parsed.id
        }
        if (parsed && typeof parsed.name === 'string') {
          displayName = parsed.name
        }
        if (parsed && typeof parsed.packVersion === 'string') {
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
        title: 'Unsaved Changes',
        message: `You have ${modifiedFiles.size} unsaved file(s). What would you like to do?`,
        buttons: [
          {
            label: 'Save',
            onClick: async () => {
              await saveAllFiles()
              await workspaceChangeAction()
              resolve()
            },
          },
          {
            label: 'Discard',
            onClick: async () => {
              await workspaceChangeAction()
              resolve()
            },
          },
          {
            label: 'Cancel',
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
    // If no unsaved files, just quit
    if (modifiedFiles.size === 0) {
      ;(window as any).electron.quit()
      return
    }

    // Use Promise wrapper to make async dialog behave synchronously
    // This ensures quit only happens after user makes a choice
    await new Promise<void>((resolve) => {
      dialog.openDialog({
        title: 'Unsaved Changes',
        message: `You have ${modifiedFiles.size} unsaved file(s). Do you want to save before quitting?`,
        buttons: [
          {
            label: 'Save',
            onClick: async () => {
              await saveAllFiles()
              ;(window as any).electron.quit()
              resolve()
            },
          },
          {
            label: 'Discard',
            onClick: () => {
              ;(window as any).electron.quit()
              resolve()
            },
          },
          {
            label: 'Cancel',
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
      console.error('Failed to add datapack:', error)
      await dialog.showAlert('Error', `Failed to add datapack: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const handleRemoveDatapack = async (datapackDir: string) => {
    try {
      // Get the metadata path for this datapack
      const metadataPath = `${datapackDir}/.mpp-datapack`
      
      // Remove from workspace
      await (window as any).electron.workspaceRemoveDatapack(metadataPath)
      
      // Refresh the datapack list
      const updatedDirs = datapacks.filter((dp) => dp.dir !== datapackDir).map((dp) => dp.dir)
      await refreshDatapacks(updatedDirs)
    } catch (error) {
      console.error('Failed to remove datapack:', error)
      await dialog.showAlert('Error', `Failed to remove datapack: ${error instanceof Error ? error.message : 'Unknown error'}`)
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
      const fileName = openedFile?.fileName || 'this file'
      
      const choice = await dialog.showUnsavedConfirm('Rename File?', `${fileName} has unsaved changes. What would you like to do?`)
      if (choice === 'cancel') return false
      if (choice === 'save') await saveFileInternal(oldFileKey)
      if (choice === 'discard') {
        removeFileFromModifiedFiles(oldFileKey)
      }
      return true
    }

    // Post-rename: update the open file
    const openedFileIndex = openedFiles.findIndex((f) => createFileKey(f.datapackDir, f.relativePath) === oldFileKey)
    if (openedFileIndex === -1) return true // File wasn't open
    
    // Calculate new relative path
    const newRelativePath = oldRelativePath.split('/').slice(0, -1).concat(newName).join('/')
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

      if (wasActive) {
        await openFile(newFileKey)
      }

      fileEditorStatesRef.current.delete(oldFileKey)
      
    } catch (error) {
      console.error('Failed to read renamed file:', error)
      await dialog.showAlert('Error', `Failed to read renamed file: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }

    return true
  }

  const handleFileDeleted = async (datapackDir: string, relativePath: string): Promise<boolean> => {
    const fileKey = createFileKey(datapackDir, relativePath)
    const openedFileIndex = openedFiles.findIndex((f) => createFileKey(f.datapackDir, f.relativePath) === fileKey)
    
    if (openedFileIndex === -1) {
      // File wasn't open, nothing to do
      return true
    }

    // Check if the file is modified
    if (modifiedFiles.has(fileKey)) {
      const fileName = openedFiles.find((f) => createFileKey(f.datapackDir, f.relativePath) === fileKey)?.fileName || 'this file'
      const choice = await dialog.showUnsavedConfirm('Delete File?', `${fileName} has unsaved changes. What would you like to do?`)
      if (choice === 'cancel') return false
      if (choice === 'save') await saveFileInternal(fileKey)
      if (choice === 'discard') {
        removeFileFromModifiedFiles(fileKey)
      }
    }

    // Close the file
    clearAutoSaveTimer(fileKey)
    fileEditorStatesRef.current.delete(fileKey)
    
    // Remove from opened files and modified files
    const updatedFiles = openedFiles.filter((f) => createFileKey(f.datapackDir, f.relativePath) !== fileKey)
    removeFileFromOpenAndModified(fileKey)

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
      return
    }

    persistActiveEditorState()
    setActiveFile(fileKey)
    activeFileRef.current = fileKey
    
    if (!fileKey) {
      view.setState(createEditorState(''))
      return
    }
    
    // Parse file key to get datapack dir and relative path
    const { datapackDir, relativePath } = parseFileKey(fileKey)
    
    // Find the opened file to get cached content
    const openedFile = openedFiles.find((f) => createFileKey(f.datapackDir, f.relativePath) === fileKey)
    
    let contents = ''
    
    // Use cached content if available, otherwise read from disk
    if (openedFile?.content !== undefined) {
      contents = openedFile.content
    } else {
      try {
        contents = await (window as any).electron.readFile(datapackDir, relativePath)
      } catch (error) {
        console.error('Failed to read file:', error)
        await dialog.showAlert('Error', `Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`)
        return
      }
    }
    
    const cachedState = fileEditorStatesRef.current.get(fileKey)
    if (cachedState) {
      view.setState(cachedState)
      view.focus()
      return
    }

    const newState = createEditorState(contents)
    fileEditorStatesRef.current.set(fileKey, newState)
    view.setState(newState)
    view.focus()
  }

  const handleExplorerSelect = async (datapackDir: string, pathKey: string, isFile: boolean) => {
    if (!isFile) return

    const rootName = datapackDir.split(/[\\/]/).pop() || ''
    const normalizedKey = pathKey.replace(/\\/g, '/')
    const rootPrefix = rootName ? `${rootName}/` : ''
    const relativePath = normalizedKey === rootName
      ? ''
      : normalizedKey.startsWith(rootPrefix)
        ? normalizedKey.slice(rootPrefix.length)
        : normalizedKey

    const trimmedRelative = relativePath.replace(/^\/+/, '')
    const fileName = trimmedRelative.split('/').pop() || ''
    if (!trimmedRelative || !fileName.includes('.')) return

    // Create file key for tracking
    const fileKey = createFileKey(datapackDir, trimmedRelative)
    
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
        console.error('Failed to read file:', error)
        await dialog.showAlert('Error', `Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`)
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
      console.error('Failed to save file:', error)
      await dialog.showAlert('Error', `Failed to save file: ${error instanceof Error ? error.message : 'Unknown error'}`)
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
      console.error('Failed to save all files:', error)
      await dialog.showAlert('Error', `Failed to save all files: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const closeTab = async (fileKey: string) => {
    // Check if file is modified and confirm close
    if (modifiedFiles.has(fileKey)) {
      const fileName = openedFiles.find((f) => createFileKey(f.datapackDir, f.relativePath) === fileKey)?.fileName || 'this file'
      const choice = await dialog.showUnsavedConfirm('Close File?', `${fileName} has unsaved changes. What would you like to do?`)
      if (choice === 'cancel') return
      if (choice === 'save') await saveFileInternal(fileKey)
      if (choice === 'discard') {
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
  }

  // Keep refs in sync with state so they can be used in event listeners and closures
  const activeFileRef = useRef(activeFile)
  useEffect(() => {
    activeFileRef.current = activeFile
  }, [activeFile])

  const createEditorState = (doc: string) => EditorState.create({
    doc,
    extensions: [
      oneDark,
      ...codeMirrorSetupExtensions,
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
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
            scrollTabIntoView(activeFileRef.current, 'smooth')
          })
        },
      }),
      json(),
    ],
  })

  const persistActiveEditorState = () => {
    const currentFileKey = activeFileRef.current
    const view = viewRef.current
    if (!currentFileKey || !view) return
    fileEditorStatesRef.current.set(currentFileKey, view.state)
  }

  const scrollTabIntoView = (fileKey: string | null, behavior: ScrollBehavior = 'smooth') => {
    if (!fileKey) return

    const activeTabElement = tabElementRefs.current.get(fileKey)
    if (!activeTabElement) return

    activeTabElement.scrollIntoView({
      behavior,
      block: 'nearest',
      inline: 'nearest',
    })
  }

  useEffect(() => {
    isAutoSaveEnabledRef.current = isAutoSaveEnabled
  }, [isAutoSaveEnabled])

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
              fileName: file.relativePath.split('/').pop() || file.relativePath,
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
        console.error('Failed to restore workspace tabs:', error)
        await dialog.showAlert('Error', `Failed to restore workspace tabs: ${error instanceof Error ? error.message : 'Unknown error'}`)
        setOpenedFiles([])
        await openFile(null)
      } finally {
        isRestoringTabsRef.current = false
      }
    }

    restoreWorkspaceTabs()
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
        console.error('Failed to save workspace tab session:', error)
        await dialog.showAlert('Error', `Failed to save workspace tab session: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    persistWorkspaceTabs()
  }, [workspaceInfo.dir, openedFiles, activeFile])

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

    const state = createEditorState('')

    const view = new EditorView({
      state,
      parent: editorRef.current,
    })

    viewRef.current = view

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
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (_: any, action: string) => {
      switch (action) {
        case 'quit':
          handleQuitWithConfirm()
          break
        case 'open':
          handleOpenWorkspaceWithConfirm()
          break
        case 'save':
          if (activeFile && modifiedFiles.has(activeFile)) saveCurrentFile()
          break
        case 'saveAll':
          if (modifiedFiles.size > 0) saveAllFiles()
          break
        case 'close':
          if (activeFile) closeTab(activeFile)
          break
      }
    }

    const unsubscribe = (window as any).electron.onShortcut(handler)
    return () => {
      if (typeof unsubscribe === 'function') {
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
        console.error('Failed to load workspace datapacks:', error)
        await dialog.showAlert('Error', `Failed to load workspace datapacks: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    loadWorkspaceDatapacks()
  }, [workspaceInfo.dir])

  const fileNameCounts = openedFiles.reduce((counts, file) => {
    counts.set(file.fileName, (counts.get(file.fileName) ?? 0) + 1)
    return counts
  }, new Map<string, number>())

  const getDuplicateTabFolderLabel = (file: OpenedFile): string | null => {
    if ((fileNameCounts.get(file.fileName) ?? 0) < 2) return null

    const pathSegments = file.relativePath.split('/').filter(Boolean)
    const parentFolder = pathSegments.length > 1
      ? pathSegments[pathSegments.length - 2]
      : file.datapackDir.split(/[\\/]/).filter(Boolean).pop() || ''

    if (!parentFolder) return null
    return `../${parentFolder}`
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

  const registerTabElement = (fileKey: string, element: HTMLDivElement | null) => {
    if (element) {
      tabElementRefs.current.set(fileKey, element)
      return
    }

    tabElementRefs.current.delete(fileKey)
  }

  const handleTabRightClick = (event: React.MouseEvent, fileKey: string) => {
    setTabContextFileKey(fileKey)
    tabContextMenu.openContextMenu(event)
  }

  const getOpenedFileKeys = () =>
    openedFiles.map((file) => createFileKey(file.datapackDir, file.relativePath))

  const closeTabsSequentially = async (fileKeys: string[]) => {
    for (const fileKey of fileKeys) {
      await closeTab(fileKey)
    }
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
    const fullPath = `${datapackDir}/${relativePath}`.replace(/\//g, '\\')
    try {
      await navigator.clipboard.writeText(fullPath)
    } catch (error) {
      console.error('Failed to copy path:', error)
      await dialog.showAlert('Error', `Failed to copy path: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const copyTabRelativePath = async (fileKey: string) => {
    const { relativePath } = parseFileKey(fileKey)
    try {
      await navigator.clipboard.writeText(relativePath)
    } catch (error) {
      console.error('Failed to copy relative path:', error)
      await dialog.showAlert('Error', `Failed to copy relative path: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const revealInFileExplorer = async (fileKey: string) => {
    const { datapackDir, relativePath } = parseFileKey(fileKey)
    const fullPath = `${datapackDir}/${relativePath}`.replace(/\//g, '\\')
    try {
      await (window as any).electron.revealInFileExplorer(fullPath)
    } catch (error) {
      console.error('Failed to reveal in file explorer:', error)
      await dialog.showAlert('Error', `Failed to reveal file in explorer: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const openedFileKeys = getOpenedFileKeys()
  const contextTabIndex = tabContextFileKey ? openedFileKeys.indexOf(tabContextFileKey) : -1
  const hasTabsToRight = contextTabIndex >= 0 && contextTabIndex < openedFileKeys.length - 1
  const hasOtherTabs = contextTabIndex >= 0 && openedFileKeys.length > 1
  const hasSavedTabs = openedFileKeys.some((fileKey) => !modifiedFiles.has(fileKey))
  const hasAnyOpenTabs = openedFileKeys.length > 0

  const tabContextItems: MenuItem[] = [
    {
      label: 'Close',
      disabled: !tabContextFileKey,
      onClick: () => {
        if (!tabContextFileKey) return
        void closeTab(tabContextFileKey)
      },
      shortcut: 'Ctrl+W',
    },
    {
      label: 'Close Others',
      disabled: !hasOtherTabs,
      onClick: () => {
        if (!tabContextFileKey) return
        void closeOtherTabs(tabContextFileKey)
      },
    },
    {
      label: 'Close to the Right',
      disabled: !hasTabsToRight,
      onClick: () => {
        if (!tabContextFileKey) return
        void closeTabsToTheRight(tabContextFileKey)
      },
    },
    {
      label: 'Close Saved',
      disabled: !hasSavedTabs,
      onClick: () => {
        void closeSavedTabs()
      },
    },
    {
      label: 'Close All',
      disabled: !hasAnyOpenTabs,
      onClick: () => {
        void closeAllTabs()
      },
    },
    {},
    {
      label: 'Copy Path',
      disabled: !tabContextFileKey,
      onClick: () => {
        if (!tabContextFileKey) return
        void copyTabPath(tabContextFileKey)
      },
    },
    {
      label: 'Copy Relative Path',
      disabled: !tabContextFileKey,
      onClick: () => {
        if (!tabContextFileKey) return
        void copyTabRelativePath(tabContextFileKey)
      },
    },
    {},
    {
      label: 'Reveal in File Explorer',
      disabled: !tabContextFileKey,
      onClick: () => {
        if (!tabContextFileKey) return
        void revealInFileExplorer(tabContextFileKey)
      },
    }
  ]

  useEffect(() => {
    if (!activeFile) return

    const animationFrameId = window.requestAnimationFrame(() => {
      scrollTabIntoView(activeFile, 'smooth')
    })

    return () => {
      window.cancelAnimationFrame(animationFrameId)
    }
  }, [activeFile, openedFiles])

  return (
    <div className="w-full h-full flex flex-col select-none">

      {/* Title Bar */}
      <div className="flex flex-row h-[36px] bg-codemirror-700 text-sm text-codemirror-100 border-b border-codemirror-600" style={{ WebkitAppRegion: 'drag' } as any}>

        {/* App Icon */}
        <div className="px-4 py-2 font-bold">
          <img src={iconPath} alt="MCFunction++" style={{ height: '20px', width: '20px' }} />
        </div>
        
        {/* Title Bar Buttons */}
        <div className="flex flex-row flex-1" style={{ WebkitAppRegion: 'no-drag' } as any}>

          <DropdownMenu 
            label="App"
            items={[
              { label: 'Preferences', onClick: undefined, disabled: true },
              {},
              { label: 'Report Bug', onClick: undefined, disabled: true },
              {},
              { label: 'Website', onClick: undefined, disabled: true },
              { label: 'Help', onClick: undefined, disabled: true },
              { label: 'Credits', onClick: undefined, disabled: true },
              {},
              { label: 'Exit', shortcut: 'Ctrl+Q', onClick: handleQuitWithConfirm }
            ] as MenuItem[]}
            isOpen={isHeaderMenuOneOpen}
            setIsOpen={setIsHeaderMenuOneOpen}
            disabled={dialog.isOpen}
          />

          <DropdownMenu 
            label="Workspace"
            items={[
              { label: 'New Workspace', onClick: handleNewWorkspaceWithConfirm },
              { label: 'Open Workspace', shortcut: 'Ctrl+O', onClick: handleOpenWorkspaceWithConfirm },
              { label: 'Open Default Workspace', onClick: handleOpenDefaultWorkspaceWithConfirm },
              { label: 'Save Workspace', onClick: handleSaveWorkspace },
              { label: 'Save Workspace As', onClick: handleSaveWorkspaceAs },
              {},
              { label: 'Add Existing Datapack', onClick: handleAddDatapack },
              {
                label: 'Remove Datapack',
                children: datapacks.length > 0
                  ? datapacks.map((datapack) => ({
                      label: `${datapack.displayName}${datapack.packVersion ? ` (v${datapack.packVersion})` : ''}`,
                      onClick: () => handleRemoveDatapack(datapack.dir)
                    }))
                  : [{ label: 'No datapacks loaded', disabled: true }]
              }
            ] as MenuItem[]}
            isOpen={isHeaderMenuTwoOpen}
            setIsOpen={setIsHeaderMenuTwoOpen}
            disabled={dialog.isOpen}
          />

          <DropdownMenu 
            label="Editor"
            items={[
              { label: 'Close', shortcut: 'Ctrl+W', onClick: () => activeFile && closeTab(activeFile) },
              { label: 'Save', shortcut: 'Ctrl+S', onClick: saveCurrentFile, disabled: !activeFile || !modifiedFiles.has(activeFile) },
              { label: 'Save All', shortcut: 'Ctrl+Shift+S', onClick: saveAllFiles, disabled: modifiedFiles.size === 0 },
              {},
              { label: 'Auto-Save', toggleable: true, toggled: isAutoSaveEnabled, onToggle: toggleAutoSave },
              { label: 'Word Wrap', onClick: undefined, disabled: true }
            ] as MenuItem[]}
            isOpen={isHeaderMenuThreeOpen}
            setIsOpen={setIsHeaderMenuThreeOpen}
            disabled={dialog.isOpen}
          />

          <DropdownMenu 
            label="Panels"
            items={[
              { label: 'Explorer', onClick: undefined, disabled: true },
              { label: 'Preferences', onClick: undefined, disabled: true }
            ] as MenuItem[]}
            isOpen={isHeaderMenuFourOpen}
            setIsOpen={setIsHeaderMenuFourOpen}
            disabled={dialog.isOpen}
          />

          <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as any}></div>
          
          {/* Window Control Buttons */}
          <div
            onClick={() => (window as any).electron.minimize()} 
            className="header-button-right pt-2.5 pb-2 codicon codicon-chrome-minimize"
          />
          <div
            onClick={() => (window as any).electron.toggleFullscreen()}
            className={`header-button-right pt-2.5 pb-2 codicon ${isFullScreen ? 'codicon-chrome-restore' : 'codicon-chrome-maximize'}`}
          />
          <div
            onClick={handleQuitWithConfirm}
            className="header-button-right hover:bg-rose-600 pt-2.5 pb-2 codicon codicon-chrome-close"
          />

        </div>
      </div>

      {/* App */}
      <div className="flex flex-row flex-1 overflow-hidden flex-nowrap">

        {/* Left Panel */}
        <Panel
          width={leftPanel.width} position="left"
          title="Explorer"
          menuItems={[
            {label: 'Refresh', onClick: handleRefreshExplorer}
          ] as MenuItem[]}
        >
          {datapacks.length ? (
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
                  onFolderCreated={handleRefreshExplorer}
                  onSelect={(pathKey, isFile) => handleExplorerSelect(datapack.dir, pathKey, isFile)}
                  onFileRenamed={(oldRelativePath, newName) => handleFileRenamed(datapack.dir, oldRelativePath, newName)}
                  onFileDeleted={(relativePath) => handleFileDeleted(datapack.dir, relativePath)}
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
          )}
        </Panel>

        {/* Left Panel Resize Handle */}
        <ResizeHandle onMouseDown={leftPanel.handleMouseDown} />

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
                return (
                  <div
                    key={fileKey}
                    ref={(element) => registerTabElement(fileKey, element)}
                    onContextMenu={(event) => handleTabRightClick(event, fileKey)}
                    onClick={() => {
                      openFile(fileKey)
                    }}
                    className={`
                      flex items-center gap-2 px-2 py-1
                      border-r border-codemirror-600
                      whitespace-nowrap
                      cursor-pointer
                      ${isActive
                        ? 'bg-codemirror-default text-codemirror-100'
                        : 'hover:bg-codemirror-highlight text-codemirror-300'
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
                      <div className={`codicon codicon-circle-filled text-amber-400`}/>
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
                )
              })}
            </div>

            {/* CodeMirror Editor */}
            <div className="flex-1 min-h-0 overflow-auto" ref={editorRef} />

          </div>

          {openedFiles.length === 0 && (<>
            <div className="absolute inset-0 flex-1 bg-codemirror-default" />
            <div className="absolute inset-0 flex items-center justify-center select-none pointer-events-none">
              <img src={iconPath} alt="MCFunction++"
                style={{ height: '150px', width: '150px', opacity: 0.05 }} />
            </div>
          </>)}

        </div>

        {/* Right Panel Resize Handle */}
        <ResizeHandle onMouseDown={rightPanel.handleMouseDown} />
        
        {/* Right Panel */}
        <Panel width={rightPanel.width} position="right" title="Preferences">
          {
            workspaceInfo.dir ? (
              <div className="text-sm text-codemirror-300">
                <div className="font-mono break-words">{workspaceInfo.dir}</div>
              </div>
            ) : (<>
              <div className="text-sm text-codemirror-300">No folder selected</div>
            </>)
          }
        </Panel>

      </div>

      {/* Footer */}
      <div className="flex flex-row items-center h-[30px] bg-codemirror-700 text-codemirror-100 px-2 py-1 border-t border-codemirror-600">
        <div className="text-sm">Made by touchportyl</div>
      </div>

      {/* File Tab Floating Context Menu */}
      <ContextMenu
        items={tabContextItems}
        x={tabContextMenu.position.x}
        y={tabContextMenu.position.y}
        isOpen={tabContextMenu.isOpen}
        onClose={tabContextMenu.closeContextMenu}
      />

      {/* Dialog */}
      {dialog.dialogConfig && (
        <Dialog
          {...dialog.dialogConfig}
          isOpen={dialog.isOpen}
          onClose={dialog.closeDialog}
        />
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

const rootElement = document.getElementById('root') as HTMLElement
const root = ReactDOM.createRoot(rootElement)

root.render(<App />)