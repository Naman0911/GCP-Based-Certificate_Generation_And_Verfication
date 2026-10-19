import type { AuthClient, AuthUser } from '@/types/auth'

/** In-memory auth used only when VITE_ENABLE_DEMO_MODE=true. Any non-empty credentials sign in. */
export function createDemoAuthClient(): AuthClient {
  let user: AuthUser | null = null
  const listeners = new Set<(user: AuthUser | null) => void>()
  const emit = () => listeners.forEach((listener) => listener(user))

  const signIn = async (email: string) => {
    user = {
      uid: 'demo-admin',
      email: email || 'demo.admin@example.test',
      displayName: 'Demo administrator',
      providerId: 'demo',
      lastSignInTime: new Date().toISOString(),
    }
    emit()
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      queueMicrotask(() => listener(user))
      return () => listeners.delete(listener)
    },
    signInWithPassword: (email) => signIn(email),
    signInWithGoogle: () => signIn(''),
    async signOut() {
      user = null
      emit()
    },
    async getIdToken() {
      return user ? 'demo-token' : null
    },
    async hasAdminClaim() {
      return user !== null
    },
  }
}
