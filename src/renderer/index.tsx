import React, { useEffect, useRef } from 'react'
import ReactDOM from 'react-dom/client'

// Importing basic setup for CodeMirror
// todo: replace with custom setup later
import { basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { javascript } from '@codemirror/lang-javascript'
import './index.css'

function CodeEditor() {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    if (!editorRef.current) return

    const state = EditorState.create({
      doc: "// Welcome to CodeMirror!\nconsole.log('Hello, MCFunction++!');",
      extensions: [basicSetup, javascript()],
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

  return (
    <div className="w-full h-full flex flex-col">
      <div className="bg-gray-200 text-gray-900 p-4 border-b border-gray-300">
        <h1 className="text-xl font-bold">MCFunction++ Editor</h1>
      </div>
      <div className="flex-1 overflow-auto bg-gray-50" ref={editorRef}></div>
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