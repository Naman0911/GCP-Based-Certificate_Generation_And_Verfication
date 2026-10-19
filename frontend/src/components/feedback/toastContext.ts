import { createContext, useContext } from 'react'

export type ToastKind = 'success' | 'error' | 'info'
export interface ToastApi {
  show(kind: ToastKind, message: string): void
}

export const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const value = useContext(ToastContext)
  if (!value) throw new Error('useToast must be used inside <ToastProvider>')
  return value
}
