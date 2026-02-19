import React, { useEffect } from 'react'
import { MenuItems, type MenuItem } from './menuitem'

export type { MenuItem }

interface DropdownMenuProps {
  label: React.ReactNode
  items: MenuItem[]
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  buttonClassName?: string
  disabled?: boolean
}

export function DropdownMenu({ label, items, isOpen, setIsOpen, buttonClassName, disabled }: DropdownMenuProps) {
  const menuRef = React.useRef<HTMLDivElement>(null)
  const buttonClass = buttonClassName ?? 'header-button-left'
  const disabledClass = disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
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
    <div ref={menuRef} className="relative">
      <div 
        onClick={() => {
          if (disabled) return
          setIsOpen(!isOpen)
        }}
        className={`${buttonClass} ${disabledClass} ${isOpen ? 'border-b border-codemirror-select' : ''}`}
      >
        {label}
      </div>
      {isOpen && !disabled && (
        <div className="absolute top-full left-0 mt-2 menu-layer">
          <MenuItems items={items} maxItems={10} onItemClick={() => setIsOpen(false)} />
        </div>
      )}
    </div>
  )
}
