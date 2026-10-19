import { env } from '@/lib/env'

export function DemoBanner() {
  if (!env.demoMode) return null
  return (
    <div role="note" className="bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-900">
      Demo mode: sample data held in memory. Nothing is signed, stored or sent to a backend.
    </div>
  )
}
