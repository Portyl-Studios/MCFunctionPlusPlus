import React, { useEffect, useState } from 'react'
import { CircleTimer } from './circletimer'

export interface DialogButton {
  label: string
  onClick: () => void
  disabled?: boolean
}

interface DialogProps {
  isOpen: boolean
  title: string
  message: string
  buttons: DialogButton[]
  autoCloseMs?: number
  onClose: () => void
}

export function Dialog({ isOpen, title, message, buttons, autoCloseMs, onClose }: DialogProps) {
  const [elapsedMs, setElapsedMs] = useState(0)

  // Auto-close timer: closes dialog after specified duration
  useEffect(() => {
    if (!isOpen || !autoCloseMs) return

    const timerId = window.setTimeout(() => {
      onClose()
    }, autoCloseMs)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [isOpen, autoCloseMs, onClose])

  // Reset elapsed time when dialog opens
  useEffect(() => {
    if (isOpen) {
      setElapsedMs(0)
    }
  }, [isOpen])

  // Track elapsed time for visual timer indicator (updates every 50ms)
  useEffect(() => {
    if (!isOpen || !autoCloseMs) return

    const intervalId = window.setInterval(() => {
      setElapsedMs((prev) => Math.min(prev + 50, autoCloseMs))
    }, 50)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [isOpen, autoCloseMs])

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (<>
    <div className="fixed inset-0 top-[36px] bottom-[30px] bg-codemirror-700 opacity-50 z-50"></div>
    <div
      className="fixed inset-0 top-[36px] bottom-[30px] flex items-center justify-center z-50"
      style={{ backdropFilter: 'blur(2px)' }}
      onClick={onClose}
    >
      <div
        className="flex flex-col min-w-sm max-w-xl min-h-auto max-h-[42%] p-2 bg-codemirror-700 border border-codemirror-400 rounded shadow-2xl"
        onClick={(e) => e.stopPropagation()} // Prevent clicks inside dialog from closing it
      >
        {/* Title Bar */}
        <div className="flex flex-row items-center justify-between p-2">
          <span className="text-md font-semibold text-codemirror-100">{title}</span>
          <div
            onClick={onClose}
            className="codicon codicon-close p-1 -m-1 text-codemirror-200 hover:text-codemirror-50 cursor-pointer"
          />
        </div>

        <div className="h-px m-2 bg-codemirror-600" />

        {/* Content Panel */}
        <div className="flex-1 p-2 text-sm text-codemirror-100 text-wrap overflow-y-auto">
          {message}
        </div>

        <div className="h-px m-2 bg-codemirror-600" />

        {/* Footer with Buttons */}
        <div className="flex items-center justify-end gap-3 p-2">
          {autoCloseMs && (
            <div className="flex items-center mr-auto">
              <CircleTimer
                elapsed={elapsedMs} total={autoCloseMs}
                size={24} thickness={6} reverse={false}
                progressClassName="text-codemirror-300"
                trackClassName="text-codemirror-500"
              />
            </div>
          )}
          {buttons.map((button, index) => (
            <button
              key={index}
              onClick={() => {
                button.onClick()
                onClose()
              }}
              disabled={button.disabled}
              className={`px-4 py-2 rounded text-sm font-medium ${
                button.disabled
                  ? 'bg-codemirror-600 text-codemirror-400 cursor-not-allowed'
                  : 'bg-codemirror-default text-codemirror-100 hover:bg-codemirror-select cursor-pointer'
              }`}
            >
              {button.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  </>)
}

interface UseDialogResult {
  isOpen: boolean
  openDialog: (config: Omit<DialogProps, 'isOpen' | 'onClose'>) => void
  closeDialog: () => void
  dialogConfig: Omit<DialogProps, 'isOpen' | 'onClose'> | null
  showAlert: (title: string, message: string) => Promise<void>
  showConfirm: (title: string, message: string) => Promise<boolean>
}

export function useDialog(): UseDialogResult {
  const [isOpen, setIsOpen] = useState(false)
  const [dialogConfig, setDialogConfig] = useState<Omit<DialogProps, 'isOpen' | 'onClose'> | null>(null)

  const openDialog = (config: Omit<DialogProps, 'isOpen' | 'onClose'>) => {
    setDialogConfig(config)
    setIsOpen(true)
  }

  const closeDialog = () => {
    setIsOpen(false)
  }

  // Promise-based alert/confirm helpers that mimic native browser dialogs
  // but use the custom dialog component for consistent styling
  const showAlert = (title: string, message: string): Promise<void> => {
    return new Promise((resolve) => {
      openDialog({
        title,
        message,
        buttons: [
          {
            label: 'OK',
            onClick: () => resolve(),
          },
        ],
        autoCloseMs: 12000,
      })
    })
  }

  const showConfirm = (title: string, message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      openDialog({
        title,
        message,
        buttons: [
          {
            label: 'Yes',
            onClick: () => resolve(true),
          },
          {
            label: 'No',
            onClick: () => resolve(false),
          },
        ],
      })
    })
  }

  return {
    isOpen,
    openDialog,
    closeDialog,
    dialogConfig,
    showAlert,
    showConfirm,
  }
}
