import React, { useEffect, useRef, useState } from 'react'
import { CircleTimer } from '../circletimer'
import { defocusActiveElement } from '../utils'

export interface DialogButton {
  label: string
  onClick: () => void
  disabled?: boolean
}

export type DialogProgressItem = {
  key: string
  label: string
  percent: number
  message?: string
  status?: 'queued' | 'running' | 'completed' | 'cached' | 'failed'
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
  dismissible?: boolean
  progressPercent?: number
  progressLabel?: string
  progressItems?: DialogProgressItem[]
  zIndexBase?: number
}

export function Dialog({
  isOpen,
  title,
  message,
  buttons,
  autoCloseMs,
  onClose,
  inputValue,
  onInputChange,
  dismissible = true,
  progressPercent,
  progressLabel,
  progressItems,
  zIndexBase = 50,
}: DialogProps) {
  const [elapsedMs, setElapsedMs] = useState(0)
  const [localInputValue, setLocalInputValue] = useState(inputValue || '')
  const dialogContainerRef = useRef<HTMLDivElement>(null)
  const clampedProgressPercent = typeof progressPercent === 'number'
    ? Math.max(0, Math.min(100, progressPercent))
    : null
  const hasProgressItems = Array.isArray(progressItems) && progressItems.length > 0

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

    defocusActiveElement()

    const focusFirstEditableId = window.setTimeout(() => {
      const container = dialogContainerRef.current
      if (!container) return

      const firstEditable = container.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [contenteditable="true"]',
      )

      if (firstEditable) {
        firstEditable.focus()
        return
      }

      const firstButton = container.querySelector<HTMLButtonElement>('button')
      if (firstButton && !firstButton.disabled) {
        firstButton.focus()
      }
    }, 0)

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissible) {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.clearTimeout(focusFirstEditableId)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [dismissible, isOpen, onClose])

  if (!isOpen) return null

  return (<>
    <div
      className="fixed inset-0 top-9 bottom-0 bg-codemirror-700 opacity-50"
      style={{ zIndex: zIndexBase }}
    ></div>
    <div
      data-overlay-dialog="true"
      className="fixed inset-0 top-9 bottom-0 flex items-center justify-center"
      style={{ backdropFilter: 'blur(2px)', zIndex: zIndexBase + 1 }}
      onClick={() => {
        if (dismissible) {
          onClose()
        }
      }}
    >
      <div
        ref={dialogContainerRef}
        className="flex flex-col min-w-sm max-w-xl min-h-auto max-h-[42%] p-2 bg-codemirror-700 border border-codemirror-400 rounded shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-row items-center justify-between p-2">
          <span className="text-md font-semibold text-codemirror-100">{title}</span>
          {dismissible && (
            <div
              onClick={onClose}
              className="codicon codicon-close p-1 -m-1 text-codemirror-200 hover:text-codemirror-50 cursor-pointer"
            />
          )}
        </div>

        <div className="h-px m-2 bg-codemirror-600" />

        <div className="flex-1 p-2 text-sm text-codemirror-100 text-wrap overflow-y-auto">
          {message}
          {clampedProgressPercent !== null && (
            <div className="mt-3">
              <div className="mb-2 text-xs text-codemirror-200">{progressLabel ?? 'Preparing Minecraft cache...'}</div>
              <div className="h-2 w-full overflow-hidden rounded bg-codemirror-600">
                <div
                  className="h-full bg-cyan-300 transition-[width] duration-200 ease-out"
                  style={{ width: `${clampedProgressPercent}%` }}
                />
              </div>
              <div className="mt-1 text-[11px] text-codemirror-300">{Math.round(clampedProgressPercent)}%</div>
            </div>
          )}
          {hasProgressItems && (
            <div className="mt-3 space-y-2">
              {progressItems.map((item) => {
                const itemPercent = Math.max(0, Math.min(100, item.percent))
                const statusLabel = item.status ? item.status.toUpperCase() : null
                const statusClassName = item.status === 'failed'
                  ? 'text-red-300'
                  : item.status === 'completed' || item.status === 'cached'
                    ? 'text-emerald-300'
                    : item.status === 'running'
                      ? 'text-cyan-300'
                      : 'text-codemirror-300'
                const progressClassName = item.status === 'failed'
                  ? 'bg-red-400'
                  : item.status === 'completed' || item.status === 'cached'
                    ? 'bg-emerald-400'
                    : 'bg-cyan-300'

                return (
                  <div key={item.key} className="rounded border border-codemirror-600 bg-codemirror-800/50 p-2">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-xs text-codemirror-100">{item.label}</span>
                      <span className={`text-[10px] font-semibold tracking-wide ${statusClassName}`}>
                        {statusLabel ?? `${Math.round(itemPercent)}%`}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded bg-codemirror-600">
                      <div
                        className={`h-full transition-[width] duration-200 ease-out ${progressClassName}`}
                        style={{ width: `${itemPercent}%` }}
                      />
                    </div>
                    {item.message && (
                      <div className="mt-1 text-[11px] text-codemirror-300">{item.message}</div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {onInputChange !== undefined && (
            <input
              type="text"
              value={localInputValue}
              onChange={(e) => handleInputChange(e.target.value)}
              className="w-full mt-2 px-2 py-1 bg-codemirror-default border border-codemirror-400 rounded text-codemirror-100 focus:outline-none focus:border-cyan-300 focus-visible:ring-2 focus-visible:ring-cyan-300/80 focus-visible:ring-offset-1 focus-visible:ring-offset-codemirror-700"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const container = dialogContainerRef.current
                  if (!container) return

                  const firstButton = container.querySelector<HTMLButtonElement>('button')
                  if (!firstButton || firstButton.disabled) return

                  e.preventDefault()
                  firstButton.click()
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
                  : 'bg-codemirror-default text-codemirror-100 hover:bg-codemirror-select cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 focus-visible:ring-offset-1 focus-visible:ring-offset-codemirror-700'
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
  closeAllDialogs: () => void
  dialogConfig: Omit<DialogProps, 'isOpen' | 'onClose'> | null
  dialogConfigs: Array<Omit<DialogProps, 'isOpen' | 'onClose'>>
  showAlert: (title: string, message: string) => Promise<void>
  showConfirm: (title: string, message: string) => Promise<boolean>
  showPrompt: (title: string, message: string, defaultValue?: string) => Promise<string | null>
  showUnsavedConfirm: (title: string, message: string) => Promise<'save' | 'discard' | 'cancel'>
}

export function useDialog(): UseDialogResult {
  const [dialogConfigs, setDialogConfigs] = useState<Array<Omit<DialogProps, 'isOpen' | 'onClose'>>>([])
  const isOpen = dialogConfigs.length > 0
  const dialogConfig = dialogConfigs.length > 0 ? dialogConfigs[dialogConfigs.length - 1] : null

  const openDialog = (config: Omit<DialogProps, 'isOpen' | 'onClose'>) => {
    setDialogConfigs((prev) => [...prev, config])
  }

  const closeDialog = () => {
    setDialogConfigs((prev) => prev.slice(0, -1))
  }

  const closeAllDialogs = () => {
    setDialogConfigs([])
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
    closeAllDialogs,
    dialogConfig,
    dialogConfigs,
    showAlert,
    showConfirm,
    showPrompt,
    showUnsavedConfirm,
  }
}
