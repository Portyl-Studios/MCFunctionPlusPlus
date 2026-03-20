import type { DialogButton } from './dialog'

export interface DialogRequestConfig {
  title: string
  message: string
  buttons: DialogButton[]
  autoCloseMs?: number
  inputValue?: string
  onInputChange?: (value: string) => void
}

type DialogRequestListener = (config: DialogRequestConfig) => void

const listeners = new Set<DialogRequestListener>()

export const subscribeDialogRequests = (listener: DialogRequestListener) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const emitDialogRequest = (config: DialogRequestConfig) => {
  if (listeners.size === 0) {
    throw new Error('No dialog request listener is registered')
  }

  for (const listener of listeners) {
    listener(config)
  }
}

export const showAlertEvent = (title: string, message: string): Promise<void> => {
  return new Promise((resolve) => {
    emitDialogRequest({
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

export const showConfirmEvent = (title: string, message: string): Promise<boolean> => {
  return new Promise((resolve) => {
    emitDialogRequest({
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

export const showPromptEvent = (title: string, message: string, defaultValue: string = ''): Promise<string | null> => {
  return new Promise((resolve) => {
    let inputValue = defaultValue

    emitDialogRequest({
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

export const showUnsavedConfirmEvent = (title: string, message: string): Promise<'save' | 'discard' | 'cancel'> => {
  return new Promise((resolve) => {
    emitDialogRequest({
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
