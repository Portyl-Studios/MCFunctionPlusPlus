import { useState } from 'react'
import type React from 'react'

import { useContextMenu } from './contextmenu'
import type { MenuItem } from '../menuitem'

export type ContextMenuRequest = {
  items: MenuItem[]
}

export function useContextMenuRequest() {
  const contextMenu = useContextMenu()
  const [request, setRequest] = useState<ContextMenuRequest | null>(null)

  const openForEvent = (event: React.MouseEvent, nextRequest: ContextMenuRequest) => {
    setRequest(nextRequest)
    contextMenu.openContextMenu(event)
  }

  const openAt = (x: number, y: number, nextRequest: ContextMenuRequest) => {
    setRequest(nextRequest)
    contextMenu.openContextMenuAt(x, y)
  }

  const close = () => {
    setRequest(null)
    contextMenu.closeContextMenu()
  }

  const hasReadyData = request !== null
  const isVisible = contextMenu.isOpen && hasReadyData

  return {
    contextMenu,
    request,
    items: request?.items ?? [],
    hasReadyData,
    isVisible,
    openForEvent,
    openAt,
    close,
  }
}
