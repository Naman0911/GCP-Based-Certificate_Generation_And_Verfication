import type { ReactNode } from 'react'
import { CheckCircle2, CircleSlash, FileCheck2, FileWarning, HelpCircle, ShieldAlert, ShieldCheck, ShieldQuestion, XCircle, Clock } from 'lucide-react'

import { StatusBadge } from '@/components/certificates/StatusBadge'
import { Alert } from '@/components/feedback/Alert'
import { Card } from '@/components/ui/Card'
import { cn, formatDate } from '@/lib/utils'
import type { VerificationResult, VerificationStatus } from '@/types/certificate'

interface Headline {
  title: string
  tone: string
  Icon: typeof CheckCircle2
}

function headline(result: VerificationResult): Headline {
  const fileChecked = result.pdf_integrity_verified !== null
  const map: Record<VerificationStatus, Headline> = {
    VALID: fileChecked
      ? { title: 'Certificate and file verified', tone: 'border-emerald-300 bg-emerald-50 text-emerald-900', Icon: ShieldCheck }
      : { title: 'Certificate record verified', tone: 'border-emerald-300 bg-emerald-50 text-emerald-900', Icon: ShieldCheck },
    REVOKED: { title: 'This certificate has been revoked', tone: 'border-red-300 bg-red-50 text-red-900', Icon: XCircle },
    EXPIRED: { title: 'This certificate has expired', tone: 'border-amber-300 bg-amber-50 text-amber-900', Icon: Clock },
    TAMPERED: { title: 'Integrity check failed', tone: 'border-red-300 bg-red-50 text-red-900', Icon: ShieldAlert },
    INVALID: { title: 'No matching certificate found', tone: 'border-slate-300 bg-slate-50 text-slate-900', Icon: HelpCircle },
  }
  return map[result.status]
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 py-3">
      <dt className="text-sm font-medium text-slate-700">{label}</dt>
      <dd className="text-right text-sm text-navy-900">{children}</dd>
    </div>
  )
}

function Check({ ok, yes, no }: { ok: boolean | null; yes: string; no: string }) {
  if (ok === null)
    return (
      <span className="inline-flex items-center gap-1.5 text-slate-600">
        <CircleSlash className="size-4" aria-hidden="true" />
        Not checked
      </span>
    )
  return ok ? (
    <span className="inline-flex items-center gap-1.5 font-medium text-emerald-800">
      <CheckCircle2 className="size-4" aria-hidden="true" />
      {yes}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 font-medium text-red-800">
      <XCircle className="size-4" aria-hidden="true" />
      {no}
    </span>
  )
}

/**
 * Shows the three independent results separately: certificate record status, metadata signature,
 * and PDF integrity. PDF integrity is only ever claimed when the backend actually checked an upload.
 */
export function VerificationResultCard({ result, heading }: { result: VerificationResult; heading?: string }) {
  const { title, tone, Icon } = headline(result)
  const cert = result.certificate
  const fileChecked = result.pdf_integrity_verified !== null
  const recordStatus = result.certificate_status ?? result.status

  return (
    <section aria-label={heading ?? 'Verification result'} data-testid="verification-result" data-status={result.status}>
      <Card className="overflow-hidden">
        <div role="status" className={cn('flex items-start gap-3 border-b p-5', tone)}>
          <Icon className="mt-0.5 size-7 shrink-0" aria-hidden="true" />
          <div>
            {heading && <p className="text-xs font-semibold uppercase tracking-wide opacity-80">{heading}</p>}
            <h2 className="text-lg font-bold">{title}</h2>
            <p className="mt-0.5 text-sm">{result.message}</p>
          </div>
        </div>

        <dl className="divide-y divide-slate-100 px-5">
          <Row label="Certificate record">{result.record_found ? <StatusBadge status={recordStatus} /> : <StatusBadge status="INVALID" />}</Row>
          <Row label="Metadata signature">
            <Check ok={result.metadata_signature_valid} yes="Signature verified" no="Signature does not match" />
          </Row>
          <Row label="PDF file integrity">
            {fileChecked ? <Check ok={result.pdf_integrity_verified} yes="File matches the issued certificate" no="File does not match the issued certificate" /> : <Check ok={null} yes="" no="" />}
          </Row>
        </dl>

        {!fileChecked && result.record_found && result.status !== 'TAMPERED' && (
          <div className="px-5 pb-5">
            <Alert tone="info" title="The PDF file has not been checked">
              This result only confirms the issuer's record for this ID. To confirm that a PDF is the exact file that was issued, upload it for file verification.
            </Alert>
          </div>
        )}
        {result.status === 'TAMPERED' && (
          <div className="px-5 pb-5">
            <Alert tone="error" title="Do not trust this certificate">
              {fileChecked
                ? 'The uploaded file is not identical to the file the issuer signed. It may have been edited or replaced.'
                : 'The stored record failed its signature check. Contact the issuing organization.'}
            </Alert>
          </div>
        )}

        {cert && (
          <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-navy-900">
              {fileChecked ? <FileCheck2 className="size-4" aria-hidden="true" /> : <ShieldQuestion className="size-4" aria-hidden="true" />}
              Certificate details
            </h3>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Detail label="Recipient" value={cert.recipient_name} />
              <Detail label="Course or achievement" value={cert.course_name} />
              <Detail label="Issued by" value={cert.organization_name} />
              <Detail label="Certificate ID" value={cert.certificate_id} mono />
              <Detail label="Issue date" value={formatDate(cert.issue_date)} />
              <Detail label="Expiry date" value={cert.expiry_date ? formatDate(cert.expiry_date) : 'No expiry'} />
              {cert.revoked_at && <Detail label="Revoked on" value={formatDate(cert.revoked_at)} />}
            </dl>
          </div>
        )}

        {result.verified_at && (
          <p className="flex items-center gap-1.5 border-t border-slate-100 px-5 py-3 text-xs text-slate-600">
            <FileWarning className="size-3.5" aria-hidden="true" />
            Checked {formatDate(result.verified_at, true)}
          </p>
        )}
      </Card>
    </section>
  )
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-slate-600">{label}</dt>
      <dd className={cn('mt-0.5 break-words text-navy-900', mono && 'font-mono text-xs')}>{value}</dd>
    </div>
  )
}
