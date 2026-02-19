import React from 'react'

export interface MenuItem {
  label?: string
  shortcut?: string
  onClick?: () => void
  onToggle?: (nextState: boolean) => void
  children?: MenuItem[]
  disabled?: boolean
  existingFolder?: boolean
  toggleable?: boolean
  toggled?: boolean
}

interface MenuItemsProps {
  items: MenuItem[]
  onItemClick?: () => void
  maxItems?: number
}

export function MenuItems({ items, onItemClick, maxItems = 5 }: MenuItemsProps) {
  const [openSubmenuIndex, setOpenSubmenuIndex] = React.useState<number | null>(null)
  const closeTimeoutRef = React.useRef<number | null>(null)

  const clearCloseTimeout = () => {
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
  }

  React.useEffect(() => {
    return () => {
      clearCloseTimeout()
    }
  }, [])

  const shouldScroll = items.length > maxItems
  const containerHeight = shouldScroll ? `calc(${maxItems} * 36px)` : 'auto'

  const handleMenuItemClick = (item: MenuItem, hasChildren: boolean, isDisabled: boolean) => {
    if (hasChildren || isDisabled) return

    const didToggle = !!(item.toggleable && item.onToggle)
    if (didToggle) {
      item.onToggle?.(!item.toggled)
    }

    const didClick = !!item.onClick
    if (didClick) {
      item.onClick?.()
    }

    if (!didToggle && didClick) {
      onItemClick?.()
    }
  }

  return (
    <div 
      className="bg-codemirror-600 border border-codemirror-400 rounded shadow-lg menu-layer"
      style={{
        maxHeight: containerHeight,
        overflowY: shouldScroll ? 'auto' : 'visible',
      }}
    >
      <div className="p-2">
        {items.map((item, index) => {
          const hasChildren = !!item.children?.length
          const isDivider = !item.label && !item.onClick && !hasChildren
          const isSubmenuOpen = openSubmenuIndex === index
          const isDisabled = !!item.disabled
          
          if (isDivider) {
            return (
              <div key={index} className="h-px bg-codemirror-400 my-1" />
            )
          }
          
          return (
            <div
              key={index}
              className="relative"
              onMouseEnter={() => {
                clearCloseTimeout()
                setOpenSubmenuIndex(index)
              }}
              onMouseLeave={() => {
                clearCloseTimeout()
                closeTimeoutRef.current = window.setTimeout(() => {
                  setOpenSubmenuIndex((prev) => (prev === index ? null : prev))
                }, 500)
              }}
            >
              <div 
                onClick={() => handleMenuItemClick(item, hasChildren, isDisabled)}
                className={`flex items-center gap-4 p-2 rounded text-sm whitespace-nowrap
                  ${
                    item.existingFolder
                    ? 'text-emerald-400 cursor-not-allowed'
                    : (
                      isDisabled
                      ? 'text-codemirror-400 cursor-not-allowed'
                      : 'text-codemirror-100 hover:bg-codemirror-highlight cursor-pointer'
                    )
                  }
                `}
              >

                {/* Left: Check indicator + Label */}
                <span className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="w-4 mt-0.5 flex-shrink-0 flex items-center justify-center">
                    {item.toggleable && item.toggled && (
                      <i className="codicon codicon-check text-codemirror-100" />
                    )}
                  </span>
                  <span>{item.label}</span>
                </span>

                {/* Right: Shortcut or Submenu indicator */}
                <span className="min-w-4 flex-shrink-0 flex items-center justify-end">
                  {item.shortcut && (
                    <span className="pillbox px-2 py-0.5 font-mono text-xs text-codemirror-300">
                      {item.shortcut}
                    </span>
                  )}
                  {!item.shortcut && hasChildren && (
                    <i className="codicon codicon-chevron-right text-codemirror-300" />
                  )}
                </span>
                
              </div>
              {hasChildren && isSubmenuOpen && (
                <div className="absolute left-full top-0 ml-4 menu-layer">
                  <MenuItems items={item.children!} onItemClick={onItemClick} maxItems={maxItems} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
