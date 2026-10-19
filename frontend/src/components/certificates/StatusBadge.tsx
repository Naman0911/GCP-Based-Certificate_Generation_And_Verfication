import { AlertTriangle, CheckCircle2, Clock, HelpCircle, ShieldAlert, XCircle } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { CertificateStatus, VerificationStatus } from '@/types/certificate'

type AnyStatus = CertificateStatus | VerificationStatus

const config: Record<AnyStatus, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  VALID: { label: 'Valid', className: 'bg-emerald-50 text-emerald-800 ring-emerald-600/30', Icon: CheckCircle2 },
  REVOKED: { label: 'Revoked', className: 'bg-red-50 text-red-800 ring-red-600/30', Icon: XCircle },
  EXPIRED: { label: 'Expired', className: 'bg-amber-50 text-amber-900 ring-amber-600/30', Icon: Clock },
  TAMPERED: { label: 'Tampered', className: 'bg-red-50 text-red-800 ring-red-600/30', Icon: ShieldAlert },
  INVALID: { label: 'Not found', className: 'bg-slate-100 text-slate-800 ring-slate-500/30', Icon: HelpCircle },
}

/** Status is always conveyed by icon + text, never by colour alone. */
export function StatusBadge({ status, className }: { status: AnyStatus; className?: string }) {
  const { label, className: tone, Icon } = config[status] ?? { label: status, className: 'bg-slate-100 text-slate-800 ring-slate-500/30', Icon: AlertTriangle }
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset', tone, className)}>
      <Icon className="size-3.5" aria-hidden="true" />
      {label}
    </span>
  )
}
