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
  const [submenuPlacements, setSubmenuPlacements] = React.useState<Record<number, { openLeft: boolean; offsetY: number }>>({})
  const closeTimeoutRef = React.useRef<number | null>(null)
  const itemRefs = React.useRef<Map<number, HTMLDivElement>>(new Map())
  const submenuRefs = React.useRef<Map<number, HTMLDivElement>>(new Map())

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

  React.useEffect(() => {
    if (openSubmenuIndex === null) return

    const repositionSubmenu = () => {
      const itemElement = itemRefs.current.get(openSubmenuIndex)
      const submenuElement = submenuRefs.current.get(openSubmenuIndex)
      if (!itemElement || !submenuElement) return

      const margin = 8
      const gap = 16
      const itemRect = itemElement.getBoundingClientRect()
      const submenuRect = submenuElement.getBoundingClientRect()

      const wouldOverflowRight = itemRect.right + gap + submenuRect.width > window.innerWidth - margin

      let offsetY = 0
      const submenuBottom = itemRect.top + submenuRect.height
      if (submenuBottom > window.innerHeight - margin) {
        offsetY -= submenuBottom - (window.innerHeight - margin)
      }

      const submenuTop = itemRect.top + offsetY
      if (submenuTop < margin) {
        offsetY += margin - submenuTop
      }

      setSubmenuPlacements((prev) => ({
        ...prev,
        [openSubmenuIndex]: {
          openLeft: wouldOverflowRight,
          offsetY,
        },
      }))
    }

    repositionSubmenu()
    window.addEventListener('resize', repositionSubmenu)
    return () => {
      window.removeEventListener('resize', repositionSubmenu)
    }
  }, [openSubmenuIndex, items])

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

    // Do not close the menu when the item is toggleable (e.g., a preference toggle).
    const shouldClose = !item.toggleable
    if (shouldClose) {
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
              ref={(element) => {
                if (element) {
                  itemRefs.current.set(index, element)
                } else {
                  itemRefs.current.delete(index)
                }
              }}
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
                  <span className="w-4 mt-0.5 shrink-0 flex items-center justify-center">
                    {item.toggleable && item.toggled && (
                      <i className="codicon codicon-check text-codemirror-100" />
                    )}
                  </span>
                  <span>{item.label}</span>
                </span>

                {/* Right: Shortcut or Submenu indicator */}
                <span className="min-w-4 shrink-0 flex items-center justify-end">
                  {item.shortcut && (
                    <span className="pillbox ml-2 px-2 py-0.5 font-mono text-xs text-codemirror-300">
                      {item.shortcut}
                    </span>
                  )}
                  {!item.shortcut && hasChildren && (
                    <i className="codicon codicon-chevron-right text-codemirror-300" />
                  )}
                </span>
                
              </div>
              {hasChildren && isSubmenuOpen && (
                <div
                  ref={(element) => {
                    if (element) {
                      submenuRefs.current.set(index, element)
                    } else {
                      submenuRefs.current.delete(index)
                    }
                  }}
                  className={`absolute top-0 menu-layer ${submenuPlacements[index]?.openLeft ? 'right-full mr-4' : 'left-full ml-4'}`}
                  style={{ transform: `translateY(${submenuPlacements[index]?.offsetY ?? 0}px)` }}
                >
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
