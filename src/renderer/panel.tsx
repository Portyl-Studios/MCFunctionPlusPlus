import React, { ReactNode, useRef, useState } from "react"
import { DropdownMenu, type MenuItem } from "./dropdownmenu"

export interface PanelTab {
  id: string
  title: string
  icon?: string
  content: ReactNode
  visible?: boolean
}

interface PanelProps {
  tabs: PanelTab[]
  activeTabId?: string
  onTabChange?: (tabId: string) => void
  onTabReorder?: (draggedId: string, targetId: string, position: "before" | "after" | "end") => void
  position?: "left" | "right" | "bottom"
  width?: number
  height?: number
  menuItems?: MenuItem[]
}

export function Panel({ 
  tabs, 
  activeTabId, 
  onTabChange,
  onTabReorder,
  position = "right", 
  width, 
  height,
  menuItems = []
}: PanelProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null)
  const [dragOverPosition, setDragOverPosition] = useState<"before" | "after" | "end" | null>(null)
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null)
  const dragImageRef = useRef<HTMLDivElement | null>(null)
  const borderClass = position === "left" ? "border-r" : position === "right" ? "border-l" : "border-t"
  const hasMenuItems = menuItems.length > 0
  
  // Filter visible tabs
  const visibleTabs = tabs.filter(tab => tab.visible !== false)
  
  // Hide entire panel if no visible tabs
  if (visibleTabs.length === 0) {
    return null
  }
  
  // Get active tab based on activeTabId prop or default to first visible
  const activeTabIdResolved = activeTabId || visibleTabs[0]?.id || ""
  const activeTab = visibleTabs.find(p => p.id === activeTabIdResolved) || visibleTabs[0]

  return (
    <div
      style={{ ...(width && { width }), ...(height && { height }) }}
      className={`${borderClass} border-codemirror-600 flex flex-col bg-codemirror-700`}
    >

      {/* Header with Title and Tabs */}
      <div className="flex items-center justify-between flex-shrink-0 border-b border-codemirror-600">

        {/* Tab Bar */}
        <div className="flex items-center flex-1 min-w-0">
          <div className="flex border-r border-codemirror-600 overflow-x-auto">
            
            {visibleTabs.map((tab) => {
              const isActive = tab.id === activeTabIdResolved
              const showLeftIndicator = dragOverTabId === tab.id && dragOverPosition === "before"
              const showRightIndicator = dragOverTabId === tab.id && dragOverPosition === "after"
              const isDragging = draggingTabId === tab.id
              return (
                <div key={tab.id} className="relative flex">
                  {showLeftIndicator && (
                    <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-codemirror-100 pointer-events-none" />
                  )}

                  <button
                    draggable={!!onTabReorder}
                    onClick={() => onTabChange?.(tab.id)}
                    onDragStart={(event) => {
                      if (!onTabReorder) return
                      event.dataTransfer.setData("text/plain", tab.id)
                      event.dataTransfer.effectAllowed = "move"
                      setDraggingTabId(tab.id)

                      if (dragImageRef.current) {
                        dragImageRef.current.remove()
                        dragImageRef.current = null
                      }

                      const ghost = document.createElement("div")
                      ghost.className = `
                        p-1.5
                        bg-codemirror-600 rounded
                        border border-codemirror-400
                        text-xs text-codemirror-300
                        codicon ${tab.icon || ""}`
                      ghost.style.position = "fixed"
                      ghost.style.top = "-1000px"
                      ghost.style.left = "-1000px"
                      ghost.style.pointerEvents = "none"
                      document.body.appendChild(ghost)
                      dragImageRef.current = ghost

                      event.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2)
                    }}
                    onDragEnd={() => {
                      if (!onTabReorder) return
                      setDraggingTabId(null)
                      if (dragImageRef.current) {
                        dragImageRef.current.remove()
                        dragImageRef.current = null
                      }
                    }}
                    onDragOver={(event) => {
                      if (!onTabReorder) return
                      event.preventDefault()
                      event.dataTransfer.dropEffect = "move"
                      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
                      const midpoint = rect.left + rect.width / 2
                      const nextPosition = event.clientX < midpoint ? "before" : "after"
                      if (dragOverTabId !== tab.id || dragOverPosition !== nextPosition) {
                        setDragOverTabId(tab.id)
                        setDragOverPosition(nextPosition)
                      }
                    }}
                    onDragLeave={() => {
                      if (!onTabReorder) return
                      setDragOverTabId(null)
                      setDragOverPosition(null)
                    }}
                    onDrop={(event) => {
                      if (!onTabReorder) return
                      event.preventDefault()
                      const draggedId = event.dataTransfer.getData("text/plain")
                      if (draggedId && draggedId !== tab.id) {
                        const position = dragOverPosition === "after" ? "after" : "before"
                        onTabReorder(draggedId, tab.id, position)
                      }
                      setDragOverTabId(null)
                      setDragOverPosition(null)
                      setDraggingTabId(null)
                    }}
                    className={`
                      px-3 py-2 text-xs cursor-pointer border-b-2 flex items-center gap-1 whitespace-nowrap flex-shrink-0 hover:bg-codemirror-highlight
                      ${isDragging ? "opacity-10" : ""}
                      ${isActive
                        ? "border-b-codemirror-select text-codemirror-100"
                        : "border-b-transparent text-codemirror-300 hover:text-codemirror-100"
                      }
                    `}
                  >
                    {tab.icon && <span className={`codicon ${tab.icon} mt-[1px] mr-1`} />}
                    <span className="uppercase font-medium">{tab.title}</span>
                  </button>

                  {showRightIndicator && (
                    <div className="absolute right-0 top-0 bottom-0 w-[2px] bg-codemirror-100 pointer-events-none" />
                  )}
                </div>
              )
            })}

          </div>
        </div>

        {/* Menu Button */}
        <div className="relative flex-shrink-0 m-1">
          <DropdownMenu
            label={<div className="codicon codicon-ellipsis
              text-codemirror-300 p-1" />}
            items={menuItems}
            isOpen={isMenuOpen}
            setIsOpen={setIsMenuOpen}
            buttonClassName="panel-menu-button"
            disabled={!hasMenuItems}
          />
        </div>

      </div>

      {/* Active Panel Content */}
      <div className="flex-1 overflow-auto my-4 scrollbar-padding">
        <div className="">
          {activeTab?.content}
        </div>
      </div>

    </div>
  )
}
