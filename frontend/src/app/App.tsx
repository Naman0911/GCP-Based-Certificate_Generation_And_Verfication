import { useMemo } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'

import { createQueryClient } from '@/app/queryClient'
import { createAppRouter } from '@/app/router'
import { ConfigErrorScreen } from '@/components/feedback/ConfigErrorScreen'
import { ErrorBoundary } from '@/components/feedback/ErrorBoundary'
import { ToastProvider } from '@/components/feedback/ToastProvider'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { createDemoAuthClient } from '@/features/auth/demoAuthClient'
import { configureApiClient } from '@/lib/apiClient'
import { env } from '@/lib/env'
import { createFirebaseAuthClient } from '@/lib/firebase'
import { certificateService } from '@/services/certificateService'

configureApiClient({ baseUrl: env.apiBaseUrl })

const authClient = env.demoMode ? createDemoAuthClient() : createFirebaseAuthClient()
const probeAdmin = () => certificateService.probeAdmin()

export function App() {
  const queryClient = useMemo(() => createQueryClient(), [])
  const router = useMemo(() => createAppRouter(), [])

  if (env.configErrors.length > 0) return <ConfigErrorScreen errors={env.configErrors} />

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider client={authClient} probeAdmin={probeAdmin}>
            <RouterProvider router={router} />
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
