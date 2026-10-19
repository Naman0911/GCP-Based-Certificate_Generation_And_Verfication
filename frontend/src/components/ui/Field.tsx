import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

const control =
  'block w-full rounded-lg border bg-white px-3 text-sm text-navy-900 placeholder:text-slate-400 disabled:bg-slate-100 disabled:text-slate-500'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cn(control, 'h-10', invalid ? 'border-red-600' : 'border-slate-300', className)} {...rest} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea(
  { className, invalid, ...rest },
  ref,
) {
  return <textarea ref={ref} aria-invalid={invalid || undefined} className={cn(control, 'py-2', invalid ? 'border-red-600' : 'border-slate-300', className)} {...rest} />
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...rest }, ref) {
  return <select ref={ref} className={cn(control, 'h-10 border-slate-300', className)} {...rest} />
})

interface FieldProps {
  label: string
  error?: string
  hint?: string
  required?: boolean
  optional?: boolean
  /** Receives the props to spread onto the form control. */
  children: (props: { id: string; 'aria-describedby': string | undefined; invalid: boolean }) => ReactNode
  className?: string
}

/** Label + control + hint + error wired together with ids so screen readers announce them. */
export function Field({ label, error, hint, required, optional, children, className }: FieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-navy-900">
        {label}
        {required && (
          <span aria-hidden="true" className="ml-0.5 text-red-700">
            *
          </span>
        )}
        {optional && <span className="ml-1 font-normal text-slate-500">(optional)</span>}
      </label>
      {children({ id, 'aria-describedby': describedBy, invalid: Boolean(error) })}
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-slate-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
