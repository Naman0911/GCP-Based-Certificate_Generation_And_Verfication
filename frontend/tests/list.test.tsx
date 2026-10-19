import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/lib/apiClient'
import { svc } from './serviceMock'
import { ID, ID2, adminUser, detail, makeAuth, renderRoute, summary } from './helpers'

vi.mock('@/services/certificateService', async () => ({ certificateService: (await import('./serviceMock')).svc }))

const second = summary({ certificate_id: ID2, recipient_name: 'Ravi Kumar', course_name: 'Data Engineering', effective_status: 'REVOKED', status: 'REVOKED', revoked_at: '2026-10-15T12:00:00Z' })

beforeEach(() => {
  Object.values(svc).forEach((fn) => fn.mockReset())
  svc.listCertificates.mockResolvedValue({ items: [summary(), second], next_page_token: null })
})

const open = (route = '/admin/certificates') => renderRoute(route, makeAuth(adminUser, { adminClaim: true }))
const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)

describe('certificate list', { timeout: 15000 }, () => {
  it('shows a skeleton, then rows with status text and actions', async () => {
    let release: (v: unknown) => void = () => undefined
    svc.listCertificates.mockReturnValue(new Promise((r) => (release = r)))
    open()
    expect(await screen.findByText(/loading certificates/i)).toBeInTheDocument()
    release({ items: [summary(), second], next_page_token: null })
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(rows()).toHaveLength(2)
    const first = rows()[0]
    expect(within(first).getByText('Asha Verma')).toBeInTheDocument()
    expect(within(first).getByText('Valid')).toBeInTheDocument()
    expect(within(first).getByRole('link', { name: /view asha verma/i })).toHaveAttribute('href', `/admin/certificates/${ID}`)
    expect(within(first).getByRole('button', { name: /download asha verma/i })).toBeInTheDocument()
    expect(within(first).getByRole('button', { name: /revoke asha verma/i })).toBeInTheDocument()
    // already revoked: no revoke action
    expect(within(rows()[1]).queryByRole('button', { name: /revoke/i })).not.toBeInTheDocument()
    expect(within(rows()[1]).getByText('Revoked')).toBeInTheDocument()
  })

  it('filters by status through the API', async () => {
    open()
    await screen.findByRole('table')
    svc.listCertificates.mockResolvedValue({ items: [second], next_page_token: null })
    await userEvent.selectOptions(screen.getByLabelText(/filter by status/i), 'REVOKED')
    await waitFor(() => expect(svc.listCertificates).toHaveBeenLastCalledWith({ pageSize: 25, pageToken: null, status: 'REVOKED' }, expect.anything()))
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(within(rows()[0]).getByText('Ravi Kumar')).toBeInTheDocument()
  })

  it('searches the loaded page by name, ID and course and offers to clear', async () => {
    open()
    await screen.findByRole('table')
    const search = screen.getByRole('searchbox')
    await userEvent.type(search, 'data eng')
    expect(rows()).toHaveLength(1)
    await userEvent.clear(search)
    await userEvent.type(search, ID.toLowerCase())
    expect(rows()).toHaveLength(1)
    await userEvent.clear(search)
    await userEvent.type(search, 'zzz-no-match')
    expect(await screen.findByText(/no certificates match/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /clear filters/i }))
    expect(rows()).toHaveLength(2)
  })

  it('paginates with cursor tokens, forwards and back', async () => {
    svc.listCertificates
      .mockResolvedValueOnce({ items: [summary()], next_page_token: 'TOKEN-2' })
      .mockResolvedValueOnce({ items: [second], next_page_token: null })
      .mockResolvedValue({ items: [summary()], next_page_token: 'TOKEN-2' })
    open()
    await screen.findByRole('table')
    const next = screen.getByRole('button', { name: /next/i })
    const prev = screen.getByRole('button', { name: /previous/i })
    expect(prev).toBeDisabled()
    await userEvent.click(next)
    await waitFor(() => expect(svc.listCertificates).toHaveBeenLastCalledWith({ pageSize: 25, pageToken: 'TOKEN-2', status: null }, expect.anything()))
    expect(await screen.findByText(/page 2/i)).toBeInTheDocument()
    await waitFor(() => expect(within(rows()[0]).getByText('Ravi Kumar')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled() // last page
    await userEvent.click(screen.getByRole('button', { name: /previous/i }))
    expect(await screen.findByText(/page 1/i)).toBeInTheDocument()
  })

  it('changing the page size restarts from the first page', async () => {
    open()
    await screen.findByRole('table')
    await userEvent.selectOptions(screen.getByLabelText(/rows per page/i), '50')
    await waitFor(() => expect(svc.listCertificates).toHaveBeenLastCalledWith({ pageSize: 50, pageToken: null, status: null }, expect.anything()))
  })

  it('shows an empty state with a call to action', async () => {
    svc.listCertificates.mockResolvedValue({ items: [], next_page_token: null })
    open()
    expect(await screen.findByText(/no certificates yet/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /issue the first certificate/i })).toBeInTheDocument()
  })

  it('shows an error with a working retry', async () => {
    svc.listCertificates.mockRejectedValue(new ApiError({ status: 500, code: 'internal_error', message: 'x', requestId: 'req-5' }))
    open()
    expect(await screen.findByText(/certificates could not be loaded/i, undefined, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByText(/req-5/)).toBeInTheDocument()
    svc.listCertificates.mockResolvedValue({ items: [summary()], next_page_token: null })
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
  })
})

describe('revocation', () => {
  it('requires confirmation and a reason; cancel does nothing', async () => {
    open()
    await screen.findByRole('table')
    await userEvent.click(within(rows()[0]).getByRole('button', { name: /revoke asha verma/i }))
    const dialog = await screen.findByRole('dialog', { name: /revoke this certificate/i })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByLabelText(/reason for revocation/i)).toHaveFocus()
    await userEvent.click(within(dialog).getByRole('button', { name: /revoke certificate/i }))
    expect(await within(dialog).findByText(/at least 3 characters/i)).toBeInTheDocument()
    expect(svc.revokeCertificate).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: /^cancel$/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(svc.revokeCertificate).not.toHaveBeenCalled()
  })

  it('Escape closes the dialog and returns focus to the trigger', async () => {
    open()
    await screen.findByRole('table')
    const trigger = within(rows()[0]).getByRole('button', { name: /revoke asha verma/i })
    await userEvent.click(trigger)
    await screen.findByRole('dialog')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('sends the reason, refreshes the list and confirms with a toast', async () => {
    svc.revokeCertificate.mockResolvedValue(detail({ status: 'REVOKED', effective_status: 'REVOKED', revoked_at: '2026-10-15T13:00:00Z', revocation_reason: 'Issued in error' }))
    open()
    await screen.findByRole('table')
    await userEvent.click(within(rows()[0]).getByRole('button', { name: /revoke asha verma/i }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText(/reason for revocation/i), '  Issued in error  ')
    svc.listCertificates.mockResolvedValue({ items: [summary({ status: 'REVOKED', effective_status: 'REVOKED' }), second], next_page_token: null })
    await userEvent.click(within(dialog).getByRole('button', { name: /revoke certificate/i }))
    await waitFor(() => expect(svc.revokeCertificate).toHaveBeenCalledWith(ID, 'Issued in error'))
    expect(await screen.findByText(new RegExp(`${ID} was revoked`))).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(within(rows()[0]).getByText('Revoked')).toBeInTheDocument())
  })

  it.each([
    [409, 'Certificate is already revoked.', /already revoked/i],
    [403, 'no', /permission/i],
    [404, 'Certificate not found.', /not found/i],
  ])('keeps the dialog open and explains a %i error', async (status, message, text) => {
    svc.revokeCertificate.mockRejectedValue(new ApiError({ status, code: 'x', message }))
    open()
    await screen.findByRole('table')
    await userEvent.click(within(rows()[0]).getByRole('button', { name: /revoke asha verma/i }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText(/reason for revocation/i), 'Duplicate')
    await userEvent.click(within(dialog).getByRole('button', { name: /revoke certificate/i }))
    expect((await within(dialog).findByRole('alert')).textContent ?? '').toMatch(text)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('details page', () => {
  it('shows metadata, status, integrity data, links, and revoke from details', async () => {
    svc.getCertificate.mockResolvedValue(detail())
    open(`/admin/certificates/${ID}`)
    expect(await screen.findByRole('heading', { name: 'Asha Verma' })).toBeInTheDocument()
    expect(screen.getByText('Valid')).toBeInTheDocument()
    expect(screen.getByText('a'.repeat(64))).toBeInTheDocument()
    expect(screen.getByText('RSA_SIGN_PKCS1_3072_SHA256')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy certificate id/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy verification link/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^revoke$/i }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('shows revocation details and hides the revoke button for revoked certificates', async () => {
    svc.getCertificate.mockResolvedValue(detail({ status: 'REVOKED', effective_status: 'REVOKED', revoked_at: '2026-10-15T12:00:00Z', revoked_by: 'u9', revocation_reason: 'Issued in error' }))
    open(`/admin/certificates/${ID}`)
    expect(await screen.findByText(/this certificate is revoked/i)).toBeInTheDocument()
    expect(screen.getByText(/issued in error/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^revoke$/i })).not.toBeInTheDocument()
  })

  it('handles 404 and runs the live verification check separately from the PDF', async () => {
    svc.getCertificate.mockRejectedValueOnce(new ApiError({ status: 404, code: 'not_found', message: 'Certificate not found.' }))
    const { unmount } = open(`/admin/certificates/${ID2}`)
    expect(await screen.findByText(/certificate not found/i)).toBeInTheDocument()
    unmount()

    svc.getCertificate.mockResolvedValue(detail())
    svc.verifyCertificate.mockResolvedValue({
      certificate_id: ID, record_found: true, status: 'VALID', certificate_status: 'VALID', metadata_signature_valid: true, pdf_integrity_verified: null, message: 'ok', verified_at: null, certificate: null,
    })
    open(`/admin/certificates/${ID}`)
    await userEvent.click(await screen.findByRole('button', { name: /run check/i }))
    expect(await screen.findByText(/the pdf file has not been checked/i)).toBeInTheDocument()
  })
})
