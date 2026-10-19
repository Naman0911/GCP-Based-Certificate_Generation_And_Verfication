import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { QrScanner } from '@/components/verification/QrScanner'
import { env } from '@/lib/env'

const ID = 'CERT-2026-0123456789ABCDEF0123'

const h = vi.hoisted(() => {
  const state: { onSuccess: ((text: string) => void) | null; startError: unknown; instances: number } = { onSuccess: null, startError: null, instances: 0 }
  const stop = vi.fn(async () => undefined)
  const clear = vi.fn()
  const start = vi.fn(async (_cam: unknown, _cfg: unknown, onSuccess: (text: string) => void) => {
    if (state.startError) throw state.startError
    state.onSuccess = onSuccess
  })
  return { state, stop, clear, start }
})

vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class {
    constructor() {
      h.state.instances += 1
    }
    start = h.start
    stop = h.stop
    clear = h.clear
  },
}))

beforeEach(() => {
  h.state.onSuccess = null
  h.state.startError = null
  h.state.instances = 0
  h.start.mockClear()
  h.stop.mockClear()
  h.clear.mockClear()
})

describe('QrScanner', () => {
  it('does not touch the camera until the user presses Start', () => {
    render(<QrScanner onDetected={vi.fn()} />)
    expect(h.start).not.toHaveBeenCalled()
    expect(h.state.instances).toBe(0)
    expect(screen.getByRole('button', { name: /start camera/i })).toBeInTheDocument()
  })

  it('accepts a configured verification URL, stops the camera and reports the ID', async () => {
    const onDetected = vi.fn()
    render(<QrScanner onDetected={onDetected} />)
    await userEvent.click(screen.getByRole('button', { name: /start camera/i }))
    await waitFor(() => expect(h.start).toHaveBeenCalled())
    expect(h.start.mock.calls[0][0]).toEqual({ facingMode: 'environment' })
    await act(async () => h.state.onSuccess?.(`${env.publicVerificationBaseUrl}/${ID}`))
    await waitFor(() => expect(onDetected).toHaveBeenCalledWith(ID))
    expect(h.stop).toHaveBeenCalled()
    expect(h.clear).toHaveBeenCalled()
  })

  it('accepts a bare certificate ID', async () => {
    const onDetected = vi.fn()
    render(<QrScanner onDetected={onDetected} />)
    await userEvent.click(screen.getByRole('button', { name: /start camera/i }))
    await waitFor(() => expect(h.start).toHaveBeenCalled())
    await act(async () => h.state.onSuccess?.(ID))
    await waitFor(() => expect(onDetected).toHaveBeenCalledWith(ID))
  })

  it.each(['https://evil.example/verify/' + ID, 'javascript:alert(1)', 'https://example.com', 'hello'])('ignores %s and keeps scanning', async (payload) => {
    const onDetected = vi.fn()
    render(<QrScanner onDetected={onDetected} />)
    await userEvent.click(screen.getByRole('button', { name: /start camera/i }))
    await waitFor(() => expect(h.start).toHaveBeenCalled())
    await act(async () => h.state.onSuccess?.(payload))
    expect(await screen.findByText(/not a certificate verification link/i)).toBeInTheDocument()
    expect(onDetected).not.toHaveBeenCalled()
    expect(h.stop).not.toHaveBeenCalled()
  })

  it('stops the camera when the user presses Stop', async () => {
    render(<QrScanner onDetected={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /start camera/i }))
    await userEvent.click(await screen.findByRole('button', { name: /stop camera/i }))
    await waitFor(() => expect(h.stop).toHaveBeenCalled())
    expect(await screen.findByRole('button', { name: /start camera/i })).toBeInTheDocument()
  })

  it('stops and clears the camera when unmounted while scanning', async () => {
    const { unmount } = render(<QrScanner onDetected={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /start camera/i }))
    await screen.findByRole('button', { name: /stop camera/i })
    unmount()
    await waitFor(() => expect(h.stop).toHaveBeenCalled())
    expect(h.clear).toHaveBeenCalled()
  })

  it('explains denied camera permission and offers the manual fallback', async () => {
    h.state.startError = Object.assign(new Error('denied'), { name: 'NotAllowedError' })
    const onManual = vi.fn()
    render(<QrScanner onDetected={vi.fn()} onManual={onManual} />)
    await userEvent.click(screen.getByRole('button', { name: /start camera/i }))
    expect(await screen.findByText(/camera access was blocked/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /start camera/i })).toBeInTheDocument() // can retry
    await userEvent.click(screen.getByRole('button', { name: /enter the certificate id instead/i }))
    expect(onManual).toHaveBeenCalled()
  })

  it('explains a missing camera', async () => {
    h.state.startError = 'Requested device not found'
    render(<QrScanner onDetected={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /start camera/i }))
    expect(await screen.findByText(/no camera was found/i)).toBeInTheDocument()
  })
})
