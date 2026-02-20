import React, { ReactNode, useCallback, useEffect, useRef, useState } from "react"

export const MIN_SECTION_WIDTH = 150
export const MAX_SECTION_WIDTH = 600
export const MIN_SECTION_HEIGHT = 100
export const MAX_SECTION_HEIGHT = 600

interface SectionProps {
  width?: number
  height?: number
  position?: "left" | "right" | "bottom"
  children: ReactNode
}

export function Section({ width, height, position = "left", children }: SectionProps) {
  const borderClass = position === "left" ? "border-r" : position === "right" ? "border-l" : "border-t"

  return (
    <div
      style={{ ...(width && { width }), ...(height && { height }) }}
      className={`${borderClass} border-codemirror-600 flex flex-col bg-codemirror-700`}
    >
      <div className="flex-1 overflow-auto scrollbar-padding">
        <div className="m-4">
          {children}
        </div>
      </div>
    </div>
  )
}

interface ResizeHandleProps {
  onMouseDown: () => void
  orientation?: "horizontal" | "vertical"
}

export function ResizeHandle({ onMouseDown, orientation = "horizontal" }: ResizeHandleProps) {
  const [isDragging, setIsDragging] = useState(false)
  const isVertical = orientation === "vertical"

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    onMouseDown()

    const handleMouseUp = () => {
      setIsDragging(false)
      document.removeEventListener("mouseup", handleMouseUp)
    }

    document.addEventListener("mouseup", handleMouseUp)
  }

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`
        ${isVertical ? "h-1 cursor-row-resize" : "w-1 cursor-col-resize"}
        transition-colors
        ${isDragging ? "bg-codemirror-select" : "bg-codemirror-700 hover:bg-codemirror-highlight"}
      `}
    ></div>
  )
}

interface UseResizableSectionProps {
  initialWidth?: number
  initialHeight?: number
  position?: "left" | "right" | "bottom"
  width?: number
  height?: number
  onWidthChange?: (width: number) => void
  onHeightChange?: (height: number) => void
}

export function useResizableSection({ 
  initialWidth = 350, 
  initialHeight = 250, 
  position = "left",
  width: controlledWidth,
  height: controlledHeight,
  onWidthChange,
  onHeightChange
}: UseResizableSectionProps) {
  const [internalWidth, setInternalWidth] = useState(initialWidth)
  const [internalHeight, setInternalHeight] = useState(initialHeight)
  const isDraggingRef = useRef(false)

  // Use controlled values if provided, otherwise use internal state
  const width = controlledWidth !== undefined ? controlledWidth : internalWidth
  const height = controlledHeight !== undefined ? controlledHeight : internalHeight
  const setWidth = onWidthChange || setInternalWidth
  const setHeight = onHeightChange || setInternalHeight

  const handleMouseDown = () => {
    isDraggingRef.current = true
  }

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingRef.current) return

    // Hardcoded fix to account for the cursor being
    // slightly off the actual edge
    const fixLeftAlignOffset = -2
    const fixRightAlignOffset = -2
    const fixBottomAlignOffset = -32

    if (position === "bottom") {
      const newHeight = window.innerHeight - e.clientY + fixBottomAlignOffset
      if (newHeight >= MIN_SECTION_HEIGHT && newHeight <= MAX_SECTION_HEIGHT) {
        setHeight(newHeight)
      }
    } else {
      const newWidth = position === "left" 
        ? e.clientX + fixLeftAlignOffset
        : window.innerWidth - e.clientX + fixRightAlignOffset
      
      if (newWidth >= MIN_SECTION_WIDTH && newWidth <= MAX_SECTION_WIDTH) {
        setWidth(newWidth)
      }
    }
  }, [position, setWidth, setHeight])

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false
  }, [])

  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)

    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [handleMouseMove, handleMouseUp])

  return { width, height, handleMouseDown }
}

