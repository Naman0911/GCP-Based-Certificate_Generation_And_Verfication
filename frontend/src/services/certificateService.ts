import { ApiError, apiRequest } from '@/lib/apiClient'
import { env } from '@/lib/env'
import type { CertificateService } from '@/services/types'
import { createDemoCertificateService } from '@/services/demoService'
import {
  certificateCreatedSchema,
  certificateDetailSchema,
  certificateListSchema,
  downloadResponseSchema,
  verificationResultSchema,
  type CertificateStats,
  type CertificateSummary,
} from '@/types/certificate'

const STATS_PAGE_SIZE = 100
const STATS_MAX_PAGES = 20

const enc = encodeURIComponent

export function createHttpCertificateService(): CertificateService {
  const service: CertificateService = {
    createCertificate(input) {
      return apiRequest({
        method: 'POST',
        path: '/admin/certificates',
        auth: true,
        json: {
          recipient_name: input.recipient_name,
          course_name: input.course_name,
          organization_name: input.organization_name,
          ...(input.recipient_email ? { recipient_email: input.recipient_email } : {}),
          ...(input.expiry_date ? { expiry_date: input.expiry_date } : {}),
        },
        schema: certificateCreatedSchema,
        timeoutMs: 60_000, // KMS signing + PDF rendering can take a few seconds
      })
    },

    listCertificates(params = {}, signal) {
      return apiRequest({
        path: '/admin/certificates',
        auth: true,
        query: { page_size: params.pageSize, page_token: params.pageToken, status: params.status },
        schema: certificateListSchema,
        signal,
      })
    },

    getCertificate(certificateId, signal) {
      return apiRequest({ path: `/admin/certificates/${enc(certificateId)}`, auth: true, schema: certificateDetailSchema, signal })
    },

    revokeCertificate(certificateId, reason) {
      return apiRequest({
        method: 'PATCH',
        path: `/admin/certificates/${enc(certificateId)}/revoke`,
        auth: true,
        json: { reason },
        schema: certificateDetailSchema,
      })
    },

    getDownloadUrl(certificateId) {
      return apiRequest({ path: `/admin/certificates/${enc(certificateId)}/download`, auth: true, schema: downloadResponseSchema })
    },

    verifyCertificate(certificateId, signal) {
      return apiRequest({
        path: `/verify/${enc(certificateId)}`,
        schema: verificationResultSchema,
        acceptStatuses: [404], // unknown ID => 404 with status INVALID in the body
        signal,
      })
    },

    verifyCertificateFile(certificateId, file, signal) {
      const form = new FormData()
      form.append('file', file, file.name)
      return apiRequest({
        method: 'POST',
        path: `/verify/${enc(certificateId)}/file`,
        formData: form,
        schema: verificationResultSchema,
        acceptStatuses: [404],
        timeoutMs: 90_000,
        signal,
      })
    },

    async getStats(signal) {
      const items: CertificateSummary[] = []
      let token: string | null = null
      let truncated = false
      for (let page = 0; page < STATS_MAX_PAGES; page += 1) {
        const result = await service.listCertificates({ pageSize: STATS_PAGE_SIZE, pageToken: token }, signal)
        items.push(...result.items)
        token = result.next_page_token
        if (!token) break
        if (page === STATS_MAX_PAGES - 1) truncated = true
      }
      const stats: CertificateStats = {
        total: items.length,
        valid: items.filter((c) => c.effective_status === 'VALID').length,
        revoked: items.filter((c) => c.effective_status === 'REVOKED').length,
        expired: items.filter((c) => c.effective_status === 'EXPIRED').length,
        truncated,
      }
      return stats
    },

    async probeAdmin() {
      try {
        await service.listCertificates({ pageSize: 1 })
        return true
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) return false
        throw error
      }
    },
  }
  return service
}

export const certificateService: CertificateService = env.demoMode ? createDemoCertificateService() : createHttpCertificateService()
