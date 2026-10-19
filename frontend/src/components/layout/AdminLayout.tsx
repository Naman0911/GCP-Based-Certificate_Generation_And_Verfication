import { useState } from 'react'
import { FilePlus2, FileText, LayoutDashboard, LogOut, Menu, ScanLine, UserCircle, X } from 'lucide-react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'

import { Brand } from '@/components/layout/Brand'
import { DemoBanner } from '@/components/layout/DemoBanner'
import { useToast } from '@/components/feedback/toastContext'
import { useAuth } from '@/features/auth/AuthContext'
import { cn } from '@/lib/utils'

const items = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/certificates', label: 'Certificates', icon: FileText, end: true },
  { to: '/admin/certificates/new', label: 'Issue certificate', icon: FilePlus2, end: true },
  { to: '/verify', label: 'Public verification', icon: ScanLine, end: false },
  { to: '/admin/profile', label: 'Profile', icon: UserCircle, end: true },
]

export function AdminLayout() {
  const { user, signOut } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  async function handleSignOut() {
    try {
      await signOut()
      navigate('/login', { replace: true })
    } catch {
      toast.show('error', 'Could not sign out. Please try again.')
    }
  }

  const nav = (
    <ul className="space-y-1">
      {items.map(({ to, label, icon: Icon, end }) => (
        <li key={to}>
          <NavLink
            to={to}
            end={end}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium',
                isActive ? 'bg-white/15 text-white' : 'text-blue-100 hover:bg-white/10 hover:text-white',
              )
            }
          >
            <Icon className="size-5" aria-hidden="true" />
            {label}
          </NavLink>
        </li>
      ))}
    </ul>
  )

  const sidebar = (
    <div className="flex h-full flex-col bg-navy-900 p-4">
      <div className="mb-6 px-1">
        <Brand to="/admin" inverted />
      </div>
      <nav aria-label="Admin" className="flex-1">
        {nav}
      </nav>
      <div className="mt-4 border-t border-white/10 pt-4">
        <p className="truncate px-1 text-xs text-blue-200" title={user?.email ?? undefined}>
          {user?.email ?? 'Signed in'}
        </p>
        <button
          type="button"
          onClick={handleSignOut}
          className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-blue-100 hover:bg-white/10 hover:text-white"
        >
          <LogOut className="size-5" aria-hidden="true" />
          Sign out
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2">
        Skip to main content
      </a>
      <aside className="hidden lg:block">
        <div className="sticky top-0 h-screen">{sidebar}</div>
      </aside>

      <div className="min-w-0">
        <DemoBanner />
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
          <Brand to="/admin" />
          <button
            type="button"
            className="rounded-lg p-2 hover:bg-slate-100"
            aria-expanded={open}
            aria-controls="admin-mobile-nav"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-6" aria-hidden="true" /> : <Menu className="size-6" aria-hidden="true" />}
          </button>
        </header>
        {open && (
          <div id="admin-mobile-nav" className="lg:hidden">
            {sidebar}
          </div>
        )}
        <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
