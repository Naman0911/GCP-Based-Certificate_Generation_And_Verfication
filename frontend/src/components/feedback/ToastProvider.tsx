import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'

import { ToastContext, type ToastApi, type ToastKind } from '@/components/feedback/toastContext'
import { cn } from '@/lib/utils'

interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}

const icons = { success: CheckCircle2, error: AlertCircle, info: Info }
const styles: Record<ToastKind, string> = {
  success: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  error: 'border-red-300 bg-red-50 text-red-900',
  info: 'border-brand-200 bg-brand-50 text-navy-900',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const counter = useRef(0)

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), [])
  const show = useCallback(
    (kind: ToastKind, message: string) => {
      counter.current += 1
      const id = counter.current
      setToasts((list) => [...list.slice(-3), { id, kind, message }])
      window.setTimeout(() => dismiss(id), kind === 'error' ? 8000 : 5000)
    },
    [dismiss],
  )
  const api = useMemo<ToastApi>(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end">
        {toasts.map((toast) => {
          const Icon = icons[toast.kind]
          return (
            <div
              key={toast.id}
              role={toast.kind === 'error' ? 'alert' : 'status'}
              className={cn('toast-enter pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border p-3 shadow-lg', styles[toast.kind])}
            >
              <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <p className="flex-1 text-sm font-medium">{toast.message}</p>
              <button type="button" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification" className="rounded p-0.5 hover:bg-black/5">
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
