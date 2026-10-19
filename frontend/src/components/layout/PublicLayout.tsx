import { useState } from 'react'
import { LogIn, LayoutDashboard, Menu, ScanLine, X } from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router-dom'

import { Brand } from '@/components/layout/Brand'
import { DemoBanner } from '@/components/layout/DemoBanner'
import { useAuth } from '@/features/auth/AuthContext'
import { cn } from '@/lib/utils'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn('flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium', isActive ? 'bg-brand-50 text-brand-700' : 'text-navy-800 hover:bg-slate-100')

export function PublicLayout() {
  const { status, role } = useAuth()
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  const nav = (
    <>
      <NavLink to="/verify" className={linkClass} onClick={close}>
        <ScanLine className="size-4" aria-hidden="true" />
        Verify a certificate
      </NavLink>
      {status === 'authenticated' && role === 'admin' ? (
        <NavLink to="/admin" className={linkClass} onClick={close}>
          <LayoutDashboard className="size-4" aria-hidden="true" />
          Admin dashboard
        </NavLink>
      ) : (
        <NavLink to="/login" className={linkClass} onClick={close}>
          <LogIn className="size-4" aria-hidden="true" />
          Admin sign in
        </NavLink>
      )}
    </>
  )

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2">
        Skip to main content
      </a>
      <DemoBanner />
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Brand />
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {nav}
          </nav>
          <button
            type="button"
            className="rounded-lg p-2 text-navy-900 hover:bg-slate-100 md:hidden"
            aria-expanded={open}
            aria-controls="public-mobile-nav"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-6" aria-hidden="true" /> : <Menu className="size-6" aria-hidden="true" />}
          </button>
        </div>
        {open && (
          <nav id="public-mobile-nav" aria-label="Mobile" className="flex flex-col gap-1 border-t border-slate-100 px-4 py-3 md:hidden">
            {nav}
          </nav>
        )}
      </header>
      <main id="main" tabIndex={-1} className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 bg-white py-6 text-center text-xs text-slate-600">
        <p>
          Verification confirms what the issuer's records and digital signatures say. <Link to="/verify" className="font-medium text-brand-700 underline">Verify a certificate</Link>
        </p>
      </footer>
    </div>
  )
}
