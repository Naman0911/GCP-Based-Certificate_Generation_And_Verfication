import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { LogIn } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Navigate, useLocation } from 'react-router-dom'
import { z } from 'zod'

import { Alert } from '@/components/feedback/Alert'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Input } from '@/components/ui/Field'
import { useAuth } from '@/features/auth/AuthContext'
import { describeAuthError } from '@/lib/firebase'

const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email address.').email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
})
type Values = z.infer<typeof schema>

function safeRedirect(from: unknown): string {
  return typeof from === 'string' && from.startsWith('/admin') ? from : '/admin'
}

export function LoginPage() {
  const { status, sessionExpired, signInWithPassword, signInWithGoogle } = useAuth()
  const location = useLocation()
  const [formError, setFormError] = useState<string | null>(null)
  const [googleBusy, setGoogleBusy] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } })

  useEffect(() => {
    document.title = 'Sign in – CertiTrust'
  }, [])

  if (status === 'authenticated') {
    return <Navigate to={safeRedirect((location.state as { from?: unknown } | null)?.from)} replace />
  }

  async function onSubmit(values: Values) {
    setFormError(null)
    try {
      await signInWithPassword(values.email, values.password)
    } catch (error) {
      setFormError(describeAuthError(error))
    }
  }

  async function onGoogle() {
    setFormError(null)
    setGoogleBusy(true)
    try {
      await signInWithGoogle()
    } catch (error) {
      setFormError(describeAuthError(error))
    } finally {
      setGoogleBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-14">
      <Card className="p-6 sm:p-8">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-brand-50 text-brand-600">
            <LogIn className="size-6" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold text-navy-900">Administrator sign in</h1>
          <p className="mt-1 text-sm text-slate-600">Sign in to issue and manage certificates. Verifying a certificate does not require an account.</p>
        </div>

        {sessionExpired && (
          <Alert tone="warning" title="Your session ended" className="mb-4">
            Please sign in again to continue.
          </Alert>
        )}
        {formError && (
          <Alert tone="error" className="mb-4">
            {formError}
          </Alert>
        )}

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <Field label="Email" error={errors.email?.message} required>
            {(p) => <Input {...p} type="email" autoComplete="username" inputMode="email" {...register('email')} />}
          </Field>
          <Field label="Password" error={errors.password?.message} required>
            {(p) => <Input {...p} type="password" autoComplete="current-password" {...register('password')} />}
          </Field>
          <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
            Sign in
          </Button>
        </form>

        <div className="my-5 flex items-center gap-3 text-xs text-slate-500" aria-hidden="true">
          <span className="h-px flex-1 bg-slate-200" />
          or
          <span className="h-px flex-1 bg-slate-200" />
        </div>
        <Button variant="secondary" className="w-full" size="lg" onClick={onGoogle} loading={googleBusy}>
          Continue with Google
        </Button>
      </Card>
    </div>
  )
}
