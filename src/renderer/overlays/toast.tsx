import React from 'react'
import { subscribeToastRequests, type ToastRequest } from './toast-events'

type ToastItem = {
  id: number
  message: string
  isFading: boolean
}

type ToastRuntime = {
  fadeTimerId: number | null
  removeTimerId: number | null
  fadeRemainingMs: number
  removeRemainingMs: number
  fadeStartedAtMs: number | null
  removeStartedAtMs: number | null
}

const TOAST_FADE_DELAY_MS = 4000
const TOAST_FADE_DURATION_MS = 400
const TOAST_DISMISS_DRAG_THRESHOLD_PX = 96
const TOAST_EXIT_DURATION_MS = 300
const TOAST_EXIT_TRAVEL_PX = 300

export function ToastStack() {
  const [toasts, setToasts] = React.useState<ToastItem[]>([])
  const [dragOffsets, setDragOffsets] = React.useState<Record<number, number>>({})
  const [draggingToastId, setDraggingToastId] = React.useState<number | null>(null)
  const [exitingToastIds, setExitingToastIds] = React.useState<Record<number, true>>({})
  const [fadeProgressByToastId, setFadeProgressByToastId] = React.useState<Record<number, number>>({})

  const nextToastIdRef = React.useRef(1)
  const toastRuntimeRef = React.useRef<Map<number, ToastRuntime>>(new Map())
  const dragStateRef = React.useRef<{ toastId: number; pointerId: number; startX: number } | null>(null)
  const exitTimerRef = React.useRef<Map<number, number>>(new Map())
  const hoveredToastIdsRef = React.useRef<Set<number>>(new Set())
  const exitingToastIdsRef = React.useRef<Record<number, true>>({})

  const clearToastTimers = React.useCallback((toastId: number) => {
    const runtime = toastRuntimeRef.current.get(toastId)
    if (!runtime) return

    if (runtime.fadeTimerId !== null) {
      window.clearTimeout(runtime.fadeTimerId)
      runtime.fadeTimerId = null
    }

    if (runtime.removeTimerId !== null) {
      window.clearTimeout(runtime.removeTimerId)
      runtime.removeTimerId = null
    }
  }, [])

  const removeToast = React.useCallback((toastId: number) => {
    clearToastTimers(toastId)
    const exitTimerId = exitTimerRef.current.get(toastId)
    if (exitTimerId !== undefined) {
      window.clearTimeout(exitTimerId)
      exitTimerRef.current.delete(toastId)
    }
    toastRuntimeRef.current.delete(toastId)
    setExitingToastIds((previous) => {
      if (previous[toastId] === undefined) return previous
      const next = { ...previous }
      delete next[toastId]
      return next
    })
    setDragOffsets((previous) => {
      if (previous[toastId] === undefined) return previous
      const next = { ...previous }
      delete next[toastId]
      return next
    })
    setFadeProgressByToastId((previous) => {
      if (previous[toastId] === undefined) return previous
      const next = { ...previous }
      delete next[toastId]
      return next
    })
    setDraggingToastId((previous) => (previous === toastId ? null : previous))
    setToasts((previous) => previous.filter((toast) => toast.id !== toastId))
  }, [clearToastTimers])

  const dismissToastWithExit = React.useCallback((toastId: number) => {
    if (exitingToastIds[toastId]) return

    clearToastTimers(toastId)

    setExitingToastIds((previous) => ({
      ...previous,
      [toastId]: true,
    }))

    setToasts((previous) => previous.map((toast) => (
      toast.id === toastId
        ? { ...toast, isFading: false }
        : toast
    )))

    const currentOffset = dragOffsets[toastId] ?? 0
    const offscreenOffset = currentOffset + TOAST_EXIT_TRAVEL_PX
    setDragOffsets((previous) => ({
      ...previous,
      [toastId]: offscreenOffset,
    }))

    const timerId = window.setTimeout(() => {
      removeToast(toastId)
    }, TOAST_EXIT_DURATION_MS)

    exitTimerRef.current.set(toastId, timerId)
  }, [clearToastTimers, dragOffsets, exitingToastIds, removeToast])

  const clearActiveDrag = React.useCallback(() => {
    dragStateRef.current = null
    setDraggingToastId(null)
  }, [])

  const handleToastPointerDown = React.useCallback((toastId: number, event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return

    dragStateRef.current = {
      toastId,
      pointerId: event.pointerId,
      startX: event.clientX,
    }
    setDraggingToastId(toastId)
    setDragOffsets((previous) => ({
      ...previous,
      [toastId]: 0,
    }))
  }, [])

  const handleWindowPointerMove = React.useCallback((event: PointerEvent) => {
    const dragState = dragStateRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return

    const nextOffset = Math.max(0, event.clientX - dragState.startX)
    setDragOffsets((previous) => ({
      ...previous,
      [dragState.toastId]: nextOffset,
    }))
  }, [])

  const handleWindowPointerUp = React.useCallback((event: PointerEvent) => {
    const dragState = dragStateRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return

    const dismissOffset = dragOffsets[dragState.toastId] ?? 0
    if (dismissOffset >= TOAST_DISMISS_DRAG_THRESHOLD_PX) {
      dismissToastWithExit(dragState.toastId)
      clearActiveDrag()
      return
    }

    setDragOffsets((previous) => ({
      ...previous,
      [dragState.toastId]: 0,
    }))
    clearActiveDrag()
  }, [clearActiveDrag, dismissToastWithExit, dragOffsets])

  const scheduleToastTimers = React.useCallback((toastId: number) => {
    const runtime = toastRuntimeRef.current.get(toastId)
    if (!runtime) return
    if (hoveredToastIdsRef.current.has(toastId)) return
    if (exitingToastIdsRef.current[toastId]) return

    if (runtime.fadeRemainingMs > 0) {
      const remainingRatio = Math.max(0, Math.min(1, runtime.fadeRemainingMs / TOAST_FADE_DELAY_MS))
      setFadeProgressByToastId((previous) => ({
        ...previous,
        [toastId]: 1 - remainingRatio,
      }))

      runtime.fadeStartedAtMs = Date.now()
      runtime.fadeTimerId = window.setTimeout(() => {
        setToasts((previous) => previous.map((toast) => (
          toast.id === toastId
            ? { ...toast, isFading: true }
            : toast
        )))
        setFadeProgressByToastId((previous) => ({
          ...previous,
          [toastId]: 1,
        }))

        const activeRuntime = toastRuntimeRef.current.get(toastId)
        if (!activeRuntime) return
        activeRuntime.fadeRemainingMs = 0
        activeRuntime.fadeTimerId = null
        activeRuntime.fadeStartedAtMs = null
      }, runtime.fadeRemainingMs)
    }

    if (runtime.removeRemainingMs > 0) {
      runtime.removeStartedAtMs = Date.now()
      runtime.removeTimerId = window.setTimeout(() => {
        removeToast(toastId)
      }, runtime.removeRemainingMs)
    }
  }, [removeToast])

  const appendToast = React.useCallback((request: ToastRequest) => {
    const toastId = nextToastIdRef.current
    nextToastIdRef.current += 1

    setToasts((previous) => [
      ...previous,
      {
        id: toastId,
        message: request.message,
        isFading: false,
      },
    ])
    setFadeProgressByToastId((previous) => ({
      ...previous,
      [toastId]: 0,
    }))

    toastRuntimeRef.current.set(toastId, {
      fadeTimerId: null,
      removeTimerId: null,
      fadeRemainingMs: TOAST_FADE_DELAY_MS,
      removeRemainingMs: TOAST_FADE_DELAY_MS + TOAST_FADE_DURATION_MS,
      fadeStartedAtMs: null,
      removeStartedAtMs: null,
    })

    scheduleToastTimers(toastId)
  }, [scheduleToastTimers])

  const resetToastTimer = React.useCallback((toastId: number) => {
    const runtime = toastRuntimeRef.current.get(toastId)
    if (!runtime) return

    clearToastTimers(toastId)
    runtime.fadeRemainingMs = TOAST_FADE_DELAY_MS
    runtime.removeRemainingMs = TOAST_FADE_DELAY_MS + TOAST_FADE_DURATION_MS
    runtime.fadeStartedAtMs = null
    runtime.removeStartedAtMs = null
    setFadeProgressByToastId((previous) => ({
      ...previous,
      [toastId]: 0,
    }))

    setToasts((previous) => previous.map((toast) => (
      toast.id === toastId
        ? { ...toast, isFading: false }
        : toast
    )))
  }, [clearToastTimers])

  const handleToastMouseEnter = React.useCallback((toastId: number) => {
    if (exitingToastIdsRef.current[toastId]) return
    hoveredToastIdsRef.current.add(toastId)
    resetToastTimer(toastId)
  }, [resetToastTimer])

  const handleToastMouseLeave = React.useCallback((toastId: number) => {
    hoveredToastIdsRef.current.delete(toastId)
    scheduleToastTimers(toastId)
  }, [scheduleToastTimers])

  React.useEffect(() => {
    exitingToastIdsRef.current = exitingToastIds
  }, [exitingToastIds])

  React.useEffect(() => {
    window.addEventListener('pointermove', handleWindowPointerMove)
    window.addEventListener('pointerup', handleWindowPointerUp)
    window.addEventListener('pointercancel', handleWindowPointerUp)

    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove)
      window.removeEventListener('pointerup', handleWindowPointerUp)
      window.removeEventListener('pointercancel', handleWindowPointerUp)
    }
  }, [handleWindowPointerMove, handleWindowPointerUp])

  React.useEffect(() => {
    const timerId = window.setInterval(() => {
      const now = Date.now()

      setFadeProgressByToastId((previous) => {
        let hasChanges = false
        const next = { ...previous }

        for (const [toastIdRaw, runtime] of toastRuntimeRef.current.entries()) {
          const toastId = Number(toastIdRaw)
          if (hoveredToastIdsRef.current.has(toastId)) continue
          if (exitingToastIdsRef.current[toastId]) continue
          if (runtime.fadeStartedAtMs === null) continue

          const elapsedMs = now - runtime.fadeStartedAtMs
          const remainingMs = Math.max(0, runtime.fadeRemainingMs - elapsedMs)
          const nextProgress = Math.max(0, Math.min(1, 1 - (remainingMs / TOAST_FADE_DELAY_MS)))
          const previousProgress = previous[toastId] ?? 0

          if (Math.abs(nextProgress - previousProgress) >= 0.01) {
            next[toastId] = nextProgress
            hasChanges = true
          }
        }

        return hasChanges ? next : previous
      })
    }, 50)

    return () => {
      window.clearInterval(timerId)
    }
  }, [])

  React.useEffect(() => {
    const unsubscribe = subscribeToastRequests((request) => {
      appendToast(request)
    })

    return () => {
      unsubscribe()
      for (const runtime of toastRuntimeRef.current.values()) {
        if (runtime.fadeTimerId !== null) {
          window.clearTimeout(runtime.fadeTimerId)
        }
        if (runtime.removeTimerId !== null) {
          window.clearTimeout(runtime.removeTimerId)
        }
      }
      for (const exitTimerId of exitTimerRef.current.values()) {
        window.clearTimeout(exitTimerId)
      }
      exitTimerRef.current.clear()
      toastRuntimeRef.current.clear()
    }
  }, [appendToast])

  if (toasts.length === 0) return null

  return (
    <div
      className="fixed bottom-9 right-6 z-9999 flex flex-col items-end gap-2"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          data-overlay-toast="true"
          onMouseEnter={() => handleToastMouseEnter(toast.id)}
          onMouseLeave={() => handleToastMouseLeave(toast.id)}
          onPointerDown={(event) => handleToastPointerDown(toast.id, event)}
          className={`max-w-3xs rounded shadow-lg border
            border-codemirror-highlight
            bg-codemirror-600 px-6 py-4 overflow-hidden
            text-sm text-codemirror-100 hover:text-codemirror-50
            relative select-none cursor-grab active:cursor-grabbing
            transition-all
            ${draggingToastId === toast.id ? 'duration-0 border-codemirror-highlight text-codemirror-50 shadow-xl' : ''}
            ${exitingToastIds[toast.id] ? 'duration-300 ease-out' : ''}
            ${draggingToastId !== toast.id && !exitingToastIds[toast.id] ? 'duration-400' : ''}
            ${toast.isFading ? 'opacity-0 hover:opacity-100' : 'opacity-100'}`}
          style={(dragOffsets[toast.id] ?? 0) > 0 ? { transform: `translateX(${dragOffsets[toast.id]}px)` } : undefined}
        >
          <button
            type="button"
            aria-label="Dismiss toast"
            className="absolute top-1 right-1 p-1 text-codemirror-300 hover:text-codemirror-50 cursor-pointer"
            onPointerDown={(event) => {
              event.stopPropagation()
            }}
            onClick={() => {
              dismissToastWithExit(toast.id)
            }}
          >
            <span className="codicon codicon-close" />
          </button>
          <div className="absolute top-0 left-0 right-0 h-px pointer-events-none">
            <div
              className="h-full bg-codemirror-400 origin-left"
              style={{ transform: `scaleX(${fadeProgressByToastId[toast.id] ?? 0})` }}
            />
          </div>
          {toast.message}
        </div>
      ))}
    </div>
  )
}
