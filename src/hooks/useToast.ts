import { createContext, useContext, useState, useCallback, useRef, createElement, type ReactNode } from 'react'

export interface Toast {
  id: number
  message: string
  undo?: () => void
  removing?: boolean
}

interface ToastAPI {
  toast: (message: string, options?: { undo?: () => void; duration?: number }) => void
  toasts: Toast[]
}

const ToastContext = createContext<ToastAPI>({ toast: () => {}, toasts: [] })

export function useToast() {
  return useContext(ToastContext)
}

let nextId = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, removing: true } : t))
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 300)
  }, [])

  const toast = useCallback((message: string, options?: { undo?: () => void; duration?: number }) => {
    const id = nextId++
    setToasts(prev => [...prev, { id, message, undo: options?.undo }])
    const timer = setTimeout(() => dismiss(id), options?.duration ?? 4000)
    timers.current.set(id, timer)
  }, [dismiss])

  return createElement(
    ToastContext.Provider,
    { value: { toast, toasts } },
    children,
    // Toast container
    createElement('div', { className: 'fixed bottom-4 right-4 z-50 flex flex-col gap-2', key: 'toast-container' },
      toasts.map(t =>
        createElement('div', {
          key: t.id,
          className: `bg-bg-2 border border-border rounded-card px-4 py-3 text-sm text-text-1 shadow-lg flex items-center gap-3 transition-all duration-300 ${t.removing ? 'opacity-0 translate-x-4' : 'opacity-100'}`,
        },
          createElement('span', null, t.message),
          t.undo && createElement('button', {
            className: 'text-accent hover:text-accent-hover font-medium',
            onClick: () => {
              t.undo!()
              const timer = timers.current.get(t.id)
              if (timer) clearTimeout(timer)
              setToasts(prev => prev.filter(x => x.id !== t.id))
            },
          }, 'Undo'),
        )
      )
    )
  )
}
