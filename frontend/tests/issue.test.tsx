import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { issueSchema, endOfDayIso } from '@/features/certificates/issueSchema'
import { ApiError } from '@/lib/apiClient'
import { svc } from './serviceMock'
import { ID, adminUser, makeAuth, renderRoute, summary } from './helpers'

vi.mock('@/services/certificateService', async () => ({ certificateService: (await import('./serviceMock')).svc }))

const created = {
  certificate_id: ID,
  verification_url: `https://verify.example.org/verify/${ID}`,
  certificate: summary(),
  download_path: `/admin/certificates/${ID}/download`,
  download: { url: 'https://storage.example/signed', expires_at: '2026-10-15T10:00:00Z' },
}

beforeEach(() => {
  Object.values(svc).forEach((fn) => fn.mockReset())
  window.localStorage.clear()
})

const open = () => renderRoute('/admin/certificates/new', makeAuth(adminUser, { adminClaim: true }))

async function fill(overrides: Partial<Record<'name' | 'email' | 'course' | 'org', string>> = {}) {
  const v = { name: 'Asha Verma', email: '', course: 'Cloud Architecture', org: 'Example Academy', ...overrides }
  if (v.name) await userEvent.type(await screen.findByLabelText(/recipient name/i), v.name)
  if (v.email) await userEvent.type(screen.getByLabelText(/recipient email/i), v.email)
  if (v.course) await userEvent.type(screen.getByLabelText(/course or achievement/i), v.course)
  if (v.org) await userEvent.type(screen.getByLabelText(/issuing organization/i), v.org)
}

describe('issue form validation (schema)', () => {
  const base = { recipient_name: 'A', recipient_email: '', course_name: 'C', organization_name: 'O', expiry_date: '' }
  it('accepts minimal valid data', () => expect(issueSchema.safeParse(base).success).toBe(true))
  it('enforces required fields and max lengths', () => {
    expect(issueSchema.safeParse({ ...base, recipient_name: '  ' }).success).toBe(false)
    expect(issueSchema.safeParse({ ...base, recipient_name: 'x'.repeat(121) }).success).toBe(false)
    expect(issueSchema.safeParse({ ...base, course_name: 'x'.repeat(201) }).success).toBe(false)
    expect(issueSchema.safeParse({ ...base, organization_name: 'x'.repeat(201) }).success).toBe(false)
  })
  it('validates email only when provided', () => {
    expect(issueSchema.safeParse({ ...base, recipient_email: 'nope' }).success).toBe(false)
    expect(issueSchema.safeParse({ ...base, recipient_email: 'a@b.co' }).success).toBe(true)
  })
  it('requires a future expiry date and rejects control characters', () => {
    expect(issueSchema.safeParse({ ...base, expiry_date: '2000-01-01' }).success).toBe(false)
    expect(issueSchema.safeParse({ ...base, expiry_date: '2999-01-01' }).success).toBe(true)
    expect(issueSchema.safeParse({ ...base, recipient_name: 'bad\u0007' }).success).toBe(false)
    expect(issueSchema.safeParse({ ...base, recipient_name: 'x‮y' }).success).toBe(false)
  })
  it('converts the expiry day to the end of that day with whole seconds', () => {
    const iso = endOfDayIso('2999-05-06')
    expect(iso).toMatch(/:59\.000Z$|:59\.000Z/)
    expect(new Date(iso).getTime()).toBeGreaterThan(Date.now())
  })
})

