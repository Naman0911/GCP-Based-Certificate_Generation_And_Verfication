import type {
  CertificateCreated,
  CertificateDetail,
  CertificateList,
  CertificateStats,
  CreateCertificateInput,
  DownloadResponse,
  ListCertificatesParams,
  VerificationResult,
} from '@/types/certificate'

/** Everything the UI needs from the backend. Implemented by the HTTP service and the demo service. */
export interface CertificateService {
  createCertificate(input: CreateCertificateInput): Promise<CertificateCreated>
  listCertificates(params?: ListCertificatesParams, signal?: AbortSignal): Promise<CertificateList>
  getCertificate(certificateId: string, signal?: AbortSignal): Promise<CertificateDetail>
  revokeCertificate(certificateId: string, reason: string): Promise<CertificateDetail>
  getDownloadUrl(certificateId: string): Promise<DownloadResponse>
  /** Public: record and metadata-signature verification. The PDF is NOT examined. */
  verifyCertificate(certificateId: string, signal?: AbortSignal): Promise<VerificationResult>
  /** Public: hashes the uploaded PDF on the server and compares it with the stored digest/signature. */
  verifyCertificateFile(certificateId: string, file: File, signal?: AbortSignal): Promise<VerificationResult>
  /** Counts certificates by effective status from real list pages. */
  getStats(signal?: AbortSignal): Promise<CertificateStats>
  /** Resolves true when the signed-in account is accepted by the admin endpoints, false on 403. */
  probeAdmin(): Promise<boolean>
}
