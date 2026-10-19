import { Settings } from 'lucide-react'

export function ConfigErrorScreen({ errors }: { errors: string[] }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl items-center px-4 py-12">
      <div className="w-full rounded-2xl border border-amber-300 bg-white p-8 shadow-sm">
        <div className="flex items-center gap-3 text-amber-800">
          <Settings className="size-6" aria-hidden="true" />
          <h1 className="text-xl font-bold text-navy-900">Configuration required</h1>
        </div>
        <p className="mt-3 text-sm text-slate-700">
          This app cannot start because some settings are missing. Copy <code className="rounded bg-slate-100 px-1">.env.example</code> to{' '}
          <code className="rounded bg-slate-100 px-1">.env</code>, fill in the values, then restart <code className="rounded bg-slate-100 px-1">npm run dev</code>.
        </p>
        <ul className="mt-4 list-disc space-y-1.5 pl-5 text-sm text-red-800">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
        <p className="mt-5 text-xs text-slate-600">
          To preview the interface without a backend, set <code className="rounded bg-slate-100 px-1">VITE_ENABLE_DEMO_MODE=true</code>. Demo mode uses in-memory sample data only.
        </p>
      </div>
    </main>
  )
}
