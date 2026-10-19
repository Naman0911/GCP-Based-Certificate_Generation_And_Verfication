import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { Alert } from '@/components/feedback/Alert'
import { FullPageSpinner } from '@/components/feedback/States'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/features/auth/AuthContext'

/**
 * Route guard. This is a UX convenience only: the backend independently verifies the token and the
 * administrator role on every /admin request, so bypassing this component grants no access.
 */
export function ProtectedRoute({ requireAdmin = true }: { requireAdmin?: boolean }) {
  const { status, role, roleError, retryRole, signOut } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <FullPageSpinner label="Checking your session…" />
  if (status === 'unauthenticated') return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />

  if (requireAdmin) {
    if (role === 'none') return <Navigate to="/unauthorized" replace />
    if (role === 'unknown') {
      if (roleError) {
        return (
          <div className="mx-auto max-w-md px-4 py-16">
            <Alert tone="error" title="Could not check your permissions">
              <p>{roleError}</p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={retryRole}>
                  Try again
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void signOut()}>
                  Sign out
                </Button>
              </div>
            </Alert>
          </div>
        )
      }
      return <FullPageSpinner label="Checking your permissions…" />
    }
  }
  return <Outlet />
}
