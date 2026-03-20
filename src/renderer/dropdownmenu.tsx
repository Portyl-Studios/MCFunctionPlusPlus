import React, { useEffect, useState, useRef } from 'react'
import { MenuItems, type MenuItem } from './menuitem'
import { defocusActiveElement } from './utils'

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
  const menuRef = useRef<HTMLDivElement>(null)
  const [alignRight, setAlignRight] = useState(false)
  const buttonClass = buttonClassName ?? 'header-button'
  const disabledClass = disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''

  useEffect(() => {
    if (!isOpen) return

    defocusActiveElement()
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !menuRef.current) return

    const positionMenu = () => {
      const button = menuRef.current?.querySelector('div:first-child') as HTMLElement
      if (!button) return

      const buttonRect = button.getBoundingClientRect()
      const menuElement = menuRef.current?.querySelector('[class*="menu-layer"]') as HTMLElement
      
      if (menuElement) {
        // Give menu a moment to render
        setTimeout(() => {
          const menuRect = menuElement.getBoundingClientRect()
          
          // Check if menu would go off-screen to the right
          if (menuRect.right > window.innerWidth - 10) {
            setAlignRight(true)
          } else {
            setAlignRight(false)
          }
        }, 0)
      }
    }

    positionMenu()
    window.addEventListener('resize', positionMenu)
    return () => window.removeEventListener('resize', positionMenu)
  }, [isOpen])

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
        className={`${buttonClass} ${disabledClass} ${isOpen ? 'bg-codemirror-500' : ''}`}
      >
        {label}
      </div>
      {isOpen && !disabled && (
        <div data-overlay-menu="true" className={`absolute top-full ${alignRight ? 'right-1' : 'left-1'} mt-2 menu-layer z-50`}>
          <MenuItems items={items} maxItems={10} onItemClick={() => setIsOpen(false)} />
        </div>
      )}
    </div>
  )
}
