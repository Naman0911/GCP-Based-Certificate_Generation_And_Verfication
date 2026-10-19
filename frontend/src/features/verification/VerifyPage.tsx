import { useEffect, useRef, useState } from 'react'
import { FileUp, Keyboard, ScanLine } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { Card } from '@/components/ui/Card'
import { FileVerifyForm } from '@/components/verification/FileVerifyForm'
import { QrScanner } from '@/components/verification/QrScanner'
import { VerificationResultCard } from '@/components/verification/VerificationResultCard'
import { VerifyIdForm } from '@/components/verification/VerifyIdForm'
import { useVerifyFile } from '@/features/verification/hooks'
import { cn } from '@/lib/utils'

type Tab = 'id' | 'qr' | 'file'

const tabs: Array<{ id: Tab; label: string; icon: typeof Keyboard }> = [
  { id: 'id', label: 'Certificate ID', icon: Keyboard },
  { id: 'qr', label: 'Scan QR code', icon: ScanLine },
  { id: 'file', label: 'Upload PDF', icon: FileUp },
]

export function VerifyPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('id')
  const fileMutation = useVerifyFile()
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ id: null, qr: null, file: null })

  useEffect(() => {
    document.title = 'Verify a certificate – CertiTrust'
  }, [])

  const goTo = (id: string) => navigate(`/verify/${encodeURIComponent(id)}`)

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const move = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!move) return
    event.preventDefault()
    const next = tabs[(index + move + tabs.length) % tabs.length].id
    setTab(next)
    tabRefs.current[next]?.focus()
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight text-navy-900">Verify a certificate</h1>
      <p className="mt-2 text-slate-600">
        Check a certificate by its ID or QR code, or upload the PDF to confirm the file is exactly what the issuer signed. No account is needed.
      </p>

      <Card className="mt-6">
        <div role="tablist" aria-label="Verification method" className="flex border-b border-slate-200">
          {tabs.map(({ id, label, icon: Icon }, index) => (
            <button
              key={id}
              ref={(el) => {
                tabRefs.current[id] = el
              }}
              role="tab"
              type="button"
              id={`tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              onKeyDown={(e) => onKeyDown(e, index)}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 border-b-2 px-3 py-3.5 text-sm font-medium',
                tab === id ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-600 hover:text-navy-900',
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="p-5 sm:p-6">
          {tab === 'id' && (
            <div role="tabpanel" id="panel-id" aria-labelledby="tab-id">
              <VerifyIdForm onSubmit={goTo} autoFocus />
              <p className="mt-3 text-xs text-slate-600">This checks the issuer's record and its digital signature. It does not examine a PDF file.</p>
            </div>
          )}
          {tab === 'qr' && (
            <div role="tabpanel" id="panel-qr" aria-labelledby="tab-qr">
              <QrScanner onDetected={goTo} onManual={() => setTab('id')} />
            </div>
          )}
          {tab === 'file' && (
            <div role="tabpanel" id="panel-file" aria-labelledby="tab-file">
              <FileVerifyForm
                busy={fileMutation.isPending}
                error={fileMutation.error}
                onSubmit={(certificateId, file) => fileMutation.mutate({ certificateId, file })}
              />
            </div>
          )}
        </div>
      </Card>

      {tab === 'file' && fileMutation.data && (
        <div className="mt-6">
          <VerificationResultCard result={fileMutation.data} heading="PDF file verification" />
        </div>
      )}
    </div>
  )
}
