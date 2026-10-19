import { useEffect } from 'react'
import { LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/Button'
import { Card, CardHeader, PageHeader } from '@/components/ui/Card'
import { useAuth } from '@/features/auth/AuthContext'
import { formatDate } from '@/lib/utils'

export function ProfilePage() {
  const { user, role, signOut } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    document.title = 'Profile – CertiTrust'
  }, [])

  const rows: Array<[string, string]> = [
    ['Email', user?.email ?? '—'],
    ['Name', user?.displayName ?? '—'],
    ['Sign-in method', user?.providerId ?? '—'],
    ['Role', role === 'admin' ? 'Administrator' : 'Not an administrator'],
    ['Last sign-in', user?.lastSignInTime ? formatDate(user.lastSignInTime, true) : '—'],
    ['User ID', user?.uid ?? '—'],
  ]

  return (
    <div>
      <PageHeader title="Profile" />
      <Card className="max-w-2xl">
        <CardHeader title="Your account" description="Your role is confirmed by the server on every request." />
        <dl className="divide-y divide-slate-100 px-5">
          {rows.map(([label, value]) => (
            <div key={label} className="flex flex-wrap justify-between gap-2 py-3 text-sm">
              <dt className="font-medium text-slate-700">{label}</dt>
              <dd className="break-all text-navy-900">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="border-t border-slate-100 p-5">
          <Button
            variant="secondary"
            icon={<LogOut className="size-4" aria-hidden="true" />}
            onClick={async () => {
              await signOut()
              navigate('/login', { replace: true })
            }}
          >
            Sign out
          </Button>
        </div>
      </Card>
    </div>
  )
}
