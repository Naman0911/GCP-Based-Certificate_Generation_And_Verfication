import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Eye, FilePlus2, Search, ShieldX } from 'lucide-react'
import { Link } from 'react-router-dom'

import { StatusBadge } from '@/components/certificates/StatusBadge'
import { EmptyState, ErrorState } from '@/components/feedback/States'
import { Button } from '@/components/ui/Button'
import { Card, PageHeader, Skeleton } from '@/components/ui/Card'
import { Input, Select } from '@/components/ui/Field'
import { useCertificateList, useDownload } from '@/features/certificates/hooks'
import { RevokeDialog } from '@/features/certificates/RevokeDialog'
import { formatDate, matchesQuery } from '@/lib/utils'
import type { CertificateStatus, CertificateSummary } from '@/types/certificate'

const PAGE_SIZES = [10, 25, 50, 100]

export function CertificatesListPage() {
  const [status, setStatus] = useState<CertificateStatus | null>(null)
  const [pageSize, setPageSize] = useState(25)
  const [tokens, setTokens] = useState<string[]>([]) // tokens[i] = token for page i+1 (page 0 has none)
  const [search, setSearch] = useState('')
  const [revoking, setRevoking] = useState<CertificateSummary | null>(null)
  const { download, pendingId } = useDownload()

  const pageToken = tokens.length ? tokens[tokens.length - 1] : null
  const query = useCertificateList({ status, pageSize, pageToken })

  useEffect(() => {
    document.title = 'Certificates – CertiTrust'
  }, [])

  const items = useMemo(
    () => (query.data?.items ?? []).filter((c) => matchesQuery([c.recipient_name, c.certificate_id, c.course_name, c.organization_name], search)),
    [query.data, search],
  )
  const pageNumber = tokens.length + 1
  const nextToken = query.data?.next_page_token ?? null
  const hasFilters = status !== null || search.trim() !== ''

  function resetPaging() {
    setTokens([])
  }

  return (
    <div>
      <PageHeader
        title="Certificates"
        description="Search, review, download and revoke issued certificates."
        actions={
          <Link to="/admin/certificates/new" className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">
            <FilePlus2 className="size-4" aria-hidden="true" />
            Issue certificate
          </Link>
        }
      />

      <Card>
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-[1fr_auto_auto]">
          <div className="relative">
            <label htmlFor="cert-search" className="sr-only">
              Search the certificates on this page by name, ID, course or organization
            </label>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
            <Input id="cert-search" type="search" placeholder="Search this page: name, ID, course…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <div>
            <label htmlFor="cert-status" className="sr-only">
              Filter by status
            </label>
            <Select
              id="cert-status"
              value={status ?? ''}
              onChange={(e) => {
                setStatus((e.target.value || null) as CertificateStatus | null)
                resetPaging()
              }}
            >
              <option value="">All statuses</option>
              <option value="VALID">Valid</option>
              <option value="REVOKED">Revoked</option>
              <option value="EXPIRED">Expired</option>
            </Select>
          </div>
          <div>
            <label htmlFor="cert-size" className="sr-only">
              Rows per page
            </label>
            <Select
              id="cert-size"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                resetPaging()
              }}
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n} per page
                </option>
              ))}
            </Select>
          </div>
        </div>

        {query.isPending ? (
          <div className="space-y-3 p-4" aria-busy="true">
            <span role="status" className="sr-only">
              Loading certificates…
            </span>
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <ErrorState error={query.error} title="Certificates could not be loaded" onRetry={() => void query.refetch()} />
        ) : items.length === 0 ? (
          query.data.items.length === 0 && !hasFilters ? (
            <EmptyState
              title="No certificates yet"
              description="Issued certificates will appear here."
              action={
                <Link to="/admin/certificates/new" className="inline-flex h-10 items-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">
                  Issue the first certificate
                </Link>
              }
            />
          ) : (
            <EmptyState
              title="No certificates match"
              description={search.trim() ? 'No certificate on this page matches your search. Search covers only the rows loaded on this page; use next/previous to look further.' : 'No certificates have this status.'}
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch('')
                    setStatus(null)
                    resetPaging()
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          )
        ) : (
          <>
            <div className={query.isPlaceholderData ? 'opacity-60 transition-opacity' : undefined} aria-busy={query.isPlaceholderData}>
              {/* Table on wider screens */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Issued certificates</caption>
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-semibold">Recipient</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Certificate ID</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Course</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Issued</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Expires</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                      <th scope="col" className="px-4 py-3 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((c) => (
                      <tr key={c.certificate_id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-3 font-medium text-navy-900">{c.recipient_name}</td>
                        <td className="px-4 py-3 font-mono text-xs">{c.certificate_id}</td>
                        <td className="max-w-[14rem] truncate px-4 py-3" title={c.course_name}>{c.course_name}</td>
                        <td className="whitespace-nowrap px-4 py-3">{formatDate(c.issue_date)}</td>
                        <td className="whitespace-nowrap px-4 py-3">{formatDate(c.expiry_date)}</td>
                        <td className="px-4 py-3"><StatusBadge status={c.effective_status} /></td>
                        <td className="px-4 py-3">
                          <RowActions c={c} onRevoke={setRevoking} onDownload={download} downloading={pendingId === c.certificate_id} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Cards on small screens */}
              <ul className="divide-y divide-slate-100 md:hidden">
                {items.map((c) => (
                  <li key={c.certificate_id} className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-navy-900">{c.recipient_name}</p>
                        <p className="truncate text-sm text-slate-600">{c.course_name}</p>
                      </div>
                      <StatusBadge status={c.effective_status} />
                    </div>
                    <p className="break-all font-mono text-xs text-slate-600">{c.certificate_id}</p>
                    <p className="text-xs text-slate-600">
                      Issued {formatDate(c.issue_date)} · Expires {c.expiry_date ? formatDate(c.expiry_date) : 'never'}
                    </p>
                    <RowActions c={c} onRevoke={setRevoking} onDownload={download} downloading={pendingId === c.certificate_id} />
                  </li>
                ))}
              </ul>
            </div>

            <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-slate-100 p-4 text-sm">
              <p className="text-slate-600" aria-live="polite">
                Page {pageNumber} · showing {items.length} of {query.data.items.length} loaded
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={tokens.length === 0} onClick={() => setTokens((t) => t.slice(0, -1))} icon={<ChevronLeft className="size-4" aria-hidden="true" />}>
                  Previous
                </Button>
                <Button variant="secondary" size="sm" disabled={!nextToken || query.isPlaceholderData} onClick={() => nextToken && setTokens((t) => [...t, nextToken])}>
                  Next
                  <ChevronRight className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </nav>
          </>
        )}
      </Card>

      <RevokeDialog certificateId={revoking?.certificate_id ?? null} recipientName={revoking?.recipient_name} onClose={() => setRevoking(null)} />
    </div>
  )
}

function RowActions({
  c,
  onRevoke,
  onDownload,
  downloading,
}: {
  c: CertificateSummary
  onRevoke: (c: CertificateSummary) => void
  onDownload: (id: string) => Promise<void>
  downloading: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
      <Link
        to={`/admin/certificates/${encodeURIComponent(c.certificate_id)}`}
        aria-label={`View ${c.recipient_name}'s certificate`}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium hover:bg-slate-50"
      >
        <Eye className="size-4" aria-hidden="true" />
        View
      </Link>
      <Button size="sm" variant="secondary" loading={downloading} aria-label={`Download ${c.recipient_name}'s certificate`} onClick={() => void onDownload(c.certificate_id)} icon={<Download className="size-4" aria-hidden="true" />}>
        Download
      </Button>
      {c.effective_status !== 'REVOKED' && (
        <Button size="sm" variant="ghost" className="text-red-700 hover:bg-red-50" aria-label={`Revoke ${c.recipient_name}'s certificate`} onClick={() => onRevoke(c)} icon={<ShieldX className="size-4" aria-hidden="true" />}>
          Revoke
        </Button>
      )}
    </div>
  )
}
