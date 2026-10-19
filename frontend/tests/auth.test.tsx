import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiRequest, configureApiClient } from '@/lib/apiClient'
import { describeAuthError } from '@/lib/firebase'
import { certificateListSchema } from '@/types/certificate'
import { svc } from './serviceMock'
import { adminUser, jsonResponse, makeAuth, renderRoute, summary } from './helpers'

vi.mock('@/services/certificateService', async () => ({ certificateService: (await import('./serviceMock')).svc }))

beforeEach(() => {
  Object.values(svc).forEach((fn) => fn.mockReset())
  svc.listCertificates.mockResolvedValue({ items: [summary()], next_page_token: null })
  svc.getStats.mockResolvedValue({ total: 1, valid: 1, revoked: 0, expired: 0, truncated: false })
})

describe('login', () => {
  it('validates the form before calling the auth provider', async () => {
    const auth = makeAuth(null)
    renderRoute('/login', auth)
    await userEvent.click(await screen.findByRole('button', { name: /^sign in$/i }))
    expect(await screen.findByText(/enter your email address/i)).toBeInTheDocument()
    expect(screen.getByText(/enter your password/i)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/email/i), 'not-an-email')
    await userEvent.type(screen.getByLabelText(/password/i), 'x')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    expect(await screen.findByText(/valid email address/i)).toBeInTheDocument()
    expect(auth.signInWithPassword).not.toHaveBeenCalled()
  })

  it('shows a safe message for wrong credentials', async () => {
    const auth = makeAuth(null)
    auth.signIn.mockRejectedValue({ code: 'auth/invalid-credential' })
    renderRoute('/login', auth)
    await userEvent.type(await screen.findByLabelText(/email/i), 'admin@example.test')
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    expect(await screen.findByText(/email or password is incorrect/i)).toBeInTheDocument()
  })

  it('signs in and lands on the admin dashboard', async () => {
    const auth = makeAuth(null, { adminClaim: true })
    renderRoute('/login', auth)
    await userEvent.type(await screen.findByLabelText(/email/i), 'admin@example.test')
    await userEvent.type(screen.getByLabelText(/password/i), 'secret')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    expect(await screen.findByRole('heading', { name: /^dashboard$/i })).toBeInTheDocument()
  })

  it('returns to the originally requested page after login', async () => {
    const auth = makeAuth(null, { adminClaim: true })
    const { router } = renderRoute('/admin/certificates', auth)
    await userEvent.type(await screen.findByLabelText(/email/i), 'a@example.test')
    await userEvent.type(screen.getByLabelText(/password/i), 'pw')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    await screen.findByRole('heading', { name: /^certificates$/i })
    expect(router.state.location.pathname).toBe('/admin/certificates')
  })

  it('a 401 that survives a token refresh ends the session and explains why', async () => {
    const auth = makeAuth(adminUser, { adminClaim: true })
    renderRoute('/admin', auth)
    await screen.findByRole('heading', { name: /^dashboard$/i })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'unauthorized', message: 'expired', request_id: 'r' } }, 401)))
    configureApiClient({ baseUrl: 'https://api.test', getToken: (force) => auth.getIdToken(force) })
    await apiRequest({ path: '/admin/certificates', auth: true, schema: certificateListSchema }).catch(() => undefined)
    expect(await screen.findByRole('heading', { name: /administrator sign in/i })).toBeInTheDocument()
    expect(screen.getByText(/your session ended/i)).toBeInTheDocument()
    expect(auth.signOut).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('a 403 from an admin call removes admin access in the UI', async () => {
    const auth = makeAuth(adminUser, { adminClaim: true })
    const { router } = renderRoute('/admin', auth)
    await screen.findByRole('heading', { name: /^dashboard$/i })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'forbidden', message: 'no', request_id: 'r' } }, 403)))
    configureApiClient({ baseUrl: 'https://api.test', getToken: (force) => auth.getIdToken(force) })
    await apiRequest({ path: '/admin/certificates', auth: true, schema: certificateListSchema }).catch(() => undefined)
    await waitFor(() => expect(router.state.location.pathname).toBe('/unauthorized'))
    vi.unstubAllGlobals()
  })

  it('sign out returns to the login page', async () => {
    const auth = makeAuth(adminUser, { adminClaim: true })
    renderRoute('/admin/profile', auth)
    await userEvent.click((await screen.findAllByRole('button', { name: /^sign out$/i }))[0])
    await waitFor(() => expect(auth.signOut).toHaveBeenCalled())
    expect(await screen.findByRole('heading', { name: /administrator sign in/i })).toBeInTheDocument()
  })

  it('maps provider error codes to safe messages', () => {
    expect(describeAuthError({ code: 'auth/too-many-requests' })).toMatch(/too many/i)
    expect(describeAuthError({ code: 'auth/unauthorized-domain' })).toMatch(/authorized domains/i)
    expect(describeAuthError(new Error('internal detail'))).toBe('Sign-in failed. Please try again.')
  })
})
