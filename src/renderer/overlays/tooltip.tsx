import React from 'react'
import { createPortal } from 'react-dom'
import { useTooltipRequest } from './tooltip-request'

interface TooltipProps {
  content: React.ReactNode
  children: React.ReactNode
  disabled?: boolean
  offset?: number
}

export function Tooltip({ content, children, disabled = false, offset = 8 }: TooltipProps) {
  const {
    tooltipRef,
    setTriggerNode,
    shouldRender,
    position,
    isVisible,
    handleMouseEnter,
    handleMouseMove,
    handleMouseLeave,
    handleFocus,
    closeTooltip,
  } = useTooltipRequest({ content, disabled, offset })

  return (
    <>
      <div
        ref={setTriggerNode}
        style={{ display: 'contents' }}
        onMouseEnter={handleMouseEnter}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onFocus={handleFocus}
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
            visibility: isVisible ? 'visible' : 'hidden',
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
