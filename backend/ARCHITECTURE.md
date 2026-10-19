# Architecture

## 1. Overview

```
React frontend ──HTTPS──▶ API Gateway (OpenAPI 3.0, validates Firebase JWT on /admin/**)
                              │  gateway service account + Google ID token
                              ▼
        ┌──────────── private Cloud Run functions (one per route) ────────────┐
        │ create │ list │ get │ revoke │ download │ verify │ verify_file      │
        └───────────────┬───────────────┬───────────────┬─────────────────────┘
                        │               │               │
                  Firestore        Cloud Storage      Cloud KMS
              (records, audit)   (private PDFs)    (RSA signing key)

Identity Platform ──ID tokens──▶ verified again inside each admin function (Firebase Admin SDK)
Cloud Logging / Monitoring ◀── structured JSON logs from every function
```

Each function is deployed as its own package (`main.py` + `requirements.txt` + a copy of
`shared/`), so no function depends on sibling directories at runtime. All functions are
private (`--no-allow-unauthenticated`); only the gateway's service account may invoke them.
Public verification is therefore public *at the gateway*, never directly on Cloud Run.

## 2. Modules (`shared/`)

| Module | Responsibility |
|---|---|
| `config.py` | Validated settings from environment; production guard rails |
| `exceptions.py` | `AppError` hierarchy → HTTP status + stable error code |
| `models.py` | Enums, UTC helpers, `CertificateRecord`, `effective_status` |
| `validators.py` | Pydantic request models, certificate-ID pattern, PDF/upload checks |
| `crypto_service.py` | SHA-256, canonical metadata, KMS backend, signing + verification |
| `dev_signer.py` | **Test-only** in-memory signer (stripped from deployments) |
| `qr_service.py` / `pdf_service.py` | QR PNG and ReportLab PDF rendering |
| `firestore_repository.py` | Create-only writes, batches, transactions, cursor pagination |
| `storage_service.py` | Overwrite-proof uploads, conditional delete, signed URLs |
| `audit_service.py` | Audit events (Firestore) + structured logs |
| `auth_service.py` | ID-token verification and admin authorisation |
| `certificate_service.py` | Business logic (issue, verify, revoke, list, download) |
| `response_utils.py` | JSON responses, `api_endpoint` decorator, CORS, safe errors |
| `container.py` | Lazy service wiring per process |

Heavy dependencies are imported lazily, so the verification functions do not need ReportLab,
Pillow, Storage or Firebase Admin (enforced by a test that blocks those imports).

## 3. Data model

Firestore collection `certificates`, document ID = `certificate_id`
(`CERT-<year>-<20 random hex>`, built from UUID4 randomness; creation is create-only so a
collision fails instead of overwriting).

| Field | Notes |
|---|---|
| `certificate_id`, `recipient_name`, `recipient_email?`, `course_name`, `organization_name` | Signed metadata |
| `issue_date`, `expiry_date?` | Firestore timestamps, UTC, whole seconds |
| `status` | `VALID` \| `REVOKED` \| `EXPIRED` (stored); effective status also considers expiry |
| `storage_bucket`, `storage_object` | `certificates/<id>.pdf`; PDF bytes are never in Firestore |
| `pdf_sha256`, `pdf_signature` | SHA-256 of the exact final PDF bytes; Base64 signature over that digest |
| `metadata_sha256`, `metadata_signature` | Digest of canonical metadata JSON and its signature |
| `signature_algorithm`, `kms_key_version` | Algorithm name and full KMS key-version resource name |
| `created_by`, `created_at` | Admin UID from the verified token |
| `revoked_at?`, `revoked_by?`, `revocation_reason?` | Set atomically on revocation |

Collection `audit_events` (auto IDs): `event_type`, `actor_uid`, `actor_email`, `certificate_id`,
`outcome`, `details`, `created_at`. No tokens, PDFs or recipient data.

Indexes: `certificates(status ASC, created_at DESC)` for filtered listing,
`audit_events(certificate_id ASC, created_at DESC)` for investigations. Unfiltered listing uses the
automatic `created_at` index. Security rules deny all client access; the backend uses IAM.

## 4. Cryptography

* **Hash:** SHA-256 everywhere (lower-case hex in records).
* **Canonical metadata (schema v1):** JSON object with keys `schema_version, certificate_id,
  recipient_name, recipient_email, course_name, organization_name, issue_date, expiry_date`;
  strings NFC-normalised; absent optionals `null`; timestamps UTC `YYYY-MM-DDTHH:MM:SSZ`;
  serialised with sorted keys, separators `(",", ":")`, `ensure_ascii=False`, UTF-8.
