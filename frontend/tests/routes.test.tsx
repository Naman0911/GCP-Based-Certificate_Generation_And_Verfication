import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/lib/apiClient'
import { svc } from './serviceMock'
import { adminUser, makeAuth, renderRoute, summary } from './helpers'

vi.mock('@/services/certificateService', async () => ({ certificateService: (await import('./serviceMock')).svc }))

beforeEach(() => {
  Object.values(svc).forEach((fn) => fn.mockReset())
  svc.listCertificates.mockResolvedValue({ items: [summary()], next_page_token: null })
  svc.getStats.mockResolvedValue({ total: 1, valid: 1, revoked: 0, expired: 0, truncated: false })
})

describe('route protection', () => {
  it('public pages render without signing in', async () => {
    renderRoute('/', makeAuth(null))
    expect(await screen.findByRole('heading', { name: /verify a certificate in seconds/i })).toBeInTheDocument()
  })

  it('unauthenticated users are redirected from /admin to /login', async () => {
    const { router } = renderRoute('/admin/certificates', makeAuth(null))
    expect(await screen.findByRole('heading', { name: /administrator sign in/i })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(svc.listCertificates).not.toHaveBeenCalled()
  })

  it('shows a loading state while the session is being restored', () => {
    const auth = makeAuth(null)
    auth.subscribe = () => () => undefined // never reports a user
    renderRoute('/admin', auth)
    expect(screen.getByText(/checking your session/i)).toBeInTheDocument()
  })

  it('a signed-in account that the backend rejects (403) goes to /unauthorized', async () => {
    const { router } = renderRoute('/admin', makeAuth(adminUser), async () => false)
    expect(await screen.findByRole('heading', { name: /access denied/i })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/unauthorized')
  })

  it('an admin custom claim grants access without asking the backend', async () => {
    const probe = vi.fn(async () => false)
    renderRoute('/admin', makeAuth(adminUser, { adminClaim: true }), probe)
    expect(await screen.findByRole('heading', { name: /^dashboard$/i })).toBeInTheDocument()
    expect(probe).not.toHaveBeenCalled()
  })

  it('an allow-listed admin without the claim is accepted after the backend probe', async () => {
    renderRoute('/admin', makeAuth(adminUser), async () => true)
    expect(await screen.findByRole('heading', { name: /^dashboard$/i })).toBeInTheDocument()
  })

  it('if the role cannot be determined it offers a retry instead of granting access', async () => {
    const probe = vi.fn().mockRejectedValueOnce(new ApiError({ status: 0, code: 'network_error', message: 'x', kind: 'network' })).mockResolvedValue(true)
    renderRoute('/admin', makeAuth(adminUser), probe)
    expect(await screen.findByText(/could not check your permissions/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^dashboard$/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByRole('heading', { name: /^dashboard$/i })).toBeInTheDocument()
  })

  it('unknown URLs show the not-found page', async () => {
    renderRoute('/does/not/exist', makeAuth(null))
    expect(await screen.findByRole('heading', { name: /page not found/i })).toBeInTheDocument()
  })
})
