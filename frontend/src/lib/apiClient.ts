import type { z } from 'zod'

import { apiErrorBodySchema } from '@/types/certificate'

export interface ApiErrorDetail {
  field?: string
  message?: string
  type?: string
}

export type ApiErrorKind = 'http' | 'network' | 'timeout' | 'aborted' | 'parse' | 'auth'

/** Every failure of the API client is an ApiError so callers handle a single shape. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId: string | null
  readonly details: ApiErrorDetail[]
  readonly kind: ApiErrorKind

  constructor(init: {
    status: number
    code: string
    message: string
    requestId?: string | null
    details?: ApiErrorDetail[]
    kind?: ApiErrorKind
  }) {
    super(init.message)
    this.name = 'ApiError'
    this.status = init.status
    this.code = init.code
    this.requestId = init.requestId ?? null
    this.details = init.details ?? []
    this.kind = init.kind ?? 'http'
  }
}

/** Short, safe, user-facing text for an error. Never includes internals. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.kind) {
      case 'network':
        return 'Could not reach the server. Check your connection and the API address. If this keeps happening, the server may be blocking this website (CORS).'
      case 'timeout':
        return 'The request took too long. Please try again.'
      case 'aborted':
        return 'The request was cancelled.'
      case 'parse':
        return 'The server sent an unexpected response.'
      default:
        break
    }
    switch (error.status) {
      case 401:
        return 'Your session has expired. Please sign in again.'
      case 403:
        return 'Your account does not have permission to do this.'
      case 404:
        return error.message || 'Not found.'
      case 409:
        return error.message || 'This action conflicts with the current state of the certificate.'
      case 413:
        return error.message || 'The file or request is too large.'
      case 422:
        return error.message || 'Some of the information is not valid.'
      default:
        if (error.status >= 500) {
          return error.requestId
            ? `Something went wrong on the server. Reference: ${error.requestId}`
            : 'Something went wrong on the server. Please try again.'
        }
        return error.message || 'The request failed.'
    }
  }
  return 'Something went wrong. Please try again.'
}

type Query = Record<string, string | number | boolean | null | undefined>

export interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PATCH'
  path: string
  query?: Query
  json?: unknown
  formData?: FormData
  /** Send `Authorization: Bearer <ID token>`. Defaults to false (public endpoints). */
  auth?: boolean
  schema: z.ZodType<T, unknown>
  timeoutMs?: number
  signal?: AbortSignal
  /** Non-2xx statuses whose JSON body is a valid `schema` payload (e.g. 404 for verification). */
  acceptStatuses?: number[]
}

type TokenProvider = (forceRefresh?: boolean) => Promise<string | null>
type Listener = () => void

let baseUrl = ''
let tokenProvider: TokenProvider = async () => null
const unauthorizedListeners = new Set<Listener>()
const forbiddenListeners = new Set<Listener>()

export function configureApiClient(config: { baseUrl: string; getToken?: TokenProvider }): void {
  baseUrl = config.baseUrl.replace(/\/+$/, '')
  if (config.getToken) tokenProvider = config.getToken
}

export function setTokenProvider(provider: TokenProvider): void {
  tokenProvider = provider
}

/** Called when a protected request is still rejected with 401 after a forced token refresh. */
export function onUnauthorized(listener: Listener): () => void {
  unauthorizedListeners.add(listener)
  return () => unauthorizedListeners.delete(listener)
}

/** Called when a protected request is rejected with 403. */
export function onForbidden(listener: Listener): () => void {
  forbiddenListeners.add(listener)
  return () => forbiddenListeners.delete(listener)
}

const DEFAULT_TIMEOUT_MS = 30_000

function buildUrl(path: string, query?: Query): string {
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === '') continue
    params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

async function send(options: RequestOptions<unknown>, token: string | null): Promise<Response> {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onAbort)

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  let body: BodyInit | undefined
  if (options.formData) {
    body = options.formData // the browser sets the multipart boundary itself
  } else if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.json)
  }

  try {
    return await fetch(buildUrl(options.path, options.query), {
      method: options.method ?? 'GET',
      headers,
      body,
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
    })
  } catch (cause) {
    if (timedOut) {
      throw new ApiError({ status: 0, code: 'timeout', message: 'Request timed out.', kind: 'timeout' })
    }
    if (options.signal?.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) {
      throw new ApiError({ status: 0, code: 'aborted', message: 'Request cancelled.', kind: 'aborted' })
    }
    throw new ApiError({ status: 0, code: 'network_error', message: 'Network error.', kind: 'network' })
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

function toApiError(response: Response, body: unknown): ApiError {
  const parsed = apiErrorBodySchema.safeParse(body)
  const headerId = response.headers.get('X-Request-Id')
  if (parsed.success) {
    const { code, message, request_id, details } = parsed.data.error
    return new ApiError({ status: response.status, code, message, requestId: request_id ?? headerId, details })
  }
  return new ApiError({
    status: response.status,
    code: `http_${response.status}`,
    message: response.status >= 500 ? 'Server error.' : response.statusText || 'Request failed.',
    requestId: headerId,
  })
}

export async function apiRequest<T>(options: RequestOptions<T>): Promise<T> {
  let token: string | null = null
  if (options.auth) {
    try {
      token = await tokenProvider(false)
    } catch {
      token = null
    }
    if (!token) {
      unauthorizedListeners.forEach((listener) => listener())
      throw new ApiError({ status: 401, code: 'not_signed_in', message: 'You are not signed in.', kind: 'auth' })
    }
  }

  let response = await send(options, token)

  if (options.auth && response.status === 401) {
    // The token may have just expired: force one refresh and retry once.
    let refreshed: string | null = null
    try {
      refreshed = await tokenProvider(true)
    } catch {
      refreshed = null
    }
    if (refreshed) response = await send(options, refreshed)
  }

  const body = await readBody(response)

  if (!response.ok && !options.acceptStatuses?.includes(response.status)) {
    if (options.auth && response.status === 401) unauthorizedListeners.forEach((listener) => listener())
    if (options.auth && response.status === 403) forbiddenListeners.forEach((listener) => listener())
    throw toApiError(response, body)
  }

  const result = options.schema.safeParse(body)
  if (!result.success) {
    if (!response.ok) throw toApiError(response, body)
    throw new ApiError({
      status: response.status,
      code: 'invalid_response',
      message: 'Unexpected response from server.',
      requestId: response.headers.get('X-Request-Id'),
      kind: 'parse',
    })
  }
  return result.data
}
