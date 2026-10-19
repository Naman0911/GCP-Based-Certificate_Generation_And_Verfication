import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import { useToast } from '@/components/feedback/toastContext'
import { ApiError, describeError } from '@/lib/apiClient'
import { certificateService } from '@/services/certificateService'
import type { ActivityItem, CertificateStatus, CertificateSummary, CreateCertificateInput } from '@/types/certificate'

export const keys = {
  all: ['certificates'] as const,
  list: (status: CertificateStatus | null, pageSize: number, pageToken: string | null) => ['certificates', 'list', { status, pageSize, pageToken }] as const,
  detail: (id: string) => ['certificates', 'detail', id] as const,
  stats: ['certificates', 'stats'] as const,
}

const noRetryOnClientError = (count: number, error: unknown) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1

export function useCertificateList(params: { status: CertificateStatus | null; pageSize: number; pageToken: string | null }) {
  return useQuery({
    queryKey: keys.list(params.status, params.pageSize, params.pageToken),
    queryFn: ({ signal }) => certificateService.listCertificates({ pageSize: params.pageSize, pageToken: params.pageToken, status: params.status }, signal),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: noRetryOnClientError,
  })
}

export function useCertificate(certificateId: string) {
  return useQuery({
    queryKey: keys.detail(certificateId),
    queryFn: ({ signal }) => certificateService.getCertificate(certificateId, signal),
    staleTime: 15_000,
    retry: noRetryOnClientError,
  })
}

export function useCertificateStats() {
  return useQuery({
    queryKey: keys.stats,
    queryFn: ({ signal }) => certificateService.getStats(signal),
    staleTime: 30_000,
    retry: noRetryOnClientError,
  })
}

export function useCreateCertificate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCertificateInput) => certificateService.createCertificate(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.all }),
  })
}

export function useRevokeCertificate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ certificateId, reason }: { certificateId: string; reason: string }) => certificateService.revokeCertificate(certificateId, reason),
    onSuccess: (detail) => {
      queryClient.setQueryData(keys.detail(detail.certificate_id), detail)
      void queryClient.invalidateQueries({ queryKey: keys.all })
      void queryClient.invalidateQueries({ queryKey: ['verify', detail.certificate_id] })
    },
  })
}

/** Opens a (short-lived, backend-signed) download URL in a new tab. */
export function openDownloadUrl(url: string, fileName: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.target = '_blank'
  anchor.rel = 'noopener noreferrer'
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

export function useDownload() {
  const toast = useToast()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const download = useCallback(
    async (certificateId: string) => {
      setPendingId(certificateId)
      try {
        const info = await certificateService.getDownloadUrl(certificateId)
        openDownloadUrl(info.url, `${certificateId}.pdf`)
      } catch (error) {
        toast.show('error', describeError(error))
      } finally {
        setPendingId(null)
      }
    },
    [toast],
  )
  return { download, pendingId }
}

/** Recent activity derived from real records only (issued / revoked), newest first. */
export function deriveActivity(items: CertificateSummary[], limit = 8): ActivityItem[] {
  const events: ActivityItem[] = []
  for (const item of items) {
    events.push({ id: `${item.certificate_id}:issued`, type: 'issued', certificateId: item.certificate_id, recipientName: item.recipient_name, at: item.created_at })
    if (item.revoked_at) {
      events.push({ id: `${item.certificate_id}:revoked`, type: 'revoked', certificateId: item.certificate_id, recipientName: item.recipient_name, at: item.revoked_at })
    }
  }
  return events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit)
}
