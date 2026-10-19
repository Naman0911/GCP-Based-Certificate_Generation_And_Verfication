import { ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'

export function Brand({ to = '/', inverted = false }: { to?: string; inverted?: boolean }) {
  return (
    <Link to={to} className={`inline-flex items-center gap-2 text-lg font-bold tracking-tight ${inverted ? 'text-white' : 'text-navy-900'}`}>
      <span className="grid size-8 place-items-center rounded-lg bg-brand-600 text-white">
        <ShieldCheck className="size-5" aria-hidden="true" />
      </span>
      CertiTrust
    </Link>
  )
}
