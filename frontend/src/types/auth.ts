export type AdminRole = 'admin' | 'none' | 'unknown'

export interface AuthUser {
  uid: string
  email: string | null
  displayName: string | null
  providerId: string | null
  lastSignInTime: string | null
}

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

/** Provider-agnostic auth client (Identity Platform in production, in-memory in demo mode). */
export interface AuthClient {
  /** Calls `listener` with the current user (or null) and on every change. Returns an unsubscribe function. */
  subscribe(listener: (user: AuthUser | null) => void): () => void
  signInWithPassword(email: string, password: string): Promise<void>
  signInWithGoogle(): Promise<void>
  signOut(): Promise<void>
  /** Returns a valid ID token, refreshing it when `forceRefresh` is true or it is about to expire. */
  getIdToken(forceRefresh?: boolean): Promise<string | null>
  /** Returns true when the ID token carries the `admin: true` custom claim. */
  hasAdminClaim(): Promise<boolean>
}
