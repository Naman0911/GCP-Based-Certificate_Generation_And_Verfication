import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Camera, CameraOff, Keyboard } from 'lucide-react'

import { Alert } from '@/components/feedback/Alert'
import { Button } from '@/components/ui/Button'
import { env } from '@/lib/env'
import { parseVerificationInput } from '@/lib/utils'

interface ScannerHandle {
  stop(): Promise<unknown>
  clear(): void
  isScanning?: boolean
}

type Phase = 'idle' | 'starting' | 'scanning' | 'error'

function cameraErrorMessage(error: unknown): string {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : String(error)
  if (/NotAllowed|Permission/i.test(name)) return 'Camera access was blocked. Allow camera permission for this site in your browser settings, or enter the certificate ID instead.'
  if (/NotFound|not found|Devices/i.test(name)) return 'No camera was found on this device. Enter the certificate ID instead.'
  if (/NotReadable|TrackStart/i.test(name)) return 'The camera is in use by another application. Close it and try again, or enter the ID instead.'
  if (/Secure|insecure/i.test(name)) return 'Camera access needs a secure (HTTPS or localhost) page.'
  return 'The camera could not be started. Enter the certificate ID instead.'
}

/**
 * Camera QR scanner. The camera starts only after the user presses the button, accepts only
 * certificate IDs or URLs under the configured verification base URL (never navigates to an arbitrary
 * QR payload) and is always stopped on success, on stop and on unmount.
 */
export function QrScanner({ onDetected, onManual }: { onDetected: (certificateId: string) => void; onManual?: () => void }) {
  const reactId = useId()
  const elementId = `qr-reader-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const scannerRef = useRef<ScannerHandle | null>(null)
  const mountedRef = useRef(true)
  const runIdRef = useRef(0)
  const lastRejectedRef = useRef<string | null>(null)
  const onDetectedRef = useRef(onDetected)
  onDetectedRef.current = onDetected
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const stopCamera = useCallback(async () => {
    runIdRef.current += 1 // invalidates a start() that is still in flight
    const scanner = scannerRef.current
    scannerRef.current = null
    if (!scanner) return
    try {
      await scanner.stop()
    } catch {
      /* already stopped */
    }
    try {
      scanner.clear()
    } catch {
      /* nothing rendered */
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      void stopCamera()
    }
  }, [stopCamera])

  async function start() {
    setMessage(null)
    setNotice(null)
    lastRejectedRef.current = null
    setPhase('starting')
    const runId = (runIdRef.current += 1)
    try {
      const { Html5Qrcode } = await import('html5-qrcode')
      if (!mountedRef.current || runId !== runIdRef.current) return
      const scanner = new Html5Qrcode(elementId, false) as unknown as ScannerHandle & {
        start(
          camera: { facingMode: string },
          config: { fps: number; qrbox: { width: number; height: number } },
          onSuccess: (text: string) => void,
          onError: () => void,
        ): Promise<unknown>
      }
      scannerRef.current = scanner
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decodedText) => {
          const id = parseVerificationInput(decodedText, env.publicVerificationBaseUrl)
          if (id) {
            void stopCamera().then(() => {
              if (!mountedRef.current) return
              setPhase('idle')
              onDetectedRef.current(id)
            })
          } else if (lastRejectedRef.current !== decodedText) {
            lastRejectedRef.current = decodedText
            setNotice('That QR code is not a certificate verification link from this service, so it was ignored.')
          }
        },
        () => {
          /* a frame without a QR code: ignore */
        },
      )
      if (!mountedRef.current || runId !== runIdRef.current) {
        await stopCamera()
        return
      }
      setPhase('scanning')
    } catch (error) {
      await stopCamera()
      if (mountedRef.current) {
        setMessage(cameraErrorMessage(error))
        setPhase('error')
      }
    }
  }

  async function stop() {
    await stopCamera()
    if (mountedRef.current) {
      setPhase('idle')
      setNotice(null)
    }
  }

  return (
    <div>
      <div
        id={elementId}
        data-testid="qr-viewport"
        className={phase === 'scanning' || phase === 'starting' ? 'mx-auto w-full max-w-sm overflow-hidden rounded-xl bg-navy-950' : 'hidden'}
      />

      {phase === 'idle' || phase === 'error' ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
          <Camera className="mb-3 size-8 text-brand-600" aria-hidden="true" />
          <p className="max-w-sm text-sm text-slate-700">The camera is only turned on after you press the button. The image never leaves your device.</p>
          <Button className="mt-4" onClick={start}>
            Start camera
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex justify-center">
          <Button variant="secondary" onClick={stop} icon={<CameraOff className="size-4" aria-hidden="true" />} disabled={phase === 'starting'}>
            Stop camera
          </Button>
        </div>
      )}

      {phase === 'starting' && (
        <p role="status" className="mt-3 text-center text-sm text-slate-600">
          Starting camera… allow access if your browser asks.
        </p>
      )}
      {phase === 'scanning' && (
        <p role="status" className="mt-3 text-center text-sm text-slate-600">
          Point the camera at the QR code on the certificate.
        </p>
      )}
      {message && (
        <Alert tone="error" className="mt-4">
          {message}
        </Alert>
      )}
      {notice && (
        <Alert tone="warning" className="mt-4">
          {notice}
        </Alert>
      )}
      {onManual && (
        <div className="mt-4 text-center">
          <button type="button" onClick={onManual} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 underline">
            <Keyboard className="size-4" aria-hidden="true" />
            Enter the certificate ID instead
          </button>
        </div>
      )}
    </div>
  )
}
