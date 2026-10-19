import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/feedback/toastContext'

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const toast = useToast()

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.show('success', `${label} copied`)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.show('error', 'Copy is not available in this browser. Select the text and copy it manually.')
    }
  }

  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={copy}
      aria-label={`Copy ${label}`}
      icon={copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
    >
      {copied ? 'Copied' : 'Copy'}
    </Button>
  )
}
