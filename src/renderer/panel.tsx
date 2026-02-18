import React, { ReactNode, useEffect, useRef, useState } from 'react'
import { DropdownMenu, type MenuItem } from './dropdownmenu'

export const MIN_PANEL_WIDTH = 150
export const MAX_PANEL_WIDTH = 600

interface PanelProps {
  width: number
  position: 'left' | 'right'
  title: string
  children: ReactNode
  menuItems?: MenuItem[]
}

export function Panel({ width, position, title, children, menuItems = [] }: PanelProps) {
  const borderClass = position === 'left' ? 'border-r' : 'border-l'
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const hasMenuItems = menuItems.length > 0

  useEffect(() => {
    if (!hasMenuItems && isMenuOpen) {
      setIsMenuOpen(false)
    }
  }, [hasMenuItems, isMenuOpen])
  
  return (
    <div
      style={{ width }}
      className={`${borderClass} border-codemirror-600 flex flex-col bg-codemirror-700 text-nowrap`}
    >

      <div className="m-4 flex items-center justify-between flex-shrink-0">
        <div className="flex-1 font-semibold text-xs text-codemirror-100 uppercase tracking-wider">
          {title}
        </div>
        <div className="relative">
          <DropdownMenu
            label={<div className="codicon codicon-ellipsis text-codemirror-300 p-1" />}
            items={menuItems}
            isOpen={isMenuOpen}
            setIsOpen={setIsMenuOpen}
            buttonClassName="panel-menu-button"
            disabled={!hasMenuItems}
          />
        </div>
      </div>

      <div className="h-px bg-codemirror-600 flex-shrink-0"/>

      <div className="flex-1 overflow-auto scrollbar-padding">
        <div className="my-4">
          {children}
        </div>
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
