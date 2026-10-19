import { useEffect } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'

import { Alert } from '@/components/feedback/Alert'
import { Card, CardHeader, Skeleton } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { FileVerifyForm } from '@/components/verification/FileVerifyForm'
import { VerificationResultCard } from '@/components/verification/VerificationResultCard'
import { useVerifyCertificate, useVerifyFile } from '@/features/verification/hooks'
import { describeError } from '@/lib/apiClient'
import { normalizeCertificateId } from '@/lib/utils'

export function VerifyResultPage() {
  const { certificateId: rawId = '' } = useParams()
  const certificateId = normalizeCertificateId(rawId)
  const query = useVerifyCertificate(certificateId)
  const fileMutation = useVerifyFile()

  useEffect(() => {
    document.title = 'Verification result – CertiTrust'
  }, [])

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link to="/verify" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Verify another certificate
      </Link>
      <h1 className="text-2xl font-bold tracking-tight text-navy-900">Verification result</h1>
      <p className="mt-1 break-all font-mono text-xs text-slate-600">{certificateId ?? rawId}</p>

      <div className="mt-6 space-y-6">
        {certificateId === null && (
          <Alert tone="error" title="This is not a valid certificate ID">
            Certificate IDs look like CERT-2026-0123456789ABCDEF0123. Check the ID and try again.
          </Alert>
        )}

        {certificateId !== null && query.isPending && (
          <Card className="space-y-3 p-5" aria-busy="true">
            <span className="sr-only" role="status">
              Verifying certificate…
            </span>
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-24 w-full" />
          </Card>
        )}

        {query.isError && (
          <Alert tone="error" title="Verification could not be completed">
            <p>{describeError(query.error)}</p>
            <Button className="mt-3" size="sm" variant="secondary" onClick={() => void query.refetch()} icon={<RefreshCw className="size-4" aria-hidden="true" />}>
              Try again
            </Button>
          </Alert>
        )}

        {query.data && <VerificationResultCard result={query.data} heading="Record verification (ID / QR)" />}

        {certificateId !== null && query.data?.record_found && (
          <Card>
            <CardHeader title="Check the PDF file" description="Upload the PDF you were given to confirm it is exactly the file that was issued." />
            <div className="p-5">
              <FileVerifyForm
                certificateId={certificateId}
                busy={fileMutation.isPending}
                error={fileMutation.error}
                onSubmit={(id, file) => fileMutation.mutate({ certificateId: id, file })}
              />
            </div>
          </Card>
        )}

        {fileMutation.data && <VerificationResultCard result={fileMutation.data} heading="PDF file verification" />}
      </div>
    </div>
  )
}
