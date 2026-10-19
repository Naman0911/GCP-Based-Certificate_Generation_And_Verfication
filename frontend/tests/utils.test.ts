import { describe, expect, it } from 'vitest'

import { buildVerificationUrl, formatBytes, hasForbiddenCharacters, matchesQuery, normalizeCertificateId, parseVerificationInput } from '@/lib/utils'

const BASE = 'https://verify.example.org/verify'
const ID = 'CERT-2026-0123456789ABCDEF0123'

describe('parseVerificationInput', () => {
  it('accepts a bare ID in any case with whitespace', () => {
    expect(parseVerificationInput(`  ${ID.toLowerCase()} `, BASE)).toBe(ID)
  })
  it('accepts a URL under the configured base', () => {
    expect(parseVerificationInput(`${BASE}/${ID}`, BASE)).toBe(ID)
    expect(parseVerificationInput(`${BASE}/${ID}/`, BASE)).toBe(ID)
  })
  it('rejects other hosts, schemes, paths and junk', () => {
    expect(parseVerificationInput(`https://evil.example/verify/${ID}`, BASE)).toBeNull()
    expect(parseVerificationInput(`http://verify.example.org/verify/${ID}`, BASE)).toBeNull()
    expect(parseVerificationInput(`${BASE}/../admin/${ID}`, BASE)).toBeNull()
    expect(parseVerificationInput(`${BASE}/x/${ID}`, BASE)).toBeNull()
    expect(parseVerificationInput(`https://verify.example.org/other/${ID}`, BASE)).toBeNull()
    expect(parseVerificationInput('javascript:alert(1)', BASE)).toBeNull()
    expect(parseVerificationInput('CERT-2026-XYZ', BASE)).toBeNull()
    expect(parseVerificationInput('', BASE)).toBeNull()
    expect(parseVerificationInput('x'.repeat(5000), BASE)).toBeNull()
  })
  it('rejects a base-prefixed URL whose ID is malformed', () => {
    expect(parseVerificationInput(`${BASE}/CERT-1-2`, BASE)).toBeNull()
    expect(parseVerificationInput(`${BASE}/%E0%A4%A`, BASE)).toBeNull()
  })
})

describe('helpers', () => {
  it('normalizes IDs', () => {
    expect(normalizeCertificateId(ID.toLowerCase())).toBe(ID)
    expect(normalizeCertificateId('nope')).toBeNull()
  })
  it('builds verification URLs without double slashes', () => {
    expect(buildVerificationUrl(`${BASE}/`, ID)).toBe(`${BASE}/${ID}`)
  })
  it('matches queries case-insensitively across fields', () => {
    expect(matchesQuery(['Asha Verma', null], 'asha')).toBe(true)
    expect(matchesQuery(['Asha Verma'], 'zzz')).toBe(false)
    expect(matchesQuery(['x'], '   ')).toBe(true)
  })
  it('detects control and bidi characters', () => {
    expect(hasForbiddenCharacters('plain text')).toBe(false)
    expect(hasForbiddenCharacters('bad\u0007bell')).toBe(true)
    expect(hasForbiddenCharacters('evil‮mark')).toBe(true)
  })
  it('formats bytes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})
