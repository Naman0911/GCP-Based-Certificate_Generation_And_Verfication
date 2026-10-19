import { ApiError } from '@/lib/apiClient'
import { buildVerificationUrl, normalizeCertificateId } from '@/lib/utils'
import { env } from '@/lib/env'
import type { CertificateService } from '@/services/types'
import type {
  CertificateDetail,
  CertificateStats,
  CertificateStatus,
  CertificateSummary,
  VerificationResult,
} from '@/types/certificate'

/**
 * In-memory stand-in for the backend, used ONLY when VITE_ENABLE_DEMO_MODE=true.
 * It behaves like the real API (including real SHA-256 PDF comparison) but nothing is signed or persisted.
 */

interface DemoRecord extends CertificateDetail {
  pdf: Uint8Array
}

function minimalPdf(lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7E]/g, '?')
  const text = lines.map((line, i) => `BT /F1 14 Tf 72 ${720 - i * 24} Td (${esc(line)}) Tj ET`).join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  offsets.forEach((o) => {
    out += `${String(o).padStart(10, '0')} 00000 n \n`
  })
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(out)
}

async function sha256(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
  return `CERT-${new Date().getUTCFullYear()}-${hex}`
}

function effectiveStatus(record: { status: CertificateStatus; expiry_date: string | null }): CertificateStatus {
  if (record.status === 'REVOKED') return 'REVOKED'
  if (record.status === 'EXPIRED') return 'EXPIRED'
  if (record.expiry_date && new Date(record.expiry_date).getTime() <= Date.now()) return 'EXPIRED'
  return 'VALID'
}

function delay(ms = 250): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function summary(record: DemoRecord): CertificateSummary {
  return {
    certificate_id: record.certificate_id,
    recipient_name: record.recipient_name,
    recipient_email: record.recipient_email,
    course_name: record.course_name,
    organization_name: record.organization_name,
    issue_date: record.issue_date,
    expiry_date: record.expiry_date,
    status: record.status,
    effective_status: effectiveStatus(record),
    created_at: record.created_at,
    created_by: record.created_by,
    revoked_at: record.revoked_at,
  }
}

function detail(record: DemoRecord): CertificateDetail {
  const { pdf: _pdf, ...rest } = record
  void _pdf
  return { ...rest, effective_status: effectiveStatus(record) }
}

