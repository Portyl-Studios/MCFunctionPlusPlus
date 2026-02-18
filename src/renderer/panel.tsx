import React, { ReactNode, useEffect, useRef, useState } from 'react'

export const MIN_PANEL_WIDTH = 150
export const MAX_PANEL_WIDTH = 600

interface PanelProps {
  width: number
  position: 'left' | 'right'
  title: string
  children: ReactNode
}

export function Panel({ width, position, title, children }: PanelProps) {
  const baseClasses = "bg-codemirror-700 overflow-auto text-nowrap"
  const borderClass = position === 'left' ? 'border-r' : 'border-l'
  
  return (
    <div
      style={{ width }}
      className={`${baseClasses} ${borderClass} border-codemirror-600`}
    >
      <div className="p-2">
        <div className="font-semibold border-b border-codemirror-600 text-codemirror-100 uppercase mb-2 pb-2">{title}</div>
        {children}
      </div>
    </div>
  )
}

interface ResizeHandleProps {
  onMouseDown: () => void
}

export function ResizeHandle({ onMouseDown }: ResizeHandleProps) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="w-1 bg-codemirror-700 hover:bg-codemirror-300 cursor-col-resize transition-colors"
    ></div>
  )
}

interface UseResizablePanelProps {
  initialWidth: number
  position: 'left' | 'right'
}

export function useResizablePanel({ initialWidth, position }: UseResizablePanelProps) {
  const [width, setWidth] = useState(initialWidth)
  const isDraggingRef = useRef(false)

  const handleMouseDown = () => {
    isDraggingRef.current = true
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return

      const newWidth = position === 'left' 
        ? e.clientX 
        : window.innerWidth - e.clientX
      
      if (newWidth >= MIN_PANEL_WIDTH && newWidth <= MAX_PANEL_WIDTH) {
        setWidth(newWidth)
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
  }, [position])

  return { width, handleMouseDown }
}
