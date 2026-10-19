import { createContext, useContext } from 'react'

import type { AdminRole, AuthStatus, AuthUser } from '@/types/auth'

export interface AuthContextValue {
  status: AuthStatus
  user: AuthUser | null
  /** 'unknown' while being resolved or when it could not be determined (see roleError). */
  role: AdminRole
  roleError: string | null
  /** True after the session was rejected (expired / revoked) so /login can explain why. */
  sessionExpired: boolean
  signInWithPassword(email: string, password: string): Promise<void>
  signInWithGoogle(): Promise<void>
  signOut(): Promise<void>
  retryRole(): void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}
