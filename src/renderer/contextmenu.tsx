import React, { useEffect, useRef } from 'react'
import { MenuItems, type MenuItem } from './menuitem'

interface ContextMenuProps {
  items: MenuItem[]
  x: number
  y: number
  isOpen: boolean
  onClose: () => void
}

export function ContextMenu({ items, x, y, isOpen, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

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
      ref={menuRef}
      className="fixed menu-layer"
      style={{ top: y, left: x }}
    >
      <MenuItems items={items} maxItems={10} onItemClick={onClose} />
    </div>
  )
}

interface UseContextMenuResult {
  isOpen: boolean
  position: { x: number; y: number }
  openContextMenu: (event: React.MouseEvent) => void
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

  const closeContextMenu = () => {
    setIsOpen(false)
  }

  return {
    isOpen,
    position,
    openContextMenu,
    closeContextMenu,
  }
}
