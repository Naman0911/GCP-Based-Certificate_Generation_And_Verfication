import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/lib/apiClient'
import { validatePdfFile } from '@/lib/files'
import { svc } from './serviceMock'
import { ID, makeAuth, pdfFile, renderRoute, verification } from './helpers'

vi.mock('@/services/certificateService', async () => ({ certificateService: (await import('./serviceMock')).svc }))

beforeEach(() => Object.values(svc).forEach((fn) => fn.mockReset()))

const open = (route: string) => renderRoute(route, makeAuth(null))

const notFound = verification({ record_found: false, status: 'INVALID', certificate_status: null, metadata_signature_valid: null, certificate: null, message: 'No certificate record exists with this ID' })

describe('landing page and ID entry', () => {
  it('navigates to the result page for a valid ID and rejects invalid input', async () => {
    svc.verifyCertificate.mockResolvedValue(verification())
    const { router } = open('/')
    const input = await screen.findByLabelText(/certificate id or link/i)
    await userEvent.type(input, 'CERT-bad')
    await userEvent.click(screen.getByRole('button', { name: /verify certificate/i }))
    expect(await screen.findByText(/enter a valid certificate id/i)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    await userEvent.clear(input)
    await userEvent.type(input, ID.toLowerCase())
    await userEvent.click(screen.getByRole('button', { name: /verify certificate/i }))
    await screen.findByTestId('verification-result')
    expect(router.state.location.pathname).toBe(`/verify/${ID}`)
    expect(svc.verifyCertificate).toHaveBeenCalledWith(ID, expect.anything())
  })
})

describe('result page: every status', () => {
  it('VALID by ID: record verified, and clearly says the PDF was NOT checked', async () => {
    svc.verifyCertificate.mockResolvedValue(verification())
    open(`/verify/${ID}`)
    const card = await screen.findByTestId('verification-result')
    expect(card).toHaveAttribute('data-status', 'VALID')
    expect(within(card).getByRole('heading', { name: /certificate record verified/i })).toBeInTheDocument()
    expect(within(card).getByText('Signature verified')).toBeInTheDocument()
    expect(within(card).getByText('Not checked')).toBeInTheDocument()
    expect(within(card).getByText(/the pdf file has not been checked/i)).toBeInTheDocument()
    expect(card.textContent).not.toMatch(/matches the issued|untampered|file verified/i)
    expect(within(card).getByText('Asha Verma')).toBeInTheDocument()
  })

  it('REVOKED', async () => {
    svc.verifyCertificate.mockResolvedValue(verification({ status: 'REVOKED', certificate_status: 'REVOKED', message: 'Certificate has been revoked' }))
    open(`/verify/${ID}`)
    const card = await screen.findByTestId('verification-result')
    expect(within(card).getByRole('heading', { name: /has been revoked/i })).toBeInTheDocument()
    expect(within(card).getAllByText('Revoked').length).toBeGreaterThan(0)
  })

  it('EXPIRED', async () => {
    svc.verifyCertificate.mockResolvedValue(verification({ status: 'EXPIRED', certificate_status: 'EXPIRED', message: 'Certificate has expired' }))
    open(`/verify/${ID}`)
    expect(await screen.findByRole('heading', { name: /has expired/i })).toBeInTheDocument()
  })

  it('TAMPERED (record signature failed): warns and does not show certificate details', async () => {
    svc.verifyCertificate.mockResolvedValue(verification({ status: 'TAMPERED', certificate_status: null, metadata_signature_valid: false, certificate: null, message: 'Record failed signature verification' }))
    open(`/verify/${ID}`)
    const card = await screen.findByTestId('verification-result')
    expect(within(card).getByRole('heading', { name: /integrity check failed/i })).toBeInTheDocument()
    expect(within(card).getByText('Signature does not match')).toBeInTheDocument()
    expect(within(card).getByText(/do not trust this certificate/i)).toBeInTheDocument()
    expect(within(card).queryByText('Certificate details')).not.toBeInTheDocument()
  })

  it('INVALID: unknown ID (HTTP 404 body) is shown as not found', async () => {
    svc.verifyCertificate.mockResolvedValue(notFound)
    open(`/verify/${ID}`)
    const card = await screen.findByTestId('verification-result')
    expect(card).toHaveAttribute('data-status', 'INVALID')
    expect(within(card).getByRole('heading', { name: /no matching certificate/i })).toBeInTheDocument()
    expect(screen.queryByText(/check the pdf file/i)).not.toBeInTheDocument()
  })

  it('malformed ID in the URL is rejected without calling the API', async () => {
    open('/verify/not-an-id')
    expect(await screen.findByText(/not a valid certificate id/i)).toBeInTheDocument()
    expect(svc.verifyCertificate).not.toHaveBeenCalled()
  })

  it.each([
    [500, /something went wrong on the server/i],
    [422, /not valid/i],
    [0, /could not reach the server/i],
  ])('API error %i is shown safely with a retry', async (status, text) => {
    const error = status === 0 ? new ApiError({ status: 0, code: 'network_error', message: 'x', kind: 'network' }) : new ApiError({ status, code: 'x', message: 'Some of the information is not valid.', requestId: 'r1' })
    svc.verifyCertificate.mockRejectedValue(error)
    open(`/verify/${ID}`)
    expect(await screen.findByText(text, undefined, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })
})

describe('PDF file verification on the result page', () => {
  async function upload(file: File) {
    open(`/verify/${ID}`)
    await screen.findByText(/check the pdf file/i)
    await userEvent.upload(screen.getByLabelText(/certificate pdf/i), file)
  }

  it('VALID with integrity true: reports the file separately from the record', async () => {
    svc.verifyCertificate.mockResolvedValue(verification())
    svc.verifyCertificateFile.mockResolvedValue(verification({ pdf_integrity_verified: true, message: 'Certificate record, metadata signature and PDF verified' }))
    await upload(pdfFile())
    await userEvent.click(screen.getByRole('button', { name: /verify pdf file/i }))
    await waitFor(() => expect(svc.verifyCertificateFile).toHaveBeenCalledWith(ID, expect.any(File)))
    const cards = await screen.findAllByTestId('verification-result')
    expect(cards).toHaveLength(2)
    expect(within(cards[0]).getByText('Not checked')).toBeInTheDocument() // ID check still says PDF not checked
    expect(within(cards[1]).getByRole('heading', { name: /certificate and file verified/i })).toBeInTheDocument()
    expect(within(cards[1]).getByText(/file matches the issued certificate/i)).toBeInTheDocument()
  })

  it('TAMPERED with integrity false', async () => {
    svc.verifyCertificate.mockResolvedValue(verification())
    svc.verifyCertificateFile.mockResolvedValue(verification({ status: 'TAMPERED', pdf_integrity_verified: false, message: 'Uploaded file does not match' }))
    await upload(pdfFile())
    await userEvent.click(screen.getByRole('button', { name: /verify pdf file/i }))
    const cards = await screen.findAllByTestId('verification-result')
    expect(within(cards[1]).getByRole('heading', { name: /integrity check failed/i })).toBeInTheDocument()
    expect(within(cards[1]).getByText(/file does not match the issued certificate/i)).toBeInTheDocument()
    expect(within(cards[1]).getByText(/may have been edited or replaced/i)).toBeInTheDocument()
  })

  it('REVOKED certificate with an unmodified file shows revoked AND file matches', async () => {
    svc.verifyCertificate.mockResolvedValue(verification())
    svc.verifyCertificateFile.mockResolvedValue(verification({ status: 'REVOKED', certificate_status: 'REVOKED', pdf_integrity_verified: true }))
    await upload(pdfFile())
    await userEvent.click(screen.getByRole('button', { name: /verify pdf file/i }))
    const cards = await screen.findAllByTestId('verification-result')
    expect(within(cards[1]).getByRole('heading', { name: /has been revoked/i })).toBeInTheDocument()
    expect(within(cards[1]).getByText(/file matches the issued certificate/i)).toBeInTheDocument()
  })

  it.each([
    ['not a PDF by name', new File(['%PDF-1.4'], 'notes.txt', { type: 'text/plain' }), /choose a pdf file/i],
    ['wrong content', new File(['hello world'], 'fake.pdf', { type: 'application/pdf' }), /does not look like a pdf/i],
    ['empty file', new File([], 'empty.pdf', { type: 'application/pdf' }), /is empty/i],
  ])('rejects %s before uploading', async (_name, file, text) => {
    svc.verifyCertificate.mockResolvedValue(verification())
    open(`/verify/${ID}`)
    await screen.findByText(/check the pdf file/i)
    await userEvent.upload(screen.getByLabelText(/certificate pdf/i), file, { applyAccept: false })
    expect(await screen.findByText(text)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /verify pdf file/i }))
    expect(await screen.findByText(/choose the pdf file to check/i)).toBeInTheDocument()
    expect(svc.verifyCertificateFile).not.toHaveBeenCalled()
  })

  it('rejects a file over the size limit client-side', async () => {
    const file = pdfFile('big.pdf', 100)
    Object.defineProperty(file, 'size', { value: 11 * 1024 * 1024 })
    expect(await validatePdfFile(file, 10 * 1024 * 1024)).toMatch(/maximum allowed size is 10\.0 MB/)
  })

  it.each([
    [413, 'Upload too large.', /too large/i],
    [422, 'The uploaded file is not a valid PDF.', /not a valid pdf/i],
    [404, 'Certificate not found.', /not found/i],
    [500, 'Internal error.', /something went wrong on the server/i],
  ])('shows the server error for upload status %i', async (status, message, text) => {
    svc.verifyCertificate.mockResolvedValue(verification())
    svc.verifyCertificateFile.mockRejectedValue(new ApiError({ status, code: 'x', message, requestId: 'r2' }))
    await upload(pdfFile())
    await userEvent.click(screen.getByRole('button', { name: /verify pdf file/i }))
    expect(await screen.findByText(text)).toBeInTheDocument()
    expect(screen.getAllByTestId('verification-result')).toHaveLength(1)
  })
})

describe('verify page (tabs)', () => {
  it('has ID, QR and PDF tabs with keyboard navigation', async () => {
    open('/verify')
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Certificate ID', 'Scan QR code', 'Upload PDF'])
    tabs[0].focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: /scan qr code/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /scan qr code/i })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: /upload pdf/i })).toHaveAttribute('aria-selected', 'true')
  })

  it('verifies an uploaded PDF by typed ID and shows the result', async () => {
    svc.verifyCertificateFile.mockResolvedValue(verification({ pdf_integrity_verified: true }))
    open('/verify')
    await userEvent.click(await screen.findByRole('tab', { name: /upload pdf/i }))
    await userEvent.type(screen.getByLabelText(/^certificate id/i), ID)
    await userEvent.upload(screen.getByLabelText(/certificate pdf/i), pdfFile())
    await userEvent.click(screen.getByRole('button', { name: /verify pdf file/i }))
    expect(await screen.findByRole('heading', { name: /certificate and file verified/i })).toBeInTheDocument()
    expect(svc.verifyCertificateFile).toHaveBeenCalledWith(ID, expect.any(File))
  })

  it('validates the ID before uploading', async () => {
    open('/verify')
    await userEvent.click(await screen.findByRole('tab', { name: /upload pdf/i }))
    await userEvent.upload(screen.getByLabelText(/certificate pdf/i), pdfFile())
    await userEvent.click(screen.getByRole('button', { name: /verify pdf file/i }))
    expect(await screen.findByText(/enter a valid certificate id/i)).toBeInTheDocument()
    expect(svc.verifyCertificateFile).not.toHaveBeenCalled()
  })
})
