import { describe, expect, it } from 'vitest'

import { parseEnv } from '@/lib/env'

const opts = { isDev: true, origin: 'http://localhost:5173' }
const full = {
  VITE_API_BASE_URL: 'https://gw-abc.uc.gateway.dev/',
  VITE_FIREBASE_API_KEY: 'k',
  VITE_FIREBASE_AUTH_DOMAIN: 'p.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'p',
  VITE_FIREBASE_APP_ID: '1:2:web:3',
}

describe('parseEnv', () => {
  it('accepts a complete configuration and strips the trailing slash', () => {
    const env = parseEnv(full, opts)
    expect(env.configErrors).toEqual([])
    expect(env.apiBaseUrl).toBe('https://gw-abc.uc.gateway.dev')
    expect(env.publicVerificationBaseUrl).toBe('http://localhost:5173/verify')
    expect(env.maxUploadBytes).toBe(10 * 1024 * 1024)
  })
  it('reports every missing setting', () => {
    const env = parseEnv({}, opts)
    expect(env.configErrors.length).toBe(5)
  })
  it('treats the placeholder URL from .env.example as missing', () => {
    expect(parseEnv({ ...full, VITE_API_BASE_URL: 'https://YOUR_API_GATEWAY_BASE_URL' }, opts).configErrors[0]).toMatch(/VITE_API_BASE_URL/)
  })
  it('rejects non-http URLs', () => {
    expect(parseEnv({ ...full, VITE_API_BASE_URL: 'ftp://x' }, opts).configErrors.join()).toMatch(/http/)
  })
  it('does not require backend settings in demo mode', () => {
    const env = parseEnv({ VITE_ENABLE_DEMO_MODE: 'true' }, opts)
    expect(env.demoMode).toBe(true)
    expect(env.configErrors).toEqual([])
  })
  it('uses the dev proxy only in development', () => {
    expect(parseEnv({ ...full, VITE_DEV_PROXY: 'true' }, opts).apiBaseUrl).toBe('/api')
    expect(parseEnv({ ...full, VITE_DEV_PROXY: 'true' }, { ...opts, isDev: false }).apiBaseUrl).toBe('https://gw-abc.uc.gateway.dev')
  })
  it('reads a custom upload limit and ignores invalid ones', () => {
    expect(parseEnv({ ...full, VITE_MAX_UPLOAD_SIZE_MB: '2' }, opts).maxUploadBytes).toBe(2 * 1024 * 1024)
    expect(parseEnv({ ...full, VITE_MAX_UPLOAD_SIZE_MB: 'abc' }, opts).maxUploadMb).toBe(10)
  })
})
