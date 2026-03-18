import React, { useEffect, useRef } from 'react'
import { MenuItems, type MenuItem } from '../menuitem'
import { defocusActiveElement } from '../utils'

interface ContextMenuProps {
  items: MenuItem[]
  x: number
  y: number
  isOpen: boolean
  onClose: () => void
}

export function ContextMenu({ items, x, y, isOpen, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = React.useState({ x, y })
  const [isPositionReady, setIsPositionReady] = React.useState(false)

  useEffect(() => {
    if (!isOpen) return

    defocusActiveElement()
    setPosition({ x, y })
    setIsPositionReady(false)
  }, [isOpen, x, y])

  useEffect(() => {
    if (!isOpen || !menuRef.current) return

    const clampPosition = () => {
      const menuElement = menuRef.current
      if (!menuElement) return

      const menuRect = menuElement.getBoundingClientRect()
      const margin = 8
      const maxX = Math.max(margin, window.innerWidth - menuRect.width - margin)
      const maxY = Math.max(margin, window.innerHeight - menuRect.height - margin)

      setPosition({
        x: Math.min(Math.max(x, margin), maxX),
        y: Math.min(Math.max(y, margin), maxY),
      })
      setIsPositionReady(true)
    }

    clampPosition()
    window.addEventListener('resize', clampPosition)
    return () => {
      window.removeEventListener('resize', clampPosition)
    }
  }, [isOpen, x, y, items])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose()
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleEscape)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
        document.removeEventListener('keydown', handleEscape)
      }
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      data-popup-menu="true"
      ref={menuRef}
      className="fixed menu-layer"
      style={{ top: position.y, left: position.x, visibility: isPositionReady ? 'visible' : 'hidden' }}
    >
      <MenuItems items={items} maxItems={10} onItemClick={onClose} />
    </div>
  )
}

interface UseContextMenuResult {
  isOpen: boolean
  position: { x: number; y: number }
  openContextMenu: (event: React.MouseEvent) => void
  openContextMenuAt: (x: number, y: number) => void
  closeContextMenu: () => void
}

export function useContextMenu(): UseContextMenuResult {
  const [isOpen, setIsOpen] = React.useState(false)
  const [position, setPosition] = React.useState({ x: 0, y: 0 })

  const openContextMenu = (event: React.MouseEvent) => {
    event.preventDefault()
    setPosition({ x: event.clientX, y: event.clientY })
    setIsOpen(true)
  }

  const openContextMenuAt = (x: number, y: number) => {
    setPosition({ x, y })
    setIsOpen(true)
  }

  const closeContextMenu = () => {
    setIsOpen(false)
  }

  return {
    isOpen,
    position,
    openContextMenu,
    openContextMenuAt,
    closeContextMenu,
  }
}
