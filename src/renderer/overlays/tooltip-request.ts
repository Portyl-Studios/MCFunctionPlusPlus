import React from 'react'

type TooltipPosition = {
  x: number
  y: number
}

interface UseTooltipRequestOptions {
  content: React.ReactNode
  disabled?: boolean
  offset?: number
}

const TOOLTIP_MOUSE_IDLE_DELAY_MS = 300
const TOOLTIP_POINTER_FOCUS_SUPPRESS_MS = 250

export function useTooltipRequest({ content, disabled = false, offset = 8 }: UseTooltipRequestOptions) {
  const triggerRef = React.useRef<HTMLElement | null>(null)
  const tooltipRef = React.useRef<HTMLDivElement | null>(null)
  const hoverTimerRef = React.useRef<number | null>(null)
  const suppressFocusUntilRef = React.useRef(0)

  const [isOpen, setIsOpen] = React.useState(false)
  const [position, setPosition] = React.useState<TooltipPosition>({ x: 0, y: 0 })
  const [isPositionReady, setIsPositionReady] = React.useState(false)
  const [cursorAnchor, setCursorAnchor] = React.useState<TooltipPosition | null>(null)

  const hasReadyData = !disabled && !!content
  const shouldRender = isOpen && hasReadyData
  const isVisible = shouldRender && isPositionReady

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
    if (!hasReadyData || isOpen) return

    clearHoverTimer()

    hoverTimerRef.current = window.setTimeout(() => {
      setCursorAnchor({ x, y })
      setIsPositionReady(false)
      setIsOpen(true)
      hoverTimerRef.current = null
    }, TOOLTIP_MOUSE_IDLE_DELAY_MS)
  }, [clearHoverTimer, hasReadyData, isOpen])

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

    const handleGlobalPointerDown = () => {
      suppressFocusUntilRef.current = Date.now() + TOOLTIP_POINTER_FOCUS_SUPPRESS_MS
      closeTooltip()
    }

    // Capture phase ensures stale tooltips close even if downstream click handlers block bubbling.
    document.addEventListener('pointerdown', handleGlobalPointerDown, true)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('pointerdown', handleGlobalPointerDown, true)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [shouldRender, closeTooltip])

  const setTriggerNode = (node: HTMLElement | null) => {
    triggerRef.current = node
  }

  const handleMouseEnter = () => {
    setCursorAnchor(null)
  }

  const handleMouseMove = (event: React.MouseEvent) => {
    if (hasReadyData) {
      scheduleTooltipAtCursor(event.clientX, event.clientY)
    }
  }

  const handleMouseLeave = () => {
    setCursorAnchor(null)
    closeTooltip()
  }

  const handleFocus = () => {
    if (Date.now() < suppressFocusUntilRef.current) {
      return
    }

    if (hasReadyData) {
      clearHoverTimer()
      setCursorAnchor(null)
      setIsPositionReady(false)
      setIsOpen(true)
    }
  }

  return {
    tooltipRef,
    setTriggerNode,
    hasReadyData,
    shouldRender,
    isVisible,
    position,
    isPositionReady,
    handleMouseEnter,
    handleMouseMove,
    handleMouseLeave,
    handleFocus,
    closeTooltip,
  }
}
