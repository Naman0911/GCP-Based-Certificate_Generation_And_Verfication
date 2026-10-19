import type { ReactNode } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react'

import { cn } from '@/lib/utils'

type Tone = 'error' | 'warning' | 'success' | 'info'
const tones: Record<Tone, { box: string; Icon: typeof Info }> = {
  error: { box: 'border-red-300 bg-red-50 text-red-900', Icon: AlertCircle },
  warning: { box: 'border-amber-300 bg-amber-50 text-amber-900', Icon: AlertTriangle },
  success: { box: 'border-emerald-300 bg-emerald-50 text-emerald-900', Icon: CheckCircle2 },
  info: { box: 'border-brand-200 bg-brand-50 text-navy-900', Icon: Info },
}

export function Alert({ tone = 'info', title, children, className }: { tone?: Tone; title?: string; children?: ReactNode; className?: string }) {
  const { box, Icon } = tones[tone]
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-xl border p-4', box, className)}>
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 text-sm">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? 'mt-1' : ''}>{children}</div>}
      </div>
    </div>
  )
}
