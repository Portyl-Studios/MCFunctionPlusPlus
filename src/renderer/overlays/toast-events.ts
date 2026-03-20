export interface ToastRequest {
  message: string
}

type ToastRequestListener = (request: ToastRequest) => void

const listeners = new Set<ToastRequestListener>()

export const subscribeToastRequests = (listener: ToastRequestListener) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const showToastEvent = (message: string) => {
  if (listeners.size === 0) {
    throw new Error('No toast request listener is registered')
  }

  const request: ToastRequest = { message }
  for (const listener of listeners) {
    listener(request)
  }
}
