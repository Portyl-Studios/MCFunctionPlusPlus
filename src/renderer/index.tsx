import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'

// Importing basic setup for CodeMirror
// todo: replace with custom setup later
import { basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { json } from '@codemirror/lang-json'
import { oneDark } from '@codemirror/theme-one-dark'
import './index.css'
import { Panel, ResizeHandle, useResizablePanel } from './panel'
import { DropdownMenu, type MenuItem } from './dropdownmenu'
import { useWorkspace } from './use-workspace'
import iconPath from '../../assets/icon.png'
import { DatapackTree } from './datapacktree'

type DatapackEntry = {
  dir: string
  name: string
  paths: string[]
  id?: string
  displayName?: string
  packVersion?: string
}

function CodeEditor() {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const leftPanel = useResizablePanel({ initialWidth: 350, position: 'left' })
  const rightPanel = useResizablePanel({ initialWidth: 350, position: 'right' })
  const [datapacks, setDatapacks] = useState<DatapackEntry[]>([])
  const [isFileMenuOpen, setIsFileMenuOpen] = useState(false)
  const [isFullScreen, setIsFullScreen] = useState(false)
  const {
    workspaceInfo,
    handleOpenWorkspace,
    handleSaveWorkspace,
    handleSaveWorkspaceAs,
    handleGetDatapacks,
  } = useWorkspace()

  const getDirFromPath = (filePath: string) => {
    const lastSlash = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'))
    if (lastSlash === -1) return filePath
    return filePath.slice(0, lastSlash)
  }

  const toRelativePaths = (baseDir: string, rawPaths: string[]) => {
    const base = baseDir.replace(/\\/g, '/').replace(/\/+$/, '')
    return rawPaths.map((rawPath) => {
      const normalized = rawPath.replace(/\\/g, '/')
      const baseWithSlash = `${base}/`

      if (normalized.toLowerCase().startsWith(baseWithSlash.toLowerCase())) {
        return normalized.slice(baseWithSlash.length)
      }

      return normalized
    })
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
      alert(`Failed to add datapack: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
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

    try {
      const contents = await (window as any).electron.readFile(datapackDir, trimmedRelative)
      const view = viewRef.current
      if (!view) return
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: contents },
      })
    } catch (error) {
      console.error('Failed to read file:', error)
    }
  }

  useEffect(() => {
    if (!editorRef.current) return

    const state = EditorState.create({
      doc: "",
      extensions: [
        oneDark,
        basicSetup,
        keymap.of([indentWithTab]),
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
    }
  }, [])

  useEffect(() => {
    ;(window as any).electron.isFullScreen().then(setIsFullScreen)

    ;(window as any).electron.onFullscreenChange((isFullScreen: boolean) => {
      setIsFullScreen(isFullScreen)
    })
  }, [])

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

      {/* Header */}
      <div className="flex flex-row bg-codemirror-700 text-sm text-codemirror-100 border-b border-codemirror-600" style={{ WebkitAppRegion: 'drag' } as any}>
        <div className="px-4 py-2 font-bold">
          <img src={iconPath} alt="MCFunction++" style={{ height: '20px', width: '20px' }} />
        </div>
        
        {/* Buttons */}
        <div className="flex flex-row flex-1" style={{ WebkitAppRegion: 'no-drag' } as any}>

          <DropdownMenu 
            label="File"
            items={[
              { label: 'Add Existing Datapack', onClick: handleAddDatapack },
              {},
              { label: 'Open Workspace', onClick: handleOpenWorkspace },
              { label: 'Save Workspace', onClick: handleSaveWorkspace },
              { label: 'Save Workspace As', onClick: handleSaveWorkspaceAs },
              {},
              { label: 'Exit', onClick: () => (window as any).electron.quit() }
            ] as MenuItem[]}
            isOpen={isFileMenuOpen}
            setIsOpen={setIsFileMenuOpen}
          />

          <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as any}></div>

          <div
            onClick={() => (window as any).electron.minimize()} 
            className="header-button-right pt-2.5 pb-2 codicon codicon-chrome-minimize"
          />
          <div
            onClick={() => (window as any).electron.toggleFullscreen()}
            className={`header-button-right pt-2.5 pb-2 codicon ${isFullScreen ? 'codicon-chrome-restore' : 'codicon-chrome-maximize'}`}
          />
          <div
            onClick={() => (window as any).electron.quit()}
            className="header-button-right hover:bg-rose-600 pt-2.5 pb-2 codicon codicon-chrome-close"
          />
        </div>
      </div>

      {/* Main Panel */}
      <div className="flex flex-row flex-1 overflow-hidden">

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

        {/* Editor Panel */}
        <div className="flex-1 bg-codemirror-default">
          <div className="overflow-auto" ref={editorRef} />
        </div>

        {/* Right Panel Resize Handle */}
        <ResizeHandle onMouseDown={rightPanel.handleMouseDown} />
        
        {/* Right Panel */}
        <Panel width={rightPanel.width} position="right" title="Settings">
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

      {/* Footer Panel */}
      <div className="flex flex-row bg-codemirror-700 text-codemirror-100 px-2 py-1 border-t border-codemirror-600">
        <div className="text-sm">Made by touchportyl</div>
      </div>
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