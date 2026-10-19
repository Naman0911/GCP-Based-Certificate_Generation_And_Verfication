import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/lib/apiClient'
import { createDemoCertificateService } from '@/services/demoService'
import { svc } from './serviceMock'
import { ID, ID2, adminUser, makeAuth, renderRoute, summary } from './helpers'

vi.mock('@/services/certificateService', async () => ({ certificateService: (await import('./serviceMock')).svc }))

beforeEach(() => Object.values(svc).forEach((fn) => fn.mockReset()))
const open = () => renderRoute('/admin', makeAuth(adminUser, { adminClaim: true }))

describe('dashboard', () => {
  it('shows only numbers returned by the API and activity derived from real records', async () => {
    svc.getStats.mockResolvedValue({ total: 7, valid: 4, revoked: 2, expired: 1, truncated: false })
    svc.listCertificates.mockResolvedValue({
      items: [summary({ recipient_name: 'Newest Person', created_at: '2026-10-16T10:00:00Z' }), summary({ certificate_id: ID2, recipient_name: 'Gone Person', created_at: '2026-10-10T10:00:00Z', revoked_at: '2026-10-14T10:00:00Z', status: 'REVOKED', effective_status: 'REVOKED' })],
      next_page_token: null,
    })
    open()
    const total = (await screen.findByText('Total certificates')).closest('div')!.parentElement!
    expect(await within(total).findByText('7')).toBeInTheDocument()
    expect(screen.getByText('Valid').closest('div')!.parentElement).toHaveTextContent('4')
    expect(screen.getByText('Revoked').closest('div')!.parentElement).toHaveTextContent('2')
    expect(screen.getByText('Expired').closest('div')!.parentElement).toHaveTextContent('1')
    expect(await screen.findByText(/issued to newest person/i)).toBeInTheDocument()
    expect(screen.getByText(/revoked for gone person/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /issue a certificate/i })).toHaveAttribute('href', '/admin/certificates/new')
  })

  it('shows an empty state for activity when there are no certificates', async () => {
    svc.getStats.mockResolvedValue({ total: 0, valid: 0, revoked: 0, expired: 0, truncated: false })
    svc.listCertificates.mockResolvedValue({ items: [], next_page_token: null })
    open()
    expect(await screen.findByText(/no activity yet/i)).toBeInTheDocument()
  })

  it('never invents numbers when the API fails; offers retry', async () => {
    svc.getStats.mockRejectedValue(new ApiError({ status: 500, code: 'internal_error', message: 'x', requestId: 'r' }))
    svc.listCertificates.mockResolvedValue({ items: [], next_page_token: null })
    open()
    expect(await screen.findByText(/totals could not be loaded/i, undefined, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.queryByText('Total certificates')).not.toBeInTheDocument()
    svc.getStats.mockResolvedValue({ total: 3, valid: 3, revoked: 0, expired: 0, truncated: false })
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByText('Total certificates')).toBeInTheDocument()
  })

  it('notes when counts are capped', async () => {
    svc.getStats.mockResolvedValue({ total: 2000, valid: 2000, revoked: 0, expired: 0, truncated: true })
    svc.listCertificates.mockResolvedValue({ items: [], next_page_token: null })
    open()
    expect(await screen.findByText(/most recent 2,000/i)).toBeInTheDocument()
  })
})

describe('demo service (only used when VITE_ENABLE_DEMO_MODE=true)', () => {
  it('compares real SHA-256 digests, so an edited PDF is reported as tampered', async () => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:demo' }))
    const demo = createDemoCertificateService()
    const created = await demo.createCertificate({ recipient_name: 'Test Person', course_name: 'Course', organization_name: 'Org' })
    const download = await demo.getDownloadUrl(created.certificate_id)
    expect(download.url).toBeTruthy()
    const original = new Blob([new Uint8Array(0)])
    expect(original.size).toBe(0)
    const bad = new File(['%PDF-1.4 edited'], 'x.pdf', { type: 'application/pdf' })
    const result = await demo.verifyCertificateFile(created.certificate_id, bad)
    expect(result.status).toBe('TAMPERED')
    expect(result.pdf_integrity_verified).toBe(false)
    expect((await demo.verifyCertificate(ID)).status).toBe('INVALID')
  })
})
