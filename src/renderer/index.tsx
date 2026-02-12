import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'

// Importing basic setup for CodeMirror
// todo: replace with custom setup later
import { basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import './index.css'

const MIN_PANEL_WIDTH = 150
const MAX_PANEL_WIDTH = 600

function CodeEditor() {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [leftPanelWidth, setLeftPanelWidth] = useState(250)
  const isDraggingRef = useRef(false)

  useEffect(() => {
    if (!editorRef.current) return

    const state = EditorState.create({
      doc: "// Welcome to CodeMirror!\nconsole.log('Hello, MCFunction++!');",
      extensions: [
        basicSetup,
        keymap.of([indentWithTab]),
        javascript()
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

  const handleMouseDown = () => {
    isDraggingRef.current = true
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return

      const newWidth = e.clientX
      if (newWidth >= MIN_PANEL_WIDTH && newWidth <= MAX_PANEL_WIDTH) {
        setLeftPanelWidth(newWidth)
      }
    }

    const handleMouseUp = () => {
      isDraggingRef.current = false
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  return (
    <div className="w-full h-full flex flex-col">
      {/* Header */}
      <div className="bg-gray-200 text-gray-900 p-4 border-b border-gray-300">
        <h1 className="text-xl font-bold">MCFunction++ Editor</h1>
      </div>
      {/* Main Panel */}
      <div className="flex flex-row flex-1 overflow-hidden bg-gray-50">
        {/* Left Panel */}
        <div
          style={{ width: leftPanelWidth }}
          className="bg-gray-100 border-r border-gray-300 overflow-auto"
        >
          <div className="p-4">
            <h2 className="font-semibold text-gray-900 mb-4">Files</h2>
            <div className="text-sm text-gray-600">Panel content here</div>
          </div>
        </div>

        {/* Resize Handle */}
        <div
          onMouseDown={handleMouseDown}
          className="w-1 bg-gray-300 hover:bg-blue-500 cursor-col-resize transition-colors"
        ></div>

        {/* Editor Panel */}
        <div className="flex-1 overflow-auto bg-gray-50" ref={editorRef}></div>
      </div>
      {/* Footer Panel */}
      <div className="bg-gray-200 text-gray-900 p-4 border-t border-gray-300">
        <div className="text-sm">Footer content here</div>
      </div>
    </div>
  )
}

function App() {
  return (
    <div className="h-screen bg-gray-100">
      <CodeEditor />
    </div>
  )
}

const rootElement = document.getElementById('root') as HTMLElement
const root = ReactDOM.createRoot(rootElement)

root.render(<App />)