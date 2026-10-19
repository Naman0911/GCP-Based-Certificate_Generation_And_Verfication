import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, apiRequest, configureApiClient, describeError, onForbidden, onUnauthorized } from '@/lib/apiClient'
import { certificateListSchema, verificationResultSchema } from '@/types/certificate'
import { ID, jsonResponse, summary, verification } from './helpers'

const fetchMock = vi.fn<typeof fetch>()
const err = (code: string, message: string, status: number, extra: object = {}) => jsonResponse({ error: { code, message, request_id: 'req-1', ...extra } }, status)

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  configureApiClient({ baseUrl: 'https://api.test/', getToken: async (force) => (force ? 'fresh' : 'stale') })
})
afterEach(() => vi.unstubAllGlobals())

const listCall = () => apiRequest({ path: '/admin/certificates', auth: true, query: { page_size: 5, status: null }, schema: certificateListSchema })

describe('apiRequest', () => {
  it('sends the bearer token, skips empty query values and does not send cookies', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [summary()], next_page_token: null }))
    const result = await listCall()
    expect(result.items).toHaveLength(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.test/admin/certificates?page_size=5')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer stale')
    expect(init?.credentials).toBe('omit')
  })

  it('does not send Authorization on public requests', async () => {
    fetchMock.mockResolvedValue(jsonResponse(verification()))
    await apiRequest({ path: `/verify/${ID}`, schema: verificationResultSchema })
    expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('sends multipart bodies without a manual Content-Type', async () => {
    fetchMock.mockResolvedValue(jsonResponse(verification({ pdf_integrity_verified: true })))
    const form = new FormData()
    form.append('file', new File(['%PDF-'], 'a.pdf'))
    await apiRequest({ method: 'POST', path: `/verify/${ID}/file`, formData: form, schema: verificationResultSchema })
    const init = fetchMock.mock.calls[0][1]
    expect(init?.body).toBe(form)
    expect((init?.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })

  it('401: refreshes the token once and retries', async () => {
    fetchMock.mockResolvedValueOnce(err('unauthorized', 'expired', 401)).mockResolvedValueOnce(jsonResponse({ items: [], next_page_token: null }))
    await listCall()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect((fetchMock.mock.calls[1][1]?.headers as Record<string, string>).Authorization).toBe('Bearer fresh')
  })

  it('401 after refresh: notifies listeners and throws', async () => {
    const listener = vi.fn()
    const off = onUnauthorized(listener)
    fetchMock.mockResolvedValue(err('unauthorized', 'bad token', 401))
    await expect(listCall()).rejects.toMatchObject({ status: 401, code: 'unauthorized', requestId: 'req-1' })
    expect(listener).toHaveBeenCalled()
    off()
  })

  it('401 without a token never calls the network', async () => {
    configureApiClient({ baseUrl: 'https://api.test', getToken: async () => null })
    const listener = vi.fn()
    const off = onUnauthorized(listener)
    await expect(listCall()).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(listener).toHaveBeenCalled()
    off()
  })

  it('403: notifies forbidden listeners and throws', async () => {
    const listener = vi.fn()
    const off = onForbidden(listener)
    fetchMock.mockResolvedValue(err('forbidden', 'nope', 403))
    await expect(listCall()).rejects.toMatchObject({ status: 403 })
    expect(listener).toHaveBeenCalled()
    off()
  })

  it('404 with acceptStatuses returns the INVALID verification body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(verification({ record_found: false, status: 'INVALID', certificate: null, certificate_status: null, metadata_signature_valid: null }), 404))
    const result = await apiRequest({ path: `/verify/${ID}`, schema: verificationResultSchema, acceptStatuses: [404] })
    expect(result.status).toBe('INVALID')
    expect(result.record_found).toBe(false)
  })

  it('404 with an Error body (unknown route) is still an error even with acceptStatuses', async () => {
    fetchMock.mockResolvedValue(err('not_found', 'Route not found.', 404))
    await expect(apiRequest({ path: '/nope', schema: verificationResultSchema, acceptStatuses: [404] })).rejects.toMatchObject({ status: 404, code: 'not_found' })
  })

  it('413 and 422 keep code, message and field details', async () => {
    fetchMock.mockResolvedValueOnce(err('payload_too_large', 'Upload too large.', 413))
    await expect(listCall()).rejects.toMatchObject({ status: 413, message: 'Upload too large.' })
    fetchMock.mockResolvedValueOnce(err('validation_error', 'Invalid.', 422, { details: [{ field: 'body.recipient_name', message: 'too long' }] }))
    await expect(listCall()).rejects.toMatchObject({ status: 422, details: [{ field: 'body.recipient_name', message: 'too long' }] })
  })

  it('500 is a safe error with a request id; non-JSON bodies do not crash', async () => {
    fetchMock.mockResolvedValueOnce(err('internal_error', 'Internal error.', 500))
    const error = await listCall().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(describeError(error)).toContain('req-1')
    fetchMock.mockResolvedValueOnce(new Response('<html>bad gateway</html>', { status: 502 }))
    await expect(listCall()).rejects.toMatchObject({ status: 502, code: 'http_502' })
  })

  it('falls back to the X-Request-Id header', async () => {
    fetchMock.mockResolvedValueOnce(new Response('oops', { status: 500, headers: { 'X-Request-Id': 'hdr-9' } }))
    await expect(listCall()).rejects.toMatchObject({ requestId: 'hdr-9' })
  })

  it('network failure becomes a network ApiError that mentions CORS', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const error = await listCall().catch((e: unknown) => e)
    expect(error).toMatchObject({ kind: 'network', status: 0 })
    expect(describeError(error)).toMatch(/CORS/)
  })

  it('times out', async () => {
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))))
    await expect(apiRequest({ path: '/slow', schema: certificateListSchema, timeoutMs: 10 })).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('rejects an unexpected success payload instead of rendering it', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: 'nope' }))
    await expect(listCall()).rejects.toMatchObject({ kind: 'parse' })
  })
})

describe('describeError', () => {
  it('gives safe, specific messages', () => {
    expect(describeError(new ApiError({ status: 401, code: 'x', message: 'raw' }))).toMatch(/sign in again/i)
    expect(describeError(new ApiError({ status: 403, code: 'x', message: 'raw' }))).toMatch(/permission/i)
    expect(describeError(new ApiError({ status: 500, code: 'x', message: 'stack trace here' }))).not.toMatch(/stack trace/)
    expect(describeError(new Error('secret internals'))).not.toMatch(/secret/)
  })
})