describe('issue certificate page', () => {
  it('shows field errors and does not call the API when invalid', async () => {
    open()
    await userEvent.click(await screen.findByRole('button', { name: /issue certificate/i }))
    expect(await screen.findByText(/enter the recipient name/i)).toBeInTheDocument()
    expect(screen.getByText(/enter the course or achievement/i)).toBeInTheDocument()
    expect(screen.getByText(/enter the issuing organization/i)).toBeInTheDocument()
    expect(svc.createCertificate).not.toHaveBeenCalled()
  })

  it('explains that the issue date is assigned by the server (no unsupported field is sent)', async () => {
    svc.createCertificate.mockResolvedValue(created)
    open()
    expect(await screen.findByText(/set automatically when issued/i)).toBeInTheDocument()
    await fill({ email: 'asha@example.test' })
    await userEvent.click(screen.getByRole('button', { name: /issue certificate/i }))
    await waitFor(() => expect(svc.createCertificate).toHaveBeenCalledTimes(1))
    expect(svc.createCertificate.mock.calls[0][0]).toEqual({
      recipient_name: 'Asha Verma',
      recipient_email: 'asha@example.test',
      course_name: 'Cloud Architecture',
      organization_name: 'Example Academy',
      expiry_date: null,
    })
  })

  it('shows the ID, verification URL and a download action on success', async () => {
    svc.createCertificate.mockResolvedValue(created)
    svc.getDownloadUrl.mockResolvedValue({ certificate_id: ID, url: 'https://storage.example/fresh', expires_at: null })
    open()
    await fill()
    await userEvent.click(screen.getByRole('button', { name: /issue certificate/i }))
    expect(await screen.findByRole('heading', { name: /certificate was created and signed/i })).toBeInTheDocument()
    expect(screen.getByText(ID)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: created.verification_url })).toHaveAttribute('href', created.verification_url)
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    await userEvent.click(screen.getByRole('button', { name: /download pdf/i }))
    await waitFor(() => expect(svc.getDownloadUrl).toHaveBeenCalledWith(ID))
    await waitFor(() => expect(click).toHaveBeenCalled())
    expect(window.localStorage.getItem('certitrust.lastOrganization')).toBe('Example Academy')
  })

  it('maps server 422 details onto the matching fields', async () => {
    svc.createCertificate.mockRejectedValue(
      new ApiError({ status: 422, code: 'validation_error', message: 'Invalid.', details: [{ field: 'body.recipient_email', message: 'value is not a valid email address' }] }),
    )
    open()
    await fill()
    await userEvent.click(screen.getByRole('button', { name: /issue certificate/i }))
    expect(await screen.findByText(/value is not a valid email address/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/recipient email/i)).toHaveAttribute('aria-invalid', 'true')
  })

  it.each([
    [500, /something went wrong on the server/i],
    [403, /permission/i],
    [409, /conflict/i],
  ])('shows a safe error for a %i response', async (status, text) => {
    svc.createCertificate.mockRejectedValue(new ApiError({ status, code: 'x', message: status === 409 ? 'ID conflict, retry.' : 'raw internals', requestId: 'req-7' }))
    open()
    await fill()
    await userEvent.click(screen.getByRole('button', { name: /issue certificate/i }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent ?? '').toMatch(text)
    expect(alert.textContent ?? '').not.toMatch(/raw internals/)
  })

  it('prevents duplicate submissions while the request is in flight', async () => {
    let resolve: (v: unknown) => void = () => undefined
    svc.createCertificate.mockReturnValue(new Promise((r) => (resolve = r)))
    open()
    await fill()
    const button = screen.getByRole('button', { name: /issue certificate/i })
    await userEvent.click(button)
    await waitFor(() => expect(screen.getByRole('button', { name: /issuing/i })).toBeDisabled())
    await userEvent.click(screen.getByRole('button', { name: /issuing/i }))
    await userEvent.keyboard('{Enter}')
    expect(svc.createCertificate).toHaveBeenCalledTimes(1)
    resolve(created)
    expect(await screen.findByRole('heading', { name: /certificate was created and signed/i })).toBeInTheDocument()
  })

  it('"Issue another" resets the form', async () => {
    svc.createCertificate.mockResolvedValue(created)
    open()
    await fill()
    await userEvent.click(screen.getByRole('button', { name: /issue certificate/i }))
    await userEvent.click(await screen.findByRole('button', { name: /issue another/i }))
    const form = await screen.findByLabelText(/recipient name/i)
    expect(form).toHaveValue('')
    expect(within(document.body).getByLabelText(/issuing organization/i)).toHaveValue('Example Academy')
  })
})
