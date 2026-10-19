import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ArrowLeft, Download, ExternalLink, ShieldCheck, ShieldX } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'

import { StatusBadge } from '@/components/certificates/StatusBadge'
import { Alert } from '@/components/feedback/Alert'
import { CopyButton } from '@/components/feedback/CopyButton'
import { ErrorState } from '@/components/feedback/States'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, Skeleton } from '@/components/ui/Card'
import { VerificationResultCard } from '@/components/verification/VerificationResultCard'
import { useCertificate, useDownload } from '@/features/certificates/hooks'
import { RevokeDialog } from '@/features/certificates/RevokeDialog'
import { ApiError } from '@/lib/apiClient'
import { env } from '@/lib/env'
import { buildVerificationUrl, formatDate } from '@/lib/utils'
import { certificateService } from '@/services/certificateService'

function Item({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-slate-600">{label}</dt>
      <dd className={`mt-0.5 break-words text-sm text-navy-900 ${mono ? 'font-mono text-xs' : ''}`}>{children}</dd>
    </div>
  )
}

export function CertificateDetailsPage() {
  const { certificateId = '' } = useParams()
  const query = useCertificate(certificateId)
  const { download, pendingId } = useDownload()
  const [revokeOpen, setRevokeOpen] = useState(false)
  const verifyMutation = useMutation({ mutationFn: () => certificateService.verifyCertificate(certificateId) })

  useEffect(() => {
    document.title = 'Certificate details – CertiTrust'
  }, [])

  const back = (
    <Link to="/admin/certificates" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
      <ArrowLeft className="size-4" aria-hidden="true" />
      All certificates
    </Link>
  )

  if (query.isPending) {
    return (
      <div aria-busy="true">
        {back}
        <span role="status" className="sr-only">
          Loading certificate…
        </span>
        <Card className="space-y-4 p-5">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-32 w-full" />
        </Card>
      </div>
    )
  }

  if (query.isError) {
    const notFound = query.error instanceof ApiError && query.error.status === 404
    return (
      <div>
        {back}
        <Card>
          {notFound ? (
            <div className="p-6">
              <Alert tone="warning" title="Certificate not found">
                No certificate with ID {certificateId} exists.
              </Alert>
            </div>
          ) : (
            <ErrorState error={query.error} title="Certificate could not be loaded" onRetry={() => void query.refetch()} />
          )}
        </Card>
      </div>
    )
  }

  const c = query.data
  const verificationUrl = buildVerificationUrl(env.publicVerificationBaseUrl, c.certificate_id)
  const revoked = c.effective_status === 'REVOKED'

  return (
    <div>
      {back}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-navy-900">{c.recipient_name}</h1>
          <p className="mt-1 text-sm text-slate-600">{c.course_name}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={c.effective_status} className="text-sm" />
          <Button onClick={() => void download(c.certificate_id)} loading={pendingId === c.certificate_id} icon={<Download className="size-4" aria-hidden="true" />}>
            Download PDF
          </Button>
          {!revoked && (
            <Button variant="danger" onClick={() => setRevokeOpen(true)} icon={<ShieldX className="size-4" aria-hidden="true" />}>
              Revoke
            </Button>
          )}
        </div>
      </div>

      {revoked && (
        <Alert tone="error" title="This certificate is revoked" className="mb-6">
          Revoked {formatDate(c.revoked_at, true)}
          {c.revoked_by ? ` by ${c.revoked_by}` : ''}.{c.revocation_reason ? ` Reason: ${c.revocation_reason}` : ''}
        </Alert>
      )}
      {!revoked && c.effective_status === 'EXPIRED' && (
        <Alert tone="warning" title="This certificate has expired" className="mb-6">
          It expired on {formatDate(c.expiry_date)}.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Certificate" />
          <dl className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2">
            <Item label="Recipient">{c.recipient_name}</Item>
            <Item label="Recipient email">{c.recipient_email ?? '—'}</Item>
            <Item label="Course or achievement">{c.course_name}</Item>
            <Item label="Issuing organization">{c.organization_name}</Item>
            <Item label="Issue date">{formatDate(c.issue_date, true)}</Item>
            <Item label="Expiry date">{c.expiry_date ? formatDate(c.expiry_date) : 'No expiry'}</Item>
            <Item label="Stored status">{c.status}</Item>
            <Item label="Created by" mono>
              {c.created_by}
            </Item>
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium text-slate-600">Certificate ID</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-2">
                <code className="break-all rounded bg-slate-100 px-2 py-1 font-mono text-xs">{c.certificate_id}</code>
                <CopyButton value={c.certificate_id} label="certificate ID" />
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium text-slate-600">Public verification link</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-2">
                <a href={verificationUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all font-mono text-xs text-brand-700 underline">
                  {verificationUrl}
                  <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                </a>
                <CopyButton value={verificationUrl} label="verification link" />
              </dd>
            </div>
          </dl>
        </Card>

        <Card>
          <CardHeader title="Integrity data" description="Stored with the record at issuance." />
          <dl className="space-y-4 p-5">
            <Item label="PDF SHA-256" mono>
              {c.pdf_sha256}
            </Item>
            <Item label="Metadata SHA-256" mono>
              {c.metadata_sha256}
            </Item>
            <Item label="Signature algorithm">{c.signature_algorithm}</Item>
            <Item label="Signing key version" mono>
              {c.kms_key_version.split('/').slice(-2).join('/')}
            </Item>
          </dl>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Live verification check"
          description="Runs the public verification of the stored record and its metadata signature. It does not examine the PDF file."
          action={
            <Button variant="secondary" loading={verifyMutation.isPending} onClick={() => verifyMutation.mutate()} icon={<ShieldCheck className="size-4" aria-hidden="true" />}>
              Run check
            </Button>
          }
        />
        <div className="p-5">
          {!verifyMutation.data && !verifyMutation.isError && <p className="text-sm text-slate-600">No check has been run yet.</p>}
          {verifyMutation.isError && <ErrorState error={verifyMutation.error} title="The check could not be completed" />}
          {verifyMutation.data && <VerificationResultCard result={verifyMutation.data} heading="Record verification" />}
        </div>
      </Card>

      <RevokeDialog certificateId={revokeOpen ? c.certificate_id : null} recipientName={c.recipient_name} onClose={() => setRevokeOpen(false)} />
    </div>
  )
}
