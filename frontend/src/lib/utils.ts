import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

import { CERTIFICATE_ID_PATTERN } from '@/types/certificate'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function formatDate(value: string | null | undefined, withTime = false): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function isCertificateId(value: string): boolean {
  return CERTIFICATE_ID_PATTERN.test(value)
}

/** Normalises user input to the canonical (upper-case, trimmed) certificate ID, or null if it is not one. */
export function normalizeCertificateId(value: string): string | null {
  const candidate = value.trim().toUpperCase()
  return isCertificateId(candidate) ? candidate : null
}

export function buildVerificationUrl(baseUrl: string, certificateId: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(certificateId)}`
}

/**
 * Accepts a certificate ID or a URL that starts with the configured verification base URL and
 * returns the certificate ID. Anything else (other hosts, other paths, junk) returns null, so a
 * scanned QR code can never make the app navigate to an arbitrary address.
 */
export function parseVerificationInput(raw: string, verificationBaseUrl: string): string | null {
  const text = raw.trim()
  if (!text || text.length > 2048) return null
  const direct = normalizeCertificateId(text)
  if (direct) return direct

  let candidate: URL
  let base: URL
  try {
    candidate = new URL(text)
    base = new URL(verificationBaseUrl)
  } catch {
    return null
  }
  if (candidate.origin !== base.origin) return null
  const basePath = base.pathname.replace(/\/+$/, '')
  const prefix = `${basePath}/`
  if (!candidate.pathname.startsWith(prefix)) return null
  const rest = candidate.pathname.slice(prefix.length).replace(/\/+$/, '')
  if (!rest || rest.includes('/')) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(rest)
  } catch {
    return null
  }
  return normalizeCertificateId(decoded)
}

/** Whitespace-insensitive, case-insensitive match used by the client-side search box. */
export function matchesQuery(haystack: ReadonlyArray<string | null | undefined>, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return haystack.some((part) => (part ?? '').toLowerCase().includes(needle))
}

// eslint-disable-next-line no-control-regex
const FORBIDDEN_TEXT = /[\u0000-\u001F\u007F‪-‮⁦-⁩]/
export function hasForbiddenCharacters(value: string): boolean {
  return FORBIDDEN_TEXT.test(value)
}
