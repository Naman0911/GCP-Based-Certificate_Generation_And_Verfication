import { useEffect } from 'react'
import { CheckCircle2, Clock, FilePlus2, FileText, ScanLine, ShieldX, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Alert } from '@/components/feedback/Alert'
import { EmptyState, ErrorState } from '@/components/feedback/States'
import { Card, CardHeader, PageHeader, Skeleton } from '@/components/ui/Card'
import { useAuth } from '@/features/auth/AuthContext'
import { deriveActivity, useCertificateList, useCertificateStats } from '@/features/certificates/hooks'
import { formatDate } from '@/lib/utils'

function Stat({ label, value, icon: Icon, tone, loading }: { label: string; value: number | undefined; icon: LucideIcon; tone: string; loading: boolean }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-600">{label}</p>
        <span className={`grid size-9 place-items-center rounded-lg ${tone}`}>
          <Icon className="size-5" aria-hidden="true" />
        </span>
      </div>
      {loading ? <Skeleton className="mt-3 h-8 w-16" /> : <p className="mt-2 text-3xl font-bold tabular-nums text-navy-900">{value ?? '—'}</p>}
    </Card>
  )
}

export function DashboardPage() {
  const { user } = useAuth()
  const stats = useCertificateStats()
  const recent = useCertificateList({ status: null, pageSize: 25, pageToken: null })

  useEffect(() => {
    document.title = 'Dashboard – CertiTrust'
  }, [])

  const activity = deriveActivity(recent.data?.items ?? [])

  return (
    <div>
      <PageHeader title="Dashboard" description={user?.email ? `Signed in as ${user.email}` : undefined} />

      {stats.isError ? (
        <Card className="mb-6">
          <ErrorState error={stats.error} title="Totals could not be loaded" onRetry={() => void stats.refetch()} />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Total certificates" value={stats.data?.total} icon={FileText} tone="bg-brand-50 text-brand-600" loading={stats.isPending} />
            <Stat label="Valid" value={stats.data?.valid} icon={CheckCircle2} tone="bg-emerald-50 text-emerald-700" loading={stats.isPending} />
            <Stat label="Revoked" value={stats.data?.revoked} icon={ShieldX} tone="bg-red-50 text-red-700" loading={stats.isPending} />
            <Stat label="Expired" value={stats.data?.expired} icon={Clock} tone="bg-amber-50 text-amber-800" loading={stats.isPending} />
          </div>
          {stats.data?.truncated && (
            <Alert tone="info" className="mt-4">
              Counts include the most recent 2,000 certificates only.
            </Alert>
          )}
        </>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Recent activity" description="Latest issued and revoked certificates." />
          {recent.isPending ? (
            <div className="space-y-3 p-5" aria-busy="true">
              <span role="status" className="sr-only">
                Loading activity…
              </span>
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : recent.isError ? (
            <ErrorState error={recent.error} title="Activity could not be loaded" onRetry={() => void recent.refetch()} />
          ) : activity.length === 0 ? (
            <EmptyState title="No activity yet" description="Issue your first certificate to see it here." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {activity.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-navy-900">
                      {a.type === 'issued' ? 'Issued to' : 'Revoked for'} {a.recipientName}
                    </p>
                    <Link to={`/admin/certificates/${encodeURIComponent(a.certificateId)}`} className="font-mono text-xs text-brand-700 hover:underline">
                      {a.certificateId}
                    </Link>
                  </div>
                  <time dateTime={a.at} className="shrink-0 text-xs text-slate-600">
                    {formatDate(a.at, true)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Quick actions" />
          <div className="space-y-2 p-4">
            {[
              { to: '/admin/certificates/new', label: 'Issue a certificate', icon: FilePlus2 },
              { to: '/admin/certificates', label: 'Manage certificates', icon: FileText },
              { to: '/verify', label: 'Verify a certificate', icon: ScanLine },
            ].map(({ to, label, icon: Icon }) => (
              <Link key={to} to={to} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-3 text-sm font-medium text-navy-900 hover:bg-slate-50">
                <Icon className="size-5 text-brand-600" aria-hidden="true" />
                {label}
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
