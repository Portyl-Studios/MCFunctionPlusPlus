import React, { useEffect, useState, useRef } from 'react'
import ReactDOM from 'react-dom'
import { MenuItems, type MenuItem } from './menuitem'
import { defocusActiveElement } from './utils'

export type { MenuItem }

interface DropdownMenuProps {
  label: React.ReactNode
  items: MenuItem[]
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  className?: string
  buttonClassName?: string
  disabled?: boolean
  horizontalAlign?: 'start' | 'center' | 'end'
}

export function DropdownMenu({ label, items, isOpen, setIsOpen, className, buttonClassName, disabled, horizontalAlign = 'start' }: DropdownMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuLayerRef = useRef<HTMLDivElement>(null)
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 })
  const [isPositionReady, setIsPositionReady] = useState(false)
  const buttonClass = buttonClassName ?? 'header-button'
  const disabledClass = disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''

  useEffect(() => {
    if (!isOpen) return

    defocusActiveElement()
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return

    setIsPositionReady(false)

    const positionMenu = () => {
      const triggerElement = triggerRef.current
      const menuElement = menuLayerRef.current
      if (!triggerElement || !menuElement) return

      const margin = 8
      const gap = 8
      const triggerRect = triggerElement.getBoundingClientRect()
      const menuRect = menuElement.getBoundingClientRect()

      let left = triggerRect.left + 4
      if (horizontalAlign === 'center') {
        left = triggerRect.left + (triggerRect.width - menuRect.width) / 2
      } else if (horizontalAlign === 'end') {
        left = triggerRect.right - menuRect.width - 4
      }

      if (left + menuRect.width > window.innerWidth - margin) {
        left = window.innerWidth - menuRect.width - margin
      }
      left = Math.min(Math.max(left, margin), Math.max(margin, window.innerWidth - menuRect.width - margin))

      let top = triggerRect.bottom + gap
      if (top + menuRect.height > window.innerHeight - margin) {
        top = triggerRect.top - menuRect.height - gap
      }
      top = Math.min(Math.max(top, margin), Math.max(margin, window.innerHeight - menuRect.height - margin))

      setMenuPosition({ top, left })
      setIsPositionReady(true)
    }

    // Wait for portal content to mount before measuring.
    const rafId = window.requestAnimationFrame(positionMenu)
    window.addEventListener('resize', positionMenu)
    window.addEventListener('scroll', positionMenu, true)
    return () => {
      window.cancelAnimationFrame(rafId)
      window.removeEventListener('resize', positionMenu)
      window.removeEventListener('scroll', positionMenu, true)
    }
  }, [isOpen, horizontalAlign])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      const clickedTrigger = menuRef.current?.contains(target) ?? false
      const clickedMenuLayer = menuLayerRef.current?.contains(target) ?? false
      if (!clickedTrigger && !clickedMenuLayer) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
  }, [isOpen, setIsOpen])

  return (
    <div ref={menuRef} className={`relative ${className ?? ''}`.trim()}>
      <div 
        ref={triggerRef}
        onClick={() => {
          if (disabled) return
          setIsOpen(!isOpen)
        }}
        className={`${buttonClass} ${disabledClass} ${isOpen ? 'bg-codemirror-500' : ''}`}
      >
        {label}
      </div>
      {isOpen && !disabled && ReactDOM.createPortal(
        <div
          ref={menuLayerRef}
          data-overlay-menu="true"
          className="fixed menu-layer"
          style={{
            top: menuPosition.top,
            left: menuPosition.left,
            visibility: isPositionReady ? 'visible' : 'hidden',
            zIndex: 9000,
          }}
        >
          <MenuItems items={items} maxItems={10} onItemClick={() => setIsOpen(false)} />
        </div>,
        document.body,
      )}
    </div>
  )
}
