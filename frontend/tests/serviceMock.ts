import { vi } from 'vitest'

/** A mock of the CertificateService singleton; tests import `svc` and program its behaviour. */
export const svc = {
  createCertificate: vi.fn(),
  listCertificates: vi.fn(),
  getCertificate: vi.fn(),
  revokeCertificate: vi.fn(),
  getDownloadUrl: vi.fn(),
  verifyCertificate: vi.fn(),
  verifyCertificateFile: vi.fn(),
  getStats: vi.fn(),
  probeAdmin: vi.fn(),
}
