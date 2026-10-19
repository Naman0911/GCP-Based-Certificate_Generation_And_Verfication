import { useState } from 'react'
import { Search } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { env } from '@/lib/env'
import { parseVerificationInput } from '@/lib/utils'

/** Accepts a certificate ID or a pasted verification link and reports the normalised ID. */
export function VerifyIdForm({ onSubmit, buttonLabel = 'Verify certificate', autoFocus = false }: { onSubmit: (certificateId: string) => void; buttonLabel?: string; autoFocus?: boolean }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const id = parseVerificationInput(value, env.publicVerificationBaseUrl)
    if (!id) {
      setError('Enter a valid certificate ID, for example CERT-2026-0123456789ABCDEF0123, or paste its verification link.')
      return
    }
    setError(null)
    onSubmit(id)
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <Field label="Certificate ID or link" error={error ?? undefined} className="flex-1">
        {(p) => (
          <Input
            {...p}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
            autoFocus={autoFocus}
            spellCheck={false}
            placeholder="CERT-2026-0123456789ABCDEF0123"
            className="font-mono"
          />
        )}
      </Field>
      <Button type="submit" size="md" className="sm:mt-[1.625rem]" icon={<Search className="size-4" aria-hidden="true" />}>
        {buttonLabel}
      </Button>
    </form>
  )
}
