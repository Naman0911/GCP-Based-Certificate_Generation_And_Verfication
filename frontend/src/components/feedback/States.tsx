import type { ReactNode } from 'react'
import { Inbox, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/feedback/Alert'
import { describeError } from '@/lib/apiClient'

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-500">
        <Inbox className="size-6" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-navy-900">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-600">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, title = 'Something went wrong', onRetry }: { error: unknown; title?: string; onRetry?: () => void }) {
  return (
    <div className="p-4">
      <Alert tone="error" title={title}>
        <p>{describeError(error)}</p>
        {onRetry && (
          <Button className="mt-3" size="sm" variant="secondary" onClick={onRetry} icon={<RefreshCw className="size-4" aria-hidden="true" />}>
            Try again
          </Button>
        )}
      </Alert>
    </div>
  )
}

export function FullPageSpinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex min-h-[50vh] items-center justify-center gap-3 text-slate-600">
      <span className="size-5 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" aria-hidden="true" />
      <span className="text-sm">{label}</span>
    </div>
  )
}
