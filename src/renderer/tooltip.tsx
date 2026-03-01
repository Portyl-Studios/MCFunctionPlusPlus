import React from 'react'
import { createPortal } from 'react-dom'

interface TooltipProps {
  content: React.ReactNode
  children: React.ReactNode
  disabled?: boolean
  offset?: number
}

type TooltipPosition = {
  x: number
  y: number
}

const TOOLTIP_MOUSE_IDLE_DELAY_MS = 300

export function Tooltip({ content, children, disabled = false, offset = 8 }: TooltipProps) {
  const triggerRef = React.useRef<HTMLElement | null>(null)
  const tooltipRef = React.useRef<HTMLDivElement | null>(null)
  const hoverTimerRef = React.useRef<number | null>(null)

  const [isOpen, setIsOpen] = React.useState(false)
  const [position, setPosition] = React.useState<TooltipPosition>({ x: 0, y: 0 })
  const [isPositionReady, setIsPositionReady] = React.useState(false)
  const [cursorAnchor, setCursorAnchor] = React.useState<TooltipPosition | null>(null)

  const shouldRender = isOpen && !disabled && !!content

  const clearHoverTimer = React.useCallback(() => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
  }, [])

  const closeTooltip = React.useCallback(() => {
    clearHoverTimer()
    setIsOpen(false)
  }, [clearHoverTimer])

  const scheduleTooltipAtCursor = React.useCallback((x: number, y: number) => {
    if (disabled || !content || isOpen) return

    clearHoverTimer()

    hoverTimerRef.current = window.setTimeout(() => {
      setCursorAnchor({ x, y })
      setIsPositionReady(false)
      setIsOpen(true)
      hoverTimerRef.current = null
    }, TOOLTIP_MOUSE_IDLE_DELAY_MS)
  }, [clearHoverTimer, content, disabled, isOpen])

  React.useEffect(() => {
    return () => {
      clearHoverTimer()
    }
  }, [clearHoverTimer])

  React.useEffect(() => {
    if (!shouldRender || !triggerRef.current || !tooltipRef.current) return

    const repositionTooltip = () => {
      if (!triggerRef.current || !tooltipRef.current) return

      const margin = 8
      const triggerRect = triggerRef.current.getBoundingClientRect()
      const tooltipRect = tooltipRef.current.getBoundingClientRect()

      let nextX = cursorAnchor ? cursorAnchor.x + offset : triggerRect.left
      let nextY = cursorAnchor ? cursorAnchor.y + offset : triggerRect.bottom + offset

      const bottomOverflow = nextY + tooltipRect.height > window.innerHeight - margin
      if (bottomOverflow) {
        nextY = cursorAnchor
          ? cursorAnchor.y - tooltipRect.height - offset
          : triggerRect.top - tooltipRect.height - offset
      }

      const minX = margin
      const maxX = Math.max(margin, window.innerWidth - tooltipRect.width - margin)
      const minY = margin
      const maxY = Math.max(margin, window.innerHeight - tooltipRect.height - margin)

      nextX = Math.min(Math.max(nextX, minX), maxX)
      nextY = Math.min(Math.max(nextY, minY), maxY)

      setPosition({ x: nextX, y: nextY })
      setIsPositionReady(true)
    }

    repositionTooltip()
    window.addEventListener('resize', repositionTooltip)
    return () => {
      window.removeEventListener('resize', repositionTooltip)
    }
  }, [shouldRender, offset, content, cursorAnchor])

  React.useEffect(() => {
    if (!shouldRender) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeTooltip()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [shouldRender, closeTooltip])

  return (
    <>
      <div
        ref={(node) => {
          triggerRef.current = node
        }}
        style={{ display: 'contents' }}
        onMouseEnter={() => {
          setCursorAnchor(null)
        }}
        onMouseMove={(event) => {
          if (!disabled && content) {
            scheduleTooltipAtCursor(event.clientX, event.clientY)
          }
        }}
        onMouseLeave={() => {
          setCursorAnchor(null)
          closeTooltip()
        }}
        onFocus={() => {
          if (!disabled && content) {
            clearHoverTimer()
            setCursorAnchor(null)
            setIsPositionReady(false)
            setIsOpen(true)
          }
        }}
        onBlur={closeTooltip}
      >
        {children}
      </div>
      {shouldRender && createPortal(
        <div
          ref={tooltipRef}
          className="fixed menu-layer bg-codemirror-600 border border-codemirror-400 rounded shadow-lg px-2 py-1 text-sm text-codemirror-100 max-w-105 whitespace-pre-wrap wrap-break-word pointer-events-none z-50"
          style={{
            left: position.x,
            top: position.y,
            visibility: isPositionReady ? 'visible' : 'hidden',
          }}
          role="tooltip"
        >
          {content}
        </div>,
        document.body
      )}
    </>
  )
}
