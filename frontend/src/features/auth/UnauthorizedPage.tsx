import { ShieldOff } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/Button'
import { useAuth } from '@/features/auth/AuthContext'

export function UnauthorizedPage() {
  const { status, signOut } = useAuth()
  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center">
      <div className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-red-50 text-red-700">
        <ShieldOff className="size-7" aria-hidden="true" />
      </div>
      <h1 className="text-2xl font-bold text-navy-900">Access denied</h1>
      <p className="mt-2 text-sm text-slate-600">
        Your account is signed in but is not an administrator, so it cannot manage certificates. Ask an administrator to grant access, or sign in with a different account.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link to="/verify" className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50">
          Verify a certificate
        </Link>
        {status === 'authenticated' && <Button onClick={() => void signOut()}>Sign out</Button>}
      </div>
    </div>
  )
}
