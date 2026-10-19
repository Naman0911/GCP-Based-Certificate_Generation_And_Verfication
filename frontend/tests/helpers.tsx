import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { RouterProvider } from 'react-router-dom'
import { vi } from 'vitest'

import { createTestRouter } from '@/app/router'
import { ToastProvider } from '@/components/feedback/ToastProvider'
import { AuthProvider } from '@/features/auth/AuthProvider'
import type { AuthClient, AuthUser } from '@/types/auth'
import type { CertificateDetail, CertificateSummary, VerificationResult } from '@/types/certificate'

export const ID = 'CERT-2026-0123456789ABCDEF0123'
export const ID2 = 'CERT-2026-ABCDEF01234567890123'

export const adminUser: AuthUser = { uid: 'u1', email: 'admin@example.test', displayName: 'Ada Admin', providerId: 'password', lastSignInTime: '2026-10-15T09:00:00Z' }

export interface FakeAuth extends AuthClient {
  emit(user: AuthUser | null): void
  signIn: ReturnType<typeof vi.fn>
}

export function makeAuth(initial: AuthUser | null = null, opts: { adminClaim?: boolean } = {}): FakeAuth {
  let current = initial
  const listeners = new Set<(u: AuthUser | null) => void>()
  const fake: FakeAuth = {
    subscribe(listener) {
      listeners.add(listener)
      queueMicrotask(() => listener(current))
      return () => listeners.delete(listener)
    },
    signIn: vi.fn(async () => undefined),
    signInWithPassword: vi.fn(async (email: string, password: string) => {
      await fake.signIn(email, password)
      current = { ...adminUser, email }
      listeners.forEach((l) => l(current))
    }),
    signInWithGoogle: vi.fn(async () => undefined),
    signOut: vi.fn(async () => {
      current = null
      listeners.forEach((l) => l(null))
    }),
    getIdToken: vi.fn(async () => (current ? 'token' : null)),
    hasAdminClaim: vi.fn(async () => opts.adminClaim ?? false),
    emit(user) {
      current = user
      listeners.forEach((l) => l(user))
    },
  }
  return fake
}

export function summary(overrides: Partial<CertificateSummary> = {}): CertificateSummary {
  return {
    certificate_id: ID,
    recipient_name: 'Asha Verma',
    recipient_email: 'asha@example.test',
    course_name: 'Cloud Architecture',
    organization_name: 'Example Academy',
    issue_date: '2026-10-15T09:00:00Z',
    expiry_date: null,
    status: 'VALID',
    effective_status: 'VALID',
    created_at: '2026-10-15T09:00:00Z',
    created_by: 'u1',
    revoked_at: null,
    ...overrides,
  }
}

export function detail(overrides: Partial<CertificateDetail> = {}): CertificateDetail {
  return {
    ...summary(),
    pdf_sha256: 'a'.repeat(64),
    metadata_sha256: 'b'.repeat(64),
    signature_algorithm: 'RSA_SIGN_PKCS1_3072_SHA256',
    kms_key_version: 'projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1',
    revoked_by: null,
    revocation_reason: null,
    ...overrides,
  }
}

export function verification(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return {
    certificate_id: ID,
    record_found: true,
    status: 'VALID',
    certificate_status: 'VALID',
    metadata_signature_valid: true,
    pdf_integrity_verified: null,
    message: 'Certificate record and metadata signature verified',
    verified_at: '2026-10-15T09:30:00Z',
    certificate: {
      certificate_id: ID,
      recipient_name: 'Asha Verma',
      course_name: 'Cloud Architecture',
      organization_name: 'Example Academy',
      issue_date: '2026-10-15T09:00:00Z',
      expiry_date: null,
      status: 'VALID',
      revoked_at: null,
    },
    ...overrides,
  }
}

export function renderRoute(route: string, auth: AuthClient, probeAdmin: () => Promise<boolean> = async () => true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })
  const router = createTestRouter([route])
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider client={auth} probeAdmin={probeAdmin}>
          <RouterProvider router={router} />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { ...utils, router, queryClient }
}

/** Minimal Response for fetch mocks. */
export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

export function pdfFile(name = 'certificate.pdf', size = 200): File {
  const content = '%PDF-1.4\n' + 'x'.repeat(Math.max(0, size - 9))
  return new File([content], name, { type: 'application/pdf' })
}
