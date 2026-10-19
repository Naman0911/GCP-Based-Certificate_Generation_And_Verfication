import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { AuthContext, type AuthContextValue } from '@/features/auth/AuthContext'
import { describeError, onForbidden, onUnauthorized, setTokenProvider } from '@/lib/apiClient'
import type { AdminRole, AuthClient, AuthStatus, AuthUser } from '@/types/auth'

interface Props {
  client: AuthClient
  /** Asks the backend whether the account is an administrator (used when there is no `admin` claim). */
  probeAdmin: () => Promise<boolean>
  children: ReactNode
}

export function AuthProvider({ client, probeAdmin, children }: Props) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [role, setRole] = useState<AdminRole>('unknown')
  const [roleError, setRoleError] = useState<string | null>(null)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [roleAttempt, setRoleAttempt] = useState(0)
  const uidRef = useRef<string | null>(null)

  useEffect(() => {
    setTokenProvider((forceRefresh) => client.getIdToken(forceRefresh))
  }, [client])

  useEffect(() => {
    return client.subscribe((next) => {
      const hadUser = uidRef.current !== null
      uidRef.current = next?.uid ?? null
      setUser(next)
      setStatus(next ? 'authenticated' : 'unauthenticated')
      setRole('unknown')
      setRoleError(null)
      if (!next && hadUser) queryClient.clear() // never keep one user's data around after sign-out
    })
  }, [client, queryClient])

  // Resolve the role for the signed-in user (claim first, then ask the backend).
  const uid = user?.uid ?? null
  useEffect(() => {
    if (!uid) return
    let cancelled = false
    void (async () => {
      try {
        if (await client.hasAdminClaim()) {
          if (!cancelled) setRole('admin')
          return
        }
        const allowed = await probeAdmin()
        if (!cancelled) setRole(allowed ? 'admin' : 'none')
      } catch (error) {
        if (!cancelled) {
          setRole('unknown')
          setRoleError(describeError(error))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [client, probeAdmin, uid, roleAttempt])

  const signOut = useCallback(async () => {
    await client.signOut()
  }, [client])

  useEffect(() => {
    const offUnauthorized = onUnauthorized(() => {
      if (!uidRef.current) return
      setSessionExpired(true)
      void client.signOut()
    })
    const offForbidden = onForbidden(() => setRole('none'))
    return () => {
      offUnauthorized()
      offForbidden()
    }
  }, [client])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      role,
      roleError,
      sessionExpired,
      async signInWithPassword(email, password) {
        setSessionExpired(false)
        await client.signInWithPassword(email, password)
      },
      async signInWithGoogle() {
        setSessionExpired(false)
        await client.signInWithGoogle()
      },
      signOut,
      retryRole() {
        setRoleError(null)
        setRole('unknown')
        setRoleAttempt((n) => n + 1)
      },
    }),
    [client, role, roleError, sessionExpired, signOut, status, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
