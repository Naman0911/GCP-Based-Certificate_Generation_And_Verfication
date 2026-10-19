/// <reference types="vitest/config" />
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // CORS option B: when VITE_DEV_PROXY=true the browser talks to this dev server
  // (same origin) and Vite forwards /api/* to the API Gateway. No CORS needed in dev.
  const proxyTarget = env.VITE_API_BASE_URL || ''
  const useProxy = env.VITE_DEV_PROXY === 'true' && /^https?:\/\//.test(proxyTarget)

  return {
    plugins: [react()],
    resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
    server: {
      port: 5173,
      strictPort: true,
      proxy: useProxy
        ? {
            '/api': {
              target: proxyTarget,
              changeOrigin: true,
              secure: true,
              rewrite: (p) => p.replace(/^\/api/, ''),
            },
          }
        : undefined,
    },
    build: { sourcemap: false, target: 'es2022', chunkSizeWarningLimit: 900 },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./tests/setup.ts'],
      include: ['tests/**/*.test.{ts,tsx}'],
      css: false,
      restoreMocks: true,
    },
  }
})
