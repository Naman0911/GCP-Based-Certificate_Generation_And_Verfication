import { useEffect } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'

import { Alert } from '@/components/feedback/Alert'
import { useToast } from '@/components/feedback/toastContext'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Textarea } from '@/components/ui/Field'
import { useRevokeCertificate } from '@/features/certificates/hooks'
import { ApiError, describeError } from '@/lib/apiClient'
import { revokeSchema, type RevokeValues } from '@/features/certificates/revokeSchema'


interface Props {
  certificateId: string | null
  recipientName?: string
  onClose: () => void
  onRevoked?: () => void
}

/** Confirmation dialog: revoking is permanent, requires an administrator and a written reason. */
export function RevokeDialog({ certificateId, recipientName, onClose, onRevoked }: Props) {
  const toast = useToast()
  const mutation = useRevokeCertificate()
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<RevokeValues>({ resolver: zodResolver(revokeSchema), defaultValues: { reason: '' } })

  useEffect(() => {
    if (certificateId) {
      reset({ reason: '' })
      mutation.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [certificateId, reset])

  function onSubmit(values: RevokeValues) {
    if (!certificateId || mutation.isPending) return
    mutation.mutate(
      { certificateId, reason: values.reason },
      {
        onSuccess: () => {
          toast.show('success', `Certificate ${certificateId} was revoked.`)
          onRevoked?.()
          onClose()
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 422) {
            const detail = error.details.find((d) => d.field?.split('.').pop() === 'reason')
            if (detail?.message) setError('reason', { message: detail.message })
          }
        },
      },
    )
  }

  return (
    <Dialog
      open={certificateId !== null}
      onClose={onClose}
      busy={mutation.isPending}
      title="Revoke this certificate?"
      description={`${recipientName ? `${recipientName} – ` : ''}${certificateId ?? ''}. Verification will report it as revoked from now on. This cannot be undone.`}
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <Field label="Reason for revocation" error={errors.reason?.message} required hint="Recorded in the audit trail. Not shown publicly.">
          {(p) => <Textarea {...p} rows={3} maxLength={500} data-autofocus {...register('reason')} />}
        </Field>
        {mutation.isError && !errors.reason && <Alert tone="error">{describeError(mutation.error)}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={mutation.isPending}>
            Revoke certificate
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