* **Signature:** Cloud KMS `AsymmetricSign` over the 32-byte digest, with an RSA/SHA-256 key
  (PKCS#1 v1.5 or PSS, 2048–4096 bits). The signing key is created once, never per certificate. The key
  version used is stored with the record, and verification uses *that* version's public key
  (fetched from KMS, cached per instance, checked with CRC32C) via `cryptography`.
* **Integrity checks:** KMS digest/signature CRC32C are validated; every signature is
  verified immediately after creation; unsupported algorithms, malformed Base64, unknown or
  foreign key versions and mismatching `signature_algorithm` all verify as **false** (fail closed).
  KMS/Firestore outages raise service errors (HTTP 500) and are never reported as tampering.
* **PDF finalisation order:** render → hash exact bytes → sign digest → upload. The signature is
  *not* embedded into the PDF (that would change the bytes). The QR/ID prove only that a record
  exists; file authenticity requires uploading the file for hashing.
* Both signatures sign a digest of different data types with the same key; a digest collision
  between metadata JSON and a PDF is computationally infeasible, so no extra domain separation
  is used.
* **Dev signer:** isolated in `dev_signer.py`, selectable only with `USE_LOCAL_DEV_SIGNER=true`,
  refused when `ENVIRONMENT=production`, and removed from every deployed package.

## 5. Flows

### Issue (`POST /admin/certificates`)
1. Authenticate token → authorise (admin claim, or verified email in allow-list).
2. Validate body (Pydantic, `extra="forbid"`). 3. Generate ID, canonical metadata, digest, **sign**.
4. Build verification URL → QR; render PDF; hash exact bytes; **sign**.
5. Upload to Storage with `if_generation_match=0`.
6. Firestore **batch**: create record + audit event atomically.
7. If step 6 fails → delete the object *only if its generation still matches* (compensation);
   if that also fails a `CRITICAL orphaned_storage_object` log is emitted. No `VALID` record is ever left
   without its PDF, and no record exists for a failed issue. A signed download URL is added to the response
   (failure to sign does not undo the issue).

### Verify by ID (`GET /verify/{id}`)
Fetch record → recompute canonical metadata digest → constant-time compare → verify signature → compute
effective status. Precedence: **TAMPERED > REVOKED > EXPIRED > VALID**; no record → `INVALID` (HTTP 404).
`pdf_integrity_verified` is `null` — the PDF was not examined. Data from a record that failed
verification is not returned.

### Verify file (`POST /verify/{id}/file`)
Size-bounded read (multipart `file` or raw `application/pdf`), structural PDF validation (header + EOF
marker; content, not extension/MIME), SHA-256 of the uploaded bytes, compare to `pdf_sha256`, verify
`pdf_signature`, then metadata authenticity and status. A modified file → `TAMPERED` with
`pdf_integrity_verified: false`; an unmodified file of a revoked certificate → `REVOKED` with integrity `true`.
Structural validation is deliberately lenient so that *modified* PDFs are reported as tampered rather than rejected.

### Revoke (`PATCH …/revoke`)
Firestore **transaction**: read → 404 if missing → 409 if already revoked → update status/time/actor/reason and
create the audit event in the same transaction. Record and PDF are preserved. `REVOKED` can never be changed back
(`update_certificate_status` refuses).

## 6. Security model

| Concern | Control |
|---|---|
| Admin identity | Firebase ID token verified in gateway and function; `X-Forwarded-Authorization` honoured |
| Authorisation | `admin: true` custom claim **or** verified email in `ADMIN_EMAILS`; body identity ignored |
| Public data | Name, course, organisation, dates, status only; no email, hashes, storage paths |
| Service identities | Separate least-privilege accounts; verifier cannot sign or write |
| Storage | Private bucket, public access prevention, uniform access, overwrite-proof writes, keyless V4 URLs |
| Input | Length/format limits, control & bidi characters rejected, size-bounded uploads, unknown fields rejected |
| Errors | 5xx messages are generic with a `request_id`; no traces, no infrastructure names |
| Logging | Structured; sensitive keys dropped; no tokens, PDFs, signatures or recipient data |
| CORS | Only origins in `CORS_ALLOWED_ORIGINS`; preflight answered without auth |

Residual risks: see "Known limitations" in the README (status field not covered by signatures,
no idempotency key, lazy expiry persistence, public endpoints need quota/Cloud Armor if exposed widely).

## 7. HTTP status codes

400 malformed JSON · 401 missing/invalid token · 403 not an admin · 404 unknown certificate/route ·
405 wrong method · 409 conflict (already revoked, ID collision) · 413 body/upload too large ·
422 validation failure (including bad IDs and non-PDF uploads) · 500 internal/cloud failure.

## 8. Observability and audit

Structured logs → Cloud Logging. Durable audit trail in Firestore for create, revoke and download-URL
issuance (written atomically with the data change for create/revoke). Public verification and rejected
requests are log-only to avoid unauthenticated write amplification. Suggested log-based metrics:
`certificate_tamper_detected`, `unauthorized_admin_access`, `orphaned_storage_object`, any `severity>=ERROR`.

## 9. Testing strategy

Unit tests mock Firestore (in-memory fake with batches/transactions/cursors), Storage (fake client and fake
service), KMS (fake client including CRC behaviour; in-memory signer for service tests) and Identity
Platform (injected verifier). Additional tests check OpenAPI validity, route/handler/script consistency and
per-function dependency isolation. Integration tests should use the Firestore emulator or a throw-away
project.
