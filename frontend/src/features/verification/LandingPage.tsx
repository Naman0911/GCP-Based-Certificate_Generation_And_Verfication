import { useEffect } from 'react'
import { FileCheck2, QrCode, ShieldCheck } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

import { VerifyIdForm } from '@/components/verification/VerifyIdForm'

const points = [
  { icon: QrCode, title: 'Scan or type the ID', text: 'Every certificate carries an ID and a QR code that point to the issuer’s record.' },
  { icon: ShieldCheck, title: 'Signed records', text: 'Records are digitally signed by the issuer, so edits to the stored details are detected.' },
  { icon: FileCheck2, title: 'Check the exact file', text: 'Upload the PDF to confirm it is byte-for-byte the file the issuer signed.' },
]

export function LandingPage() {
  const navigate = useNavigate()
  useEffect(() => {
    document.title = 'CertiTrust – Certificate management and verification'
  }, [])

  return (
    <div>
      <section className="bg-gradient-to-b from-brand-50 to-slate-50">
        <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:py-24">
          <h1 className="text-4xl font-bold tracking-tight text-navy-900 sm:text-5xl">Verify a certificate in seconds</h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-slate-600">Confirm that a certificate is genuine, current and unchanged. No account required.</p>
          <div className="mx-auto mt-8 max-w-xl rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm">
            <VerifyIdForm onSubmit={(id) => navigate(`/verify/${encodeURIComponent(id)}`)} />
            <p className="mt-3 text-sm text-slate-600">
              Prefer to scan or upload a file?{' '}
              <Link to="/verify" className="font-medium text-brand-700 underline">
                More verification options
              </Link>
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-6 px-4 py-14 sm:grid-cols-3">
        {points.map(({ icon: Icon, title, text }) => (
          <div key={title} className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="mb-3 grid size-10 place-items-center rounded-lg bg-brand-50 text-brand-600">
              <Icon className="size-5" aria-hidden="true" />
            </div>
            <h2 className="text-base font-semibold text-navy-900">{title}</h2>
            <p className="mt-1 text-sm text-slate-600">{text}</p>
          </div>
        ))}
      </section>

      <section className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-3xl px-4 py-8 text-center text-sm text-slate-600">
          Issuing organization?{' '}
          <Link to="/login" className="font-medium text-brand-700 underline">
            Administrator sign in
          </Link>
        </div>
      </section>
    </div>
  )
}
