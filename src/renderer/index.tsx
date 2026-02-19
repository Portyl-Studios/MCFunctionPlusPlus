import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'

// Importing basic setup for CodeMirror
// todo: replace with custom setup later
import { basicSetup } from 'codemirror'
import { EditorState, Annotation } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { json } from '@codemirror/lang-json'
import { oneDark } from '@codemirror/theme-one-dark'
import './index.css'
import { Panel, ResizeHandle, useResizablePanel } from './panel'
import { DropdownMenu, type MenuItem } from './dropdownmenu'
import { useWorkspace } from './use-workspace'
import iconPath from '../../assets/icon.png'
import { DatapackTree } from './datapacktree'
import { Dialog, useDialog } from './dialog'
import { getDirFromPath, toRelativePaths, createFileKey, parseFileKey } from './utils'

// Annotation to mark editor transactions that are programmatic content loads
// This prevents marking files as modified when we're just loading content from disk
const isLoadingContent = Annotation.define<boolean>()

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
  const [isAutoSaveEnabled, setIsAutoSaveEnabled] = useState(false)
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
    }
  }

  /**
   * Helper to clear all workspace state when changing workspaces
   */
  const clearWorkspaceState = () => {
    setOpenedFiles([])
    setActiveFile(null)
    setModifiedFiles(new Set())
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
      // Clear all files and modified set before changing workspace
      clearWorkspaceState()
      await handleOpenWorkspace()
    })
  }

  const handleNewWorkspaceWithConfirm = async () => {
    await handleWorkspaceChangeWithConfirm(async () => {
      // Clear all files and modified set before changing workspace
      clearWorkspaceState()
      await handleNewWorkspace()
    })
  }

  const handleOpenDefaultWorkspaceWithConfirm = async () => {
    await handleWorkspaceChangeWithConfirm(async () => {
      // Clear all files and modified set before changing workspace
      clearWorkspaceState()
      await handleOpenDefaultWorkspace()
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

  const openFile = async (fileKey: string | null) => {
    setActiveFile(fileKey)
    
    if (!fileKey) return
    
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
        return
      }
    }
    
    const view = viewRef.current
    if (!view) return
    // Mark this change with isLoadingContent annotation to prevent the update listener
    // from treating this programmatic change as a user edit
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: contents },
      annotations: [isLoadingContent.of(true)],
    })
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
        setOpenedFiles([...openedFiles, { datapackDir, relativePath: trimmedRelative, fileName, content }])
      } catch (error) {
        console.error('Failed to read file:', error)
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
      setModifiedFiles((prev) => {
        const next = new Set(prev)
        next.delete(fileKey)
        return next
      })

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
      const confirmed = await dialog.showConfirm('Close File?', `${fileName} has unsaved changes. Do you want to close it without saving?`)
      if (!confirmed) {
        return // User cancelled, don't close
      }
    }

    // Clear any pending autosave timer
    clearAutoSaveTimer(fileKey)

    // Find the index of the file being closed
    const closingIndex = openedFiles.findIndex((f) => createFileKey(f.datapackDir, f.relativePath) === fileKey)
    const updatedFiles = openedFiles.filter((f) => createFileKey(f.datapackDir, f.relativePath) !== fileKey)
    setOpenedFiles(updatedFiles)
    
    // Clear modified state for this file
    setModifiedFiles((prev) => {
      const next = new Set(prev)
      next.delete(fileKey)
      return next
    })
    
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

  useEffect(() => {
    isAutoSaveEnabledRef.current = isAutoSaveEnabled
  }, [isAutoSaveEnabled])

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

    const state = EditorState.create({
      doc: "",
      extensions: [
        oneDark,
        basicSetup,
        keymap.of(defaultKeymap),
        keymap.of([indentWithTab]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && activeFileRef.current) {
            // Skip marking as modified if this is a programmatic content load
            const isLoading = update.transactions.some(tr => tr.annotation(isLoadingContent))
            if (!isLoading) {
              const fileKey = activeFileRef.current
              const newContent = update.state.doc.toString()

              // Mark as modified
              setModifiedFiles((prev) => new Set(prev).add(fileKey))
              
              // Update cached content
              setOpenedFiles((prev) => 
                prev.map((f) => 
                  createFileKey(f.datapackDir, f.relativePath) === fileKey
                    ? { ...f, content: newContent }
                    : f
                )
              )

              // Schedule autosave after delay
              scheduleAutoSave(fileKey, newContent)
            }
          }
        }),
        json()
      ],
    })

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
      }
    }

    loadWorkspaceDatapacks()
  }, [workspaceInfo.dir])

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
              className="flex overflow-x-auto overflow-y-hidden bg-codemirror-700 border-b border-codemirror-600 scroll-smooth select-none"
            >
              {openedFiles.map((file, idx) => {
                const fileKey = createFileKey(file.datapackDir, file.relativePath)
                const isActive = activeFile === fileKey
                return (
                  <div
                    key={fileKey}
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