import React from 'react'

export interface MenuItem {
  label?: string
  shortcut?: string
  onClick?: () => void
  children?: MenuItem[]
  disabled?: boolean
  existingFolder?: boolean
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
                onClick={() => {
                  if (hasChildren || isDisabled || !item.onClick) return
                  item.onClick?.()
                  onItemClick?.()
                }}
                className={`p-2 text-sm whitespace-nowrap flex items-center justify-between gap-3 ${
                  item.existingFolder
                    ? 'text-emerald-400 cursor-not-allowed'
                    : isDisabled
                    ? 'text-codemirror-400 cursor-not-allowed'
                    : 'text-codemirror-100 hover:bg-codemirror-500 cursor-pointer'
                }`}
              >
                <span>{item.label}</span>

                {item.shortcut && (
                  <span className="pillbox ml-2 px-2 py-0.5 font-mono text-xs text-codemirror-300">
                    {item.shortcut}
                  </span>
                )}

                {hasChildren && (
                  <i className="codicon codicon-chevron-right text-codemirror-300" />
                )}
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
