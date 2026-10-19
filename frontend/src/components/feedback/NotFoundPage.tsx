import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <p className="text-sm font-semibold text-brand-600">404</p>
      <h1 className="mt-1 text-2xl font-bold text-navy-900">Page not found</h1>
      <p className="mt-2 text-sm text-slate-600">The page you are looking for does not exist or has moved.</p>
      <Link to="/" className="mt-6 inline-flex h-10 items-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">
        Back to home
      </Link>
    </div>
  )
}
