import type { Auth, User } from 'firebase/auth'

import { env } from '@/lib/env'
import type { AuthClient, AuthUser } from '@/types/auth'

let authPromise: Promise<Auth> | null = null

/** Lazily initialises the Firebase JS SDK (Google Cloud Identity Platform) on first use. */
function getFirebaseAuth(): Promise<Auth> {
  if (!authPromise) {
    authPromise = (async () => {
      const [{ initializeApp, getApps, getApp }, { getAuth, browserLocalPersistence, setPersistence }] = await Promise.all([
        import('firebase/app'),
        import('firebase/auth'),
      ])
      const app = getApps().length
        ? getApp()
        : initializeApp({
            apiKey: env.firebase.apiKey,
            authDomain: env.firebase.authDomain,
            projectId: env.firebase.projectId,
            appId: env.firebase.appId,
          })
      const auth = getAuth(app)
      await setPersistence(auth, browserLocalPersistence)
      return auth
    })()
    authPromise.catch(() => {
      authPromise = null
    })
  }
  return authPromise
}

function mapUser(user: User): AuthUser {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    providerId: user.providerData[0]?.providerId ?? null,
    lastSignInTime: user.metadata.lastSignInTime ?? null,
  }
}

export function createFirebaseAuthClient(): AuthClient {
  return {
    subscribe(listener) {
      let active = true
      let unsubscribe: (() => void) | null = null
      void getFirebaseAuth()
        .then(async (auth) => {
          const { onAuthStateChanged } = await import('firebase/auth')
          if (!active) return
          unsubscribe = onAuthStateChanged(auth, (user) => listener(user ? mapUser(user) : null))
        })
        .catch(() => {
          if (active) listener(null)
        })
      return () => {
        active = false
        unsubscribe?.()
      }
    },
    async signInWithPassword(email, password) {
      const auth = await getFirebaseAuth()
      const { signInWithEmailAndPassword } = await import('firebase/auth')
      await signInWithEmailAndPassword(auth, email, password)
    },
    async signInWithGoogle() {
      const auth = await getFirebaseAuth()
      const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth')
      await signInWithPopup(auth, new GoogleAuthProvider())
    },
    async signOut() {
      const auth = await getFirebaseAuth()
      const { signOut } = await import('firebase/auth')
      await signOut(auth)
    },
    async getIdToken(forceRefresh = false) {
      const auth = await getFirebaseAuth()
      return auth.currentUser ? auth.currentUser.getIdToken(forceRefresh) : null
    },
    async hasAdminClaim() {
      const auth = await getFirebaseAuth()
      if (!auth.currentUser) return false
      const result = await auth.currentUser.getIdTokenResult()
      return result.claims.admin === true
    },
  }
}

/** Maps Firebase auth error codes to safe, non-enumerating messages. */
export function describeAuthError(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : ''
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return 'The email or password is incorrect.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a few minutes and try again.'
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact your administrator.'
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.'
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in was cancelled.'
    case 'auth/popup-blocked':
      return 'The sign-in pop-up was blocked by your browser. Allow pop-ups for this site and retry.'
    case 'auth/unauthorized-domain':
      return 'This website address is not authorised for sign-in. Add it under Authorized domains in Identity Platform.'
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled for the project.'
    default:
      return 'Sign-in failed. Please try again.'
  }
}
