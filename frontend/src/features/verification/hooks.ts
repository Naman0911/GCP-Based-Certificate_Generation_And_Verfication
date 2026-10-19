import { useMutation, useQuery } from '@tanstack/react-query'

import { ApiError } from '@/lib/apiClient'
import { certificateService } from '@/services/certificateService'

export function useVerifyCertificate(certificateId: string | null) {
  return useQuery({
    queryKey: ['verify', certificateId],
    enabled: certificateId !== null,
    queryFn: ({ signal }) => certificateService.verifyCertificate(certificateId as string, signal),
    retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
    staleTime: 0, // status can change (revocation), so always re-check on a fresh visit
    gcTime: 60_000,
  })
}

export function useVerifyFile() {
  return useMutation({
    mutationFn: ({ certificateId, file }: { certificateId: string; file: File }) =>
      certificateService.verifyCertificateFile(certificateId, file),
  })
}
