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
import { FileTree } from './filetree'
import { DropdownMenu, type MenuItem } from './dropdownmenu'
import { useWorkspace } from './use-workspace'
import iconPath from '../../assets/icon.png'
import { DatapackTree } from './datapacktree'

function CodeEditor() {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const leftPanel = useResizablePanel({ initialWidth: 250, position: 'left' })
  const rightPanel = useResizablePanel({ initialWidth: 350, position: 'right' })
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [filePaths, setFilePaths] = useState<string[]>([])
  const [isFileMenuOpen, setIsFileMenuOpen] = useState(false)
  const [isFullScreen, setIsFullScreen] = useState(false)
  const { workspaceInfo, handleOpenWorkspace, handleSaveWorkspace, handleSaveWorkspaceAs } = useWorkspace()

  const handlePickFolder = async () => {
    const folder = await (window as any).electron.pickFolder()
    if (folder) {
      setSelectedFolder(folder)
      try {
        const files = await (window as any).electron.listFiles(folder)
        setFilePaths(Array.isArray(files) ? files : [])
      } catch {
        setFilePaths([])
      }
    }
  }

  useEffect(() => {
    if (!editorRef.current) return

    const state = EditorState.create({
      doc: "# Welcome to CodeMirror!\n",
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
    // Get initial fullscreen state
    ;(window as any).electron.isFullScreen().then(setIsFullScreen)

    // Listen for fullscreen changes
    ;(window as any).electron.onFullscreenChange((isFullScreen: boolean) => {
      setIsFullScreen(isFullScreen)
    })
  }, [])

  const relativePaths = React.useMemo(() => {
    if (!selectedFolder) return []

    const base = selectedFolder.replace(/\\/g, '/').replace(/\/+$/, '')
    return filePaths.map((rawPath) => {
      const normalized = rawPath.replace(/\\/g, '/')
      const baseWithSlash = `${base}/`

      if (normalized.toLowerCase().startsWith(baseWithSlash.toLowerCase())) {
        return normalized.slice(baseWithSlash.length)
      }

      return normalized
    })
  }, [filePaths, selectedFolder])

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
              { label: 'Open Folder', onClick: handlePickFolder },
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
        <Panel width={leftPanel.width} position="left" title="Explorer">
          {
            selectedFolder ? (
              <DatapackTree 
                paths={relativePaths} 
                folderName={selectedFolder.split(/[\\/]/).pop() || 'datapack'}
                className="mt-2"
              />
            ) : (<>
              <div className="text-sm text-codemirror-300">No folder selected</div>
              <div className="flex flex-col items-center m-4 button" onClick={handlePickFolder}>
                <div className="text-sm text-codemirror-100">Open Folder</div>
              </div>
            </>)
          }
        </Panel>

        {/* Left Panel Resize Handle */}
        <ResizeHandle onMouseDown={leftPanel.handleMouseDown} />

        {/* Editor Panel */}
        <div className="flex-1 overflow-auto bg-codemirror-default" ref={editorRef}></div>

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