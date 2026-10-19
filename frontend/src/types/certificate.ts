import { z } from 'zod'

/**
 * Types and runtime schemas that mirror the Python backend contract
 * (see backend api/openapi.yaml). Responses are parsed at the API boundary so
 * an unexpected payload fails loudly instead of rendering wrong information.
 */

export const CERTIFICATE_ID_PATTERN = /^CERT-[0-9]{4}-[0-9A-F]{20}$/

export const CERTIFICATE_STATUSES = ['VALID', 'REVOKED', 'EXPIRED'] as const
export const VERIFICATION_STATUSES = ['VALID', 'INVALID', 'REVOKED', 'EXPIRED', 'TAMPERED'] as const

export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number]
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number]

const nullable = <T extends z.ZodType>(schema: T) => schema.nullish().transform((value) => value ?? null)

const certificateStatus = z.enum(CERTIFICATE_STATUSES)

/** Public view returned by the verification endpoints (no e-mail, hashes or storage paths). */
export const publicCertificateSchema = z.object({
  certificate_id: z.string(),
  recipient_name: z.string(),
  course_name: z.string(),
  organization_name: z.string(),
  issue_date: z.string(),
  expiry_date: nullable(z.string()),
  status: certificateStatus,
  revoked_at: nullable(z.string()),
})

export const verificationResultSchema = z.object({
  certificate_id: z.string(),
  record_found: z.boolean(),
  status: z.enum(VERIFICATION_STATUSES),
  certificate_status: nullable(certificateStatus),
  metadata_signature_valid: nullable(z.boolean()),
  /** null unless a PDF was uploaded and checked. */
  pdf_integrity_verified: nullable(z.boolean()),
  message: z.string(),
  verified_at: nullable(z.string()),
  certificate: nullable(publicCertificateSchema),
})

export const certificateSummarySchema = z.object({
  certificate_id: z.string(),
  recipient_name: z.string(),
  recipient_email: nullable(z.string()),
  course_name: z.string(),
  organization_name: z.string(),
  issue_date: z.string(),
  expiry_date: nullable(z.string()),
  status: certificateStatus,
  effective_status: certificateStatus,
  created_at: z.string(),
  created_by: z.string(),
  revoked_at: nullable(z.string()),
})

export const certificateDetailSchema = certificateSummarySchema.extend({
  pdf_sha256: z.string(),
  metadata_sha256: z.string(),
  signature_algorithm: z.string(),
  kms_key_version: z.string(),
  revoked_by: nullable(z.string()),
  revocation_reason: nullable(z.string()),
})

export const downloadInfoSchema = z.object({
  url: z.string(),
  expires_at: nullable(z.string()),
})

export const certificateCreatedSchema = z.object({
  certificate_id: z.string(),
  verification_url: z.string(),
  certificate: certificateSummarySchema,
  download_path: nullable(z.string()),
  download: nullable(downloadInfoSchema),
})

export const certificateListSchema = z.object({
  items: z.array(certificateSummarySchema),
  page_size: z.number().optional(),
  next_page_token: nullable(z.string()),
})

export const downloadResponseSchema = z.object({
  certificate_id: z.string(),
  url: z.string(),
  expires_at: nullable(z.string()),
  method: z.string().optional(),
})

export const apiErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    request_id: z.string().optional(),
    details: z
      .array(z.object({ field: z.string().optional(), message: z.string().optional(), type: z.string().optional() }))
      .optional(),
  }),
})

export type PublicCertificate = z.infer<typeof publicCertificateSchema>
export type VerificationResult = z.infer<typeof verificationResultSchema>
export type CertificateSummary = z.infer<typeof certificateSummarySchema>
export type CertificateDetail = z.infer<typeof certificateDetailSchema>
export type DownloadInfo = z.infer<typeof downloadInfoSchema>
export type CertificateCreated = z.infer<typeof certificateCreatedSchema>
export type CertificateList = z.infer<typeof certificateListSchema>
export type DownloadResponse = z.infer<typeof downloadResponseSchema>

/** Body of POST /admin/certificates. The issue date is assigned by the server. */
export interface CreateCertificateInput {
  recipient_name: string
  recipient_email?: string | null
  course_name: string
  organization_name: string
  expiry_date?: string | null
}

export interface ListCertificatesParams {
  pageSize?: number
  pageToken?: string | null
  status?: CertificateStatus | null
}

export interface CertificateStats {
  total: number
  valid: number
  revoked: number
  expired: number
  /** true when more certificates exist than the pages that were counted. */
  truncated: boolean
}

export interface ActivityItem {
  id: string
  type: 'issued' | 'revoked'
  certificateId: string
  recipientName: string
  at: string
}
