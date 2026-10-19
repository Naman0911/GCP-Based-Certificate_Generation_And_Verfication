/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_FIREBASE_API_KEY?: string
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string
  readonly VITE_FIREBASE_PROJECT_ID?: string
  readonly VITE_FIREBASE_APP_ID?: string
  readonly VITE_PUBLIC_VERIFICATION_BASE_URL?: string
  readonly VITE_MAX_UPLOAD_SIZE_MB?: string
  readonly VITE_ENABLE_DEMO_MODE?: string
  readonly VITE_DEV_PROXY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
