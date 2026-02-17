import React, { useEffect } from 'react'

export interface MenuItem {
  label?: string
  onClick?: () => void
}

interface DropdownMenuProps {
  label: string
  items: MenuItem[]
  isOpen: boolean
  setIsOpen: (open: boolean) => void
}

export function DropdownMenu({ label, items, isOpen, setIsOpen }: DropdownMenuProps) {
  const menuRef = React.useRef<HTMLDivElement>(null)

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
        onClick={() => setIsOpen(!isOpen)}
        className="header-button-left"
      >
        {label}
      </div>
      {isOpen && (
        <div className="absolute top-full left-0 bg-codemirror-600 border border-codemirror-500 rounded shadow-lg z-50 mt-0">
          {items.map((item, index) => {
            const isDivider = !item.label || !item.onClick
            
            if (isDivider) {
              return (
                <div key={index} className="h-px bg-codemirror-500 m-1" />
              )
            }
            
            return (
              <div 
                key={index}
                onClick={() => {
                  item.onClick?.()
                  setIsOpen(false)
                }}
                className="px-3 py-2 hover:bg-codemirror-500 cursor-pointer text-sm text-codemirror-100 whitespace-nowrap"
              >
                {item.label}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface FileMenuProps {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  onOpenFolder: () => void
}

export function FileMenu({ isOpen, setIsOpen, onOpenFolder }: FileMenuProps) {
  const fileMenuItems: MenuItem[] = [
    { label: 'Open Folder', onClick: onOpenFolder },
  ]

  return (
    <DropdownMenu 
      label="File"
      items={fileMenuItems}
      isOpen={isOpen}
      setIsOpen={setIsOpen}
    />
  )
}
