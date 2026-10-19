import { createBrowserRouter, createMemoryRouter, type RouteObject } from 'react-router-dom'

import { NotFoundPage } from '@/components/feedback/NotFoundPage'
import { AdminLayout } from '@/components/layout/AdminLayout'
import { PublicLayout } from '@/components/layout/PublicLayout'
import { LoginPage } from '@/features/auth/LoginPage'
import { ProfilePage } from '@/features/auth/ProfilePage'
import { ProtectedRoute } from '@/features/auth/ProtectedRoute'
import { UnauthorizedPage } from '@/features/auth/UnauthorizedPage'
import { CertificateDetailsPage } from '@/features/certificates/CertificateDetailsPage'
import { CertificatesListPage } from '@/features/certificates/CertificatesListPage'
import { IssueCertificatePage } from '@/features/certificates/IssueCertificatePage'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { LandingPage } from '@/features/verification/LandingPage'
import { VerifyPage } from '@/features/verification/VerifyPage'
import { VerifyResultPage } from '@/features/verification/VerifyResultPage'

export const routes: RouteObject[] = [
  {
    element: <PublicLayout />,
    children: [
      { index: true, element: <LandingPage /> },
      { path: 'verify', element: <VerifyPage /> },
      { path: 'verify/:certificateId', element: <VerifyResultPage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'unauthorized', element: <UnauthorizedPage /> },
    ],
  },
  {
    // Frontend role checks are UX only; the backend re-checks the token and admin role on every call.
    element: <ProtectedRoute requireAdmin />,
    children: [
      {
        path: 'admin',
        element: <AdminLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'certificates', element: <CertificatesListPage /> },
          { path: 'certificates/new', element: <IssueCertificatePage /> },
          { path: 'certificates/:certificateId', element: <CertificateDetailsPage /> },
          { path: 'profile', element: <ProfilePage /> },
        ],
      },
    ],
  },
  {
    element: <PublicLayout />,
    children: [{ path: '*', element: <NotFoundPage /> }],
  },
]

export const createAppRouter = () => createBrowserRouter(routes)
export const createTestRouter = (initialEntries: string[]) => createMemoryRouter(routes, { initialEntries })