export function createDemoCertificateService(): CertificateService {
  const store = new Map<string, DemoRecord>()
  let seeded: Promise<void> | null = null

  async function add(input: {
    recipient_name: string
    recipient_email?: string | null
    course_name: string
    organization_name: string
    expiry_date?: string | null
    daysAgo?: number
  }): Promise<DemoRecord> {
    const id = randomId()
    const issued = new Date(Date.now() - (input.daysAgo ?? 0) * 86_400_000).toISOString()
    const pdf = minimalPdf(['DEMO CERTIFICATE (not a real credential)', input.recipient_name, input.course_name, input.organization_name, id])
    const record: DemoRecord = {
      certificate_id: id,
      recipient_name: input.recipient_name,
      recipient_email: input.recipient_email ?? null,
      course_name: input.course_name,
      organization_name: input.organization_name,
      issue_date: issued,
      expiry_date: input.expiry_date ?? null,
      status: 'VALID',
      effective_status: 'VALID',
      created_at: issued,
      created_by: 'demo-admin',
      revoked_at: null,
      pdf_sha256: await sha256(pdf),
      metadata_sha256: await sha256(new TextEncoder().encode(id)),
      signature_algorithm: 'DEMO_NOT_SIGNED',
      kms_key_version: 'demo',
      revoked_by: null,
      revocation_reason: null,
      pdf,
    }
    store.set(id, record)
    return record
  }

  function ensureSeeded(): Promise<void> {
    if (!seeded) {
      seeded = (async () => {
        await add({ recipient_name: 'Sample Recipient One', course_name: 'Sample Course A', organization_name: 'Demo Organization', daysAgo: 6 })
        await add({ recipient_name: 'Sample Recipient Two', course_name: 'Sample Course B', organization_name: 'Demo Organization', daysAgo: 3 })
        const third = await add({ recipient_name: 'Sample Recipient Three', course_name: 'Sample Course C', organization_name: 'Demo Organization', daysAgo: 1 })
        third.status = 'REVOKED'
        third.revoked_at = new Date().toISOString()
        third.revoked_by = 'demo-admin'
        third.revocation_reason = 'Sample revocation'
      })()
    }
    return seeded
  }

  function publicResult(record: DemoRecord, extra: Partial<VerificationResult>): VerificationResult {
    const status = effectiveStatus(record)
    return {
      certificate_id: record.certificate_id,
      record_found: true,
      status,
      certificate_status: status,
      metadata_signature_valid: true,
      pdf_integrity_verified: null,
      message:
        status === 'VALID'
          ? 'Certificate record and metadata signature verified (demo data, nothing is cryptographically signed)'
          : status === 'REVOKED'
            ? 'Certificate has been revoked'
            : 'Certificate has expired',
      verified_at: new Date().toISOString(),
      certificate: {
        certificate_id: record.certificate_id,
        recipient_name: record.recipient_name,
        course_name: record.course_name,
        organization_name: record.organization_name,
        issue_date: record.issue_date,
        expiry_date: record.expiry_date,
        status,
        revoked_at: record.revoked_at,
      },
      ...extra,
    }
  }

  function notFound(id: string): VerificationResult {
    return {
      certificate_id: id,
      record_found: false,
      status: 'INVALID',
      certificate_status: null,
      metadata_signature_valid: null,
      pdf_integrity_verified: null,
      message: 'No certificate record exists with this ID',
      verified_at: new Date().toISOString(),
      certificate: null,
    }
  }

  function requireRecord(id: string): DemoRecord {
    const record = store.get(id)
    if (!record) throw new ApiError({ status: 404, code: 'not_found', message: 'Certificate not found.' })
    return record
  }

  return {
    async createCertificate(input) {
      await ensureSeeded()
      await delay()
      const record = await add(input)
      const url = URL.createObjectURL(new Blob([record.pdf.slice().buffer], { type: 'application/pdf' }))
      return {
        certificate_id: record.certificate_id,
        verification_url: buildVerificationUrl(env.publicVerificationBaseUrl, record.certificate_id),
        certificate: summary(record),
        download_path: `/admin/certificates/${record.certificate_id}/download`,
        download: { url, expires_at: new Date(Date.now() + 10 * 60_000).toISOString() },
      }
    },

    async listCertificates(params = {}) {
      await ensureSeeded()
      await delay(150)
      const all = [...store.values()]
        .filter((r) => !params.status || r.status === params.status)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
      const size = params.pageSize ?? 25
      const start = params.pageToken ? Number.parseInt(params.pageToken, 10) || 0 : 0
      const items = all.slice(start, start + size).map(summary)
      const next = start + size < all.length ? String(start + size) : null
      return { items, page_size: size, next_page_token: next }
    },

    async getCertificate(id) {
      await ensureSeeded()
      await delay(150)
      return detail(requireRecord(id))
    },

    async revokeCertificate(id, reason) {
      await ensureSeeded()
      await delay()
      const record = requireRecord(id)
      if (record.status === 'REVOKED') {
        throw new ApiError({ status: 409, code: 'conflict', message: 'Certificate is already revoked.' })
      }
      record.status = 'REVOKED'
      record.revoked_at = new Date().toISOString()
      record.revoked_by = 'demo-admin'
      record.revocation_reason = reason
      return detail(record)
    },

    async getDownloadUrl(id) {
      await ensureSeeded()
      const record = requireRecord(id)
      const url = URL.createObjectURL(new Blob([record.pdf.slice().buffer], { type: 'application/pdf' }))
      return { certificate_id: id, url, expires_at: new Date(Date.now() + 10 * 60_000).toISOString(), method: 'GET' }
    },

    async verifyCertificate(id) {
      await ensureSeeded()
      await delay(150)
      const normalized = normalizeCertificateId(id) ?? id
      const record = store.get(normalized)
      return record ? publicResult(record, {}) : notFound(normalized)
    },

    async verifyCertificateFile(id, file) {
      await ensureSeeded()
      await delay()
      const normalized = normalizeCertificateId(id) ?? id
      const record = store.get(normalized)
      if (!record) return notFound(normalized)
      const matches = (await sha256(await file.arrayBuffer())) === record.pdf_sha256
      if (!matches) {
        return publicResult(record, {
          status: 'TAMPERED',
          pdf_integrity_verified: false,
          message: 'The uploaded file does not match the issued certificate',
        })
      }
      return publicResult(record, { pdf_integrity_verified: true })
    },

    async getStats(): Promise<CertificateStats> {
      await ensureSeeded()
      const all = [...store.values()].map(summary)
      return {
        total: all.length,
        valid: all.filter((c) => c.effective_status === 'VALID').length,
        revoked: all.filter((c) => c.effective_status === 'REVOKED').length,
        expired: all.filter((c) => c.effective_status === 'EXPIRED').length,
        truncated: false,
      }
    },

    async probeAdmin() {
      return true
    },
  }
}
