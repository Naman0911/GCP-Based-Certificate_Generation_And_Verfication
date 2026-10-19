import { useRef, useState } from 'react'
import { FileUp, UploadCloud } from 'lucide-react'

import { Alert } from '@/components/feedback/Alert'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { describeError } from '@/lib/apiClient'
import { env } from '@/lib/env'
import { validatePdfFile } from '@/lib/files'
import { formatBytes, normalizeCertificateId } from '@/lib/utils'

interface Props {
  /** When provided the ID is fixed (used on /verify/:certificateId). Otherwise the user types it. */
  certificateId?: string
  busy: boolean
  error: unknown
  onSubmit: (certificateId: string, file: File) => void
}

export function FileVerifyForm({ certificateId, busy, error, onSubmit }: Props) {
  const [idInput, setIdInput] = useState(certificateId ?? '')
  const [idError, setIdError] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function pick(next: File | null) {
    setFile(null)
    setFileError(null)
    if (!next) return
    const problem = await validatePdfFile(next, env.maxUploadBytes)
    if (problem) {
      setFileError(problem)
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    setFile(next)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const id = certificateId ?? normalizeCertificateId(idInput)
    if (!id) {
      setIdError('Enter a valid certificate ID, for example CERT-2026-0123456789ABCDEF0123.')
      return
    }
    setIdError(null)
    if (!file) {
      setFileError('Choose the PDF file to check.')
      return
    }
    onSubmit(id, file)
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {!certificateId && (
        <Field label="Certificate ID" error={idError ?? undefined} required hint="Printed on the certificate, next to the QR code.">
          {(p) => <Input {...p} value={idInput} onChange={(e) => setIdInput(e.target.value)} autoComplete="off" spellCheck={false} placeholder="CERT-2026-0123456789ABCDEF0123" className="font-mono" />}
        </Field>
      )}

      <Field label="Certificate PDF" error={fileError ?? undefined} required hint={`PDF only, up to ${env.maxUploadMb} MB. The file is sent to the verification service to be hashed and compared.`}>
        {(p) => (
          <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 text-center">
            <UploadCloud className="mx-auto mb-2 size-7 text-brand-600" aria-hidden="true" />
            <input
              {...p}
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => void pick(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-brand-700"
            />
            {file && (
              <p className="mt-2 flex items-center justify-center gap-1.5 text-sm text-navy-900">
                <FileUp className="size-4" aria-hidden="true" />
                {file.name} ({formatBytes(file.size)})
              </p>
            )}
          </div>
        )}
      </Field>

      {error !== null && error !== undefined && <Alert tone="error">{describeError(error)}</Alert>}

      <Button type="submit" loading={busy} disabled={busy}>
        {busy ? 'Checking file…' : 'Verify PDF file'}
      </Button>
    </form>
  )
}
