/**
 * Typed, validated access to the public VITE_* settings.
 * `parseEnv` is pure so it can be unit-tested; `env` is the parsed live configuration.
 */
export interface RawEnv {
  VITE_API_BASE_URL?: string
  VITE_FIREBASE_API_KEY?: string
  VITE_FIREBASE_AUTH_DOMAIN?: string
  VITE_FIREBASE_PROJECT_ID?: string
  VITE_FIREBASE_APP_ID?: string
  VITE_PUBLIC_VERIFICATION_BASE_URL?: string
  VITE_MAX_UPLOAD_SIZE_MB?: string
  VITE_ENABLE_DEMO_MODE?: string
  VITE_DEV_PROXY?: string
}

export interface AppEnv {
  demoMode: boolean
  /** Base URL used by the API client (no trailing slash). `/api` when the dev proxy is active. */
  apiBaseUrl: string
  firebase: { apiKey: string; authDomain: string; projectId: string; appId: string }
  publicVerificationBaseUrl: string
  maxUploadBytes: number
  maxUploadMb: number
  /** Human-readable problems that prevent the app from working. Empty when configuration is complete. */
  configErrors: string[]
}

const PLACEHOLDER = /YOUR_|<.*>|example\.invalid/i

function clean(value: string | undefined): string {
  return (value ?? '').trim()
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function parseEnv(raw: RawEnv, options: { isDev: boolean; origin: string }): AppEnv {
  const demoMode = clean(raw.VITE_ENABLE_DEMO_MODE).toLowerCase() === 'true'
  const errors: string[] = []

  const rawApi = clean(raw.VITE_API_BASE_URL).replace(/\/+$/, '')
  const useProxy = options.isDev && clean(raw.VITE_DEV_PROXY).toLowerCase() === 'true'
  if (!demoMode) {
    if (!rawApi || PLACEHOLDER.test(rawApi)) {
      errors.push('VITE_API_BASE_URL is not set. Use your API Gateway base URL, for example https://my-gateway-abc123.uc.gateway.dev')
    } else if (!isHttpUrl(rawApi)) {
      errors.push('VITE_API_BASE_URL must be a valid http(s) URL.')
    }
  }
  const apiBaseUrl = useProxy ? '/api' : rawApi

  const firebase = {
    apiKey: clean(raw.VITE_FIREBASE_API_KEY),
    authDomain: clean(raw.VITE_FIREBASE_AUTH_DOMAIN),
    projectId: clean(raw.VITE_FIREBASE_PROJECT_ID),
    appId: clean(raw.VITE_FIREBASE_APP_ID),
  }
  if (!demoMode) {
    const labels: Array<[keyof typeof firebase, string]> = [
      ['apiKey', 'VITE_FIREBASE_API_KEY'],
      ['authDomain', 'VITE_FIREBASE_AUTH_DOMAIN'],
      ['projectId', 'VITE_FIREBASE_PROJECT_ID'],
      ['appId', 'VITE_FIREBASE_APP_ID'],
    ]
    for (const [key, name] of labels) {
      if (!firebase[key] || PLACEHOLDER.test(firebase[key])) errors.push(`${name} is not set (Identity Platform web app settings).`)
    }
  }

  let publicVerificationBaseUrl = clean(raw.VITE_PUBLIC_VERIFICATION_BASE_URL).replace(/\/+$/, '')
  if (!publicVerificationBaseUrl) {
    publicVerificationBaseUrl = `${options.origin.replace(/\/+$/, '')}/verify`
  } else if (!isHttpUrl(publicVerificationBaseUrl)) {
    errors.push('VITE_PUBLIC_VERIFICATION_BASE_URL must be a valid http(s) URL.')
    publicVerificationBaseUrl = `${options.origin.replace(/\/+$/, '')}/verify`
  }

  const parsedMb = Number.parseFloat(clean(raw.VITE_MAX_UPLOAD_SIZE_MB))
  const maxUploadMb = Number.isFinite(parsedMb) && parsedMb > 0 ? parsedMb : 10

  return {
    demoMode,
    apiBaseUrl,
    firebase,
    publicVerificationBaseUrl,
    maxUploadMb,
    maxUploadBytes: Math.floor(maxUploadMb * 1024 * 1024),
    configErrors: errors,
  }
}

export const env: AppEnv = parseEnv(import.meta.env as RawEnv, {
  isDev: import.meta.env.DEV,
  origin: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173',
})
