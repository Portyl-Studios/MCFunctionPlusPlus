import React, { useEffect, useState } from 'react'
import { CircleTimer } from '../circletimer'

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
  inputValue?: string
  onInputChange?: (value: string) => void
}

export function Dialog({ isOpen, title, message, buttons, autoCloseMs, onClose, inputValue, onInputChange }: DialogProps) {
  const [elapsedMs, setElapsedMs] = useState(0)
  const [localInputValue, setLocalInputValue] = useState(inputValue || '')

  useEffect(() => {
    if (isOpen) {
      setLocalInputValue(inputValue || '')
    }
  }, [isOpen, inputValue])

  const handleInputChange = (value: string) => {
    setLocalInputValue(value)
    onInputChange?.(value)
  }

  useEffect(() => {
    if (!isOpen || !autoCloseMs) return

    const timerId = window.setTimeout(() => {
      onClose()
    }, autoCloseMs)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [isOpen, autoCloseMs, onClose])

  useEffect(() => {
    if (isOpen) {
      setElapsedMs(0)
    }
  }, [isOpen])

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
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-row items-center justify-between p-2">
          <span className="text-md font-semibold text-codemirror-100">{title}</span>
          <div
            onClick={onClose}
            className="codicon codicon-close p-1 -m-1 text-codemirror-200 hover:text-codemirror-50 cursor-pointer"
          />
        </div>

        <div className="h-px m-2 bg-codemirror-600" />

        <div className="flex-1 p-2 text-sm text-codemirror-100 text-wrap overflow-y-auto">
          {message}
          {onInputChange !== undefined && (
            <input
              type="text"
              value={localInputValue}
              onChange={(e) => handleInputChange(e.target.value)}
              className="w-full mt-2 px-2 py-1 bg-codemirror-default border border-codemirror-400 rounded text-codemirror-100 focus:outline-none focus:border-codemirror-200"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && buttons[0]) {
                  buttons[0].onClick()
                  onClose()
                }
              }}
            />
          )}
        </div>

        <div className="h-px m-2 bg-codemirror-600" />

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
  showPrompt: (title: string, message: string, defaultValue?: string) => Promise<string | null>
  showUnsavedConfirm: (title: string, message: string) => Promise<'save' | 'discard' | 'cancel'>
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

  const showPrompt = (title: string, message: string, defaultValue: string = ''): Promise<string | null> => {
    return new Promise((resolve) => {
      let inputValue = defaultValue
      openDialog({
        title,
        message,
        inputValue: defaultValue,
        onInputChange: (value) => {
          inputValue = value
        },
        buttons: [
          {
            label: 'OK',
            onClick: () => resolve(inputValue),
          },
          {
            label: 'Cancel',
            onClick: () => resolve(null),
          },
        ],
      })
    })
  }

  const showUnsavedConfirm = (title: string, message: string): Promise<'save' | 'discard' | 'cancel'> => {
    return new Promise((resolve) => {
      openDialog({
        title,
        message,
        buttons: [
          {
            label: 'Save',
            onClick: () => resolve('save'),
          },
          {
            label: 'Discard',
            onClick: () => resolve('discard'),
          },
          {
            label: 'Cancel',
            onClick: () => resolve('cancel'),
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
    showPrompt,
    showUnsavedConfirm,
  }
}
