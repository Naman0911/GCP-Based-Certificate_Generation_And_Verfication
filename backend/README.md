# Certificate Generation & Verification System — Backend

Serverless Python backend on Google Cloud Platform for issuing, verifying, revoking and
downloading digitally signed PDF certificates.

| Concern | Service |
|---|---|
| API routing | API Gateway (OpenAPI 3.0) |
| Compute | Cloud Run functions (2nd gen, Python 3.12), one per route |
| Database | Cloud Firestore, Native mode (the only primary database) |
| Files | Cloud Storage, private bucket |
| Signing | Cloud KMS asymmetric RSA key (RSA + SHA-256) |
| Admin identity | Identity Platform + Firebase Admin SDK |
| Observability | Cloud Logging (structured JSON) and Cloud Monitoring |

> **Honest status.** Everything in this repository was written and unit-tested locally
> (221 tests, no cloud access needed). **Nothing has been deployed or run against a real
> GCP project**, and no resource exists until *you* create it with the steps below. See
> [Known limitations](#known-limitations) and [Troubleshooting](#troubleshooting).

See [ARCHITECTURE.md](ARCHITECTURE.md) for the design, data model, signing scheme and
threat notes.

---------------------------------------------------------------------

## 1. Prerequisites

* Python 3.12 (3.11–3.13 work for local tests; the deployed runtime is `python312`)
* Google Cloud SDK (`gcloud`) and a GCP project **with billing enabled**
* Bash (Linux, macOS, WSL or Cloud Shell) for the scripts in `scripts/`
* Optional: Node.js + `firebase-tools` and Java (only for the Firestore emulator)
* VS Code with the Python extension is fine; nothing here is editor-specific

Permissions for the person deploying: Project Owner is simplest for a personal/learning
project. For a team, grant roles to deploy Cloud Run functions, manage API Gateway,
KMS, Firestore, Storage and service accounts, plus `roles/iam.serviceAccountUser` on the
runtime service accounts (see [IAM](#6-iam-least-privilege)).

## 2. Project layout

```
functions/<name>/main.py + requirements.txt   one Cloud Run function per route
shared/                                       config, services, repositories (copied into each deployment)
api/openapi.yaml                              API documentation AND API Gateway configuration
scripts/                                      setup, KMS, IAM, deploy functions, deploy API Gateway
tests/                                        pytest suite (mocks all Google Cloud services)
firestore.rules, firestore.indexes.json       security rules (deny-all for clients) and indexes
cloudbuild.yaml                               optional CI/CD
```

| Function | Route | Auth |
|---|---|---|
| `create_certificate` | `POST /admin/certificates` | admin |
| `list_certificates` | `GET /admin/certificates` | admin |
| `get_certificate` | `GET /admin/certificates/{id}` | admin |
| `revoke_certificate` | `PATCH /admin/certificates/{id}/revoke` | admin |
| `download_certificate` | `GET /admin/certificates/{id}/download` | admin |
| `verify_certificate` | `GET /verify/{id}` | public |
| `verify_certificate_file` | `POST /verify/{id}/file` | public |

## 3. Local development (VS Code)

```bash
cd certificate-generation-verification
python3 -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env                 # then edit the values
python -m pytest                     # 221 tests, no GCP needed
```

Select `.venv` as the interpreter in VS Code (`Python: Select Interpreter`). `pytest.ini`
already puts the project root on `PYTHONPATH`.

### Running a function locally

Functions need real (or emulated) Firestore/Storage/KMS. With Application Default
Credentials:

```bash
gcloud auth application-default login
gcloud config set project YOUR_PROJECT
set -a; source .env; set +a
export PYTHONPATH=$PWD
functions-framework --source functions/verify_certificate/main.py \
                    --target verify_certificate --port 8081
curl -i http://localhost:8081/verify/CERT-2026-00000000000000000000
```

Use a different `--port` per function (8081…8087) to run several at once. Paths are the
public API paths, e.g. `http://localhost:8082/admin/certificates`.

* **Offline signing:** `USE_LOCAL_DEV_SIGNER=true` swaps Cloud KMS for an in-memory key.
  It is **test-only**: signatures vanish on restart, it is rejected when
  `ENVIRONMENT=production`, and the deploy script strips `shared/dev_signer.py` from
  every package. To use real KMS locally, create the key first (section 5) and make sure
  your own user has `roles/cloudkms.signerVerifier` on it.
* **Firestore emulator (optional, untested here):** `firebase emulators:start --only
  firestore --project demo-certs` then `export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`.
  The Cloud Storage and KMS emulators do not exist, so use a real dev bucket/key or only
  the unit tests for those parts.
* **Signed URLs locally:** user credentials cannot sign. Set
  `SIGNED_URL_SERVICE_ACCOUNT` to a service account you hold
  `roles/iam.serviceAccountTokenCreator` on.
* `ENVIRONMENT=development` and `CORS_ALLOWED_ORIGINS=http://localhost:5173` are suitable
  for a local React app.

## 4. Authentication setup (Identity Platform)

1. Run `scripts/setup_gcp.sh` (it enables `identitytoolkit.googleapis.com`).
2. In the console open **Identity Platform** (`console.cloud.google.com/customer-identity`),
   click **Enable**, and add the **Email/Password** provider. This step is manual.
3. Create your first administrator account (Console → Identity Platform → Users → Add user,
   or sign up from your frontend) and **verify the email** (the allow-list requires a
   verified email).

### First-administrator provisioning (pick one)

* **Allow-list:** put the email in `ADMIN_EMAILS` (comma separated) and redeploy.
  The token must show `email_verified: true`.
* **Custom claim (recommended long-term):**
  ```bash
  gcloud auth application-default login
  pip install firebase-admin
  python3 scripts/grant_admin_claim.py --project YOUR_PROJECT --email you@example.com
  ```
  The user must sign in again to receive the new claim. Revoke with `--revoke`.

Being signed in is **never** enough: every admin route re-verifies the ID token and checks
the claim/allow-list. Roles or emails sent in a request body are ignored (unknown body
fields are rejected).

## 5. Create the cloud resources

Nothing exists yet. Run these **in order** (each script is idempotent):

```bash
gcloud auth login
cp .env.example .env && $EDITOR .env      # set project, region, bucket, key names, URLs
scripts/setup_gcp.sh          # APIs, private bucket, Firestore (Native), indexes
scripts/create_kms_key.sh     # key ring + asymmetric signing key (version 1)
scripts/configure_iam.sh      # 4 service accounts with least-privilege roles
scripts/deploy_functions.sh   # build self-contained packages, deploy 7 private functions
scripts/deploy_api.sh         # render OpenAPI, create API config and gateway
```

### Required APIs

`run`, `cloudfunctions`, `cloudbuild`, `artifactregistry`, `firestore`, `storage`,
`cloudkms`, `identitytoolkit`, `apigateway`, `servicemanagement`, `servicecontrol`,
`iam`, `iamcredentials`, `logging`, `monitoring` (`.googleapis.com`) — enabled by
`setup_gcp.sh`.

### Resources created

* Bucket `gs://$GCS_BUCKET_NAME` — uniform access, public access prevention enforced
* Firestore database `$FIRESTORE_DATABASE` in `$GOOGLE_CLOUD_LOCATION` (location is permanent;
  it must be a valid Firestore location, check `gcloud firestore locations list`)
* KMS key ring `$KMS_KEY_RING`, key `$KMS_KEY_NAME` (`rsa-sign-pkcs1-3072-sha256`, software
  protection; set `KMS_PROTECTION_LEVEL=hsm` for HSM)
* Service accounts `cert-create-sa`, `cert-admin-sa`, `cert-verify-sa`, `cert-gateway-sa`
* Cloud Run functions `cert-create-certificate`, `cert-list-certificates`,
  `cert-get-certificate`, `cert-revoke-certificate`, `cert-download-certificate`,
  `cert-verify-certificate`, `cert-verify-certificate-file`
* API `certificate-api` and gateway `certificate-gateway`

### KMS notes

* The key is created **once**. Every certificate stores the exact **key version** that
  signed it (`kms_key_version`), so rotating the key later (a new primary version, update
  `KMS_KEY_VERSION`) never invalidates old certificates.
* Do **not** disable or destroy a version that signed live certificates — verification of
  those would fail closed.
* KMS key rings and keys can never be deleted, only key versions destroyed.
* Private key material never leaves KMS and is never in code, env vars, Firestore or Storage.

## 6. IAM (least privilege)

`scripts/configure_iam.sh` grants only:

| Service account | Used by | Roles |
|---|---|---|
| `cert-create-sa` | create | `datastore.user` (project), `storage.objectAdmin` (bucket), `cloudkms.signerVerifier` (key), self `serviceAccountTokenCreator` |
| `cert-admin-sa` | list/get/revoke/download | `datastore.user` (project), `storage.objectViewer` (bucket), self `serviceAccountTokenCreator` |
| `cert-verify-sa` | both verify functions | `datastore.viewer` (project), `cloudkms.publicKeyViewer` (key) — **cannot sign** |
| `cert-gateway-sa` | API Gateway | `run.invoker` on each function only (`configure_iam.sh invoker`, run by the deploy script) |

No runtime account has Owner/Editor. Firestore IAM is project-wide (it cannot be scoped to
one collection); Firestore security rules deny every direct client access.

**Signed download URLs** are keyless V4 URLs: the function's service account signs through
the IAM Credentials `signBlob` API, which requires the account to hold
`roles/iam.serviceAccountTokenCreator` **on itself** (granted above). The URL only works
while that account can read the object.

**The deployer** needs `roles/iam.serviceAccountUser` on the four service accounts. Set
`DEPLOYER_MEMBER=user:you@example.com` in `.env` and `configure_iam.sh` grants it.

**Function access:** all functions are deployed with `--no-allow-unauthenticated`; only
`cert-gateway-sa` may invoke them, so the only public entry point is API Gateway. The
`/verify/**` routes are *deliberately public at the gateway* (no security requirement) and
expose public fields only; `/admin/**` routes require a Firebase ID token validated at the
gateway **and** again inside the function.

## 7. Testing

```bash
python -m pytest                  # everything
python -m pytest tests/test_verification.py -v
```

Covered: valid/invalid creation, ID uniqueness, PDF + QR (QR decoded and checked to contain
only the URL), canonical metadata and hashing, sign/verify (PKCS#1 and PSS, fake KMS with
checksum validation), tampered metadata and PDF bytes, missing/revoked/expired records,
invalid/oversized uploads, unauthorized admin calls on every admin route, pagination
(including identical timestamps), Storage/Firestore failures with rollback, generic error
responses, CORS, and consistency between `api/openapi.yaml`, the handlers and the deploy
scripts. Unit tests never touch GCP.

**Integration tests (optional):** start the Firestore emulator (above) and point a real
`FirestoreRepository` at it; the repository takes an injectable client and transaction
runner for exactly this reason. Run them against a throw-away project, never production.

## 8. Deployment details

* `scripts/deploy_functions.sh` copies `functions/<name>/main.py`, its `requirements.txt` and
  `shared/` into `build/<name>/` (minus `dev_signer.py`) and runs `gcloud functions deploy
  --gen2 --runtime=python312 --trigger-http --no-allow-unauthenticated`, passing environment
  from `.env` via `--env-vars-file`. Redeploy one function: `scripts/deploy_functions.sh
  verify_certificate`.
* `scripts/deploy_api.sh` reads each function's URL, renders `api/openapi.yaml` with them
  (`scripts/render_openapi.py` fails if any value is missing), creates a new timestamped API
  config with `--backend-auth-service-account`, enables the managed service and creates or
  updates the gateway. `GATEWAY_LOCATION` defaults to `us-central1`; API Gateway is only
  available in some regions, so it may differ from your function region.
* Backend URLs are configuration, not code: nothing is hard-coded in `openapi.yaml`.
* **Cloud Build** (`cloudbuild.yaml`): runs tests then both deploy scripts. Its service
  account needs rights to deploy functions, act as the four service accounts, and manage
  API Gateway; grant these deliberately before using it.

After `deploy_api.sh` prints the gateway hostname, point the React app at
`https://<hostname>`. The verification page URL (`PUBLIC_VERIFICATION_BASE_URL`, with the
certificate ID appended) is what the QR code contains, so build a frontend route for it.

## 9. Sample requests

Get an ID token (replace the Web API key from Identity Platform → Application setup):

```bash
API_KEY=...; EMAIL=you@example.com; PASSWORD=...
TOKEN=$(curl -s "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$API_KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"returnSecureToken\":true}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["idToken"])')
GW=https://YOUR-GATEWAY-HOSTNAME
```

Issue a certificate:

```bash
curl -s -X POST "$GW/admin/certificates" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{
    "recipient_name": "Asha Verma",
    "recipient_email": "asha@example.com",
    "course_name": "Cloud Architecture Fundamentals",
    "organization_name": "Example Academy",
    "expiry_date": "2028-12-31T23:59:59Z"
  }'
```
→ `201` with `certificate_id`, `verification_url`, `certificate`, `download.url` (short-lived).

Public verification and PDF check:

```bash
curl -s "$GW/verify/CERT-2026-0123456789ABCDEF0123"
curl -s -X POST "$GW/verify/CERT-2026-0123456789ABCDEF0123/file" -F "file=@certificate.pdf"
```

```json
{ "certificate_id": "CERT-2026-0123456789ABCDEF0123", "record_found": true, "status": "VALID",
  "certificate_status": "VALID", "metadata_signature_valid": true,
  "pdf_integrity_verified": null,
  "message": "Certificate record and metadata signature verified" }
```

`pdf_integrity_verified` is `null` for ID-only checks, `true` only when the uploaded bytes match
the stored digest *and* signature, and `false` (with `status: "TAMPERED"`) otherwise.

Admin operations:

```bash
curl -s "$GW/admin/certificates?page_size=25&status=VALID" -H "Authorization: Bearer $TOKEN"
curl -s "$GW/admin/certificates?page_token=<next_page_token>" -H "Authorization: Bearer $TOKEN"
curl -s "$GW/admin/certificates/$ID" -H "Authorization: Bearer $TOKEN"
curl -s -X PATCH "$GW/admin/certificates/$ID/revoke" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"reason":"Issued in error"}'
curl -s "$GW/admin/certificates/$ID/download" -H "Authorization: Bearer $TOKEN"   # signed URL
```

Errors share one shape: `{"error": {"code", "message", "request_id", "details"?}}` with status
400, 401, 403, 404, 405, 409, 413, 422 or 500. Quote `request_id` when investigating; search it
in Cloud Logging.

## 10. Observability

Functions print structured JSON to stdout, which Cloud Logging ingests (`severity`, `event`,
`request_id`, `certificate_id`, …). Events include `certificate_created`, `certificate_verified`,
`certificate_tamper_detected`, `metadata_signature_invalid`, `pdf_digest_mismatch`,
`certificate_revoked`, `unauthorized_admin_access`, `kms_sign_failed`, `firestore_error`,
`orphaned_storage_object` (CRITICAL). Tokens, PDFs, private keys and signatures are never logged.
Durable audit events live in the Firestore `audit_events` collection (created, revoked, download URL
issued). Suggested Cloud Monitoring alerts: log-based metrics on `severity>=ERROR`,
`certificate_tamper_detected`, `unauthorized_admin_access` spikes, and function 5xx rate.

## 11. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `Invalid or missing configuration - X` in logs, clients get `configuration_error` | A variable is missing/invalid in the function environment; fix `.env` and redeploy. |
| Function deploy fails with build/permission errors | Grant the Cloud Build/compute build service account the roles Google documents for Cloud Run functions builds (for example `roles/cloudbuild.builds.builder`), then retry. |
| `Permission denied` acting as service account | Grant yourself `roles/iam.serviceAccountUser` on it (`DEPLOYER_MEMBER`). |
| Gateway returns 401 on admin routes | Token expired/wrong project; the token's audience must equal `IDENTITY_PLATFORM_PROJECT_ID`. |
| Gateway returns 403 from the backend | `configure_iam.sh invoker` not run, or function URL changed; rerun it, then `deploy_api.sh`. |
| API config creation rejects the spec | API Gateway's OpenAPI 3.x support is recent; check the error. As a fallback convert `api/openapi.yaml` to OpenAPI 2.0 (`x-google-backend` / `securityDefinitions`) — the handlers don't change. |
| `403 forbidden` for a signed-in user | Not an admin: verify the email, or the `admin` claim, and sign in again. |
| `service_error` on create, log `kms_sign_failed` | `KMS_KEY_VERSION` wrong/not enabled, or `cert-create-sa` lacks `cloudkms.signerVerifier`. |
| Signed URL fails (`signBlob` permission) | The runtime account needs `serviceAccountTokenCreator` on itself; `iamcredentials.googleapis.com` must be enabled. |
| Firestore `FAILED_PRECONDITION … index` on list with `status` | Indexes still building; `gcloud firestore indexes composite list`. |
| Verification says `TAMPERED` for a genuine PDF | Uploaded file was re-saved/printed-to-PDF/converted; only the exact original bytes verify. |
| Non-Latin names show `?` in the PDF | Set `PDF_FONT_PATH` (and `PDF_FONT_BOLD_PATH`) to a Unicode TTF font bundled with the deployment. |

## 12. Cost control

* Everything scales to zero except what you pay for at rest: Cloud KMS key versions (per
  version per month plus per-operation fees; HSM costs more), Cloud Storage and Firestore data.
* Functions use `min-instances` 0 and `--max-instances` (default 10, `MAX_INSTANCES`) to cap spend.
* Use Cloud Billing **budgets and alerts** (`gcloud billing budgets create …` or the console).
* Public routes can be hammered; add API Gateway quotas/Cloud Armor if exposed widely. A PDF upload
  costs a hash + one KMS public-key fetch (cached per instance).
* Check current prices on the Google Cloud pricing pages before leaving resources running.

## 13. Cleanup

```bash
source .env   # or export the same variables
gcloud api-gateway gateways delete certificate-gateway --location=$GATEWAY_LOCATION --project=$GOOGLE_CLOUD_PROJECT
for c in $(gcloud api-gateway api-configs list --api=certificate-api --format='value(name)' --project=$GOOGLE_CLOUD_PROJECT); do
  gcloud api-gateway api-configs delete "${c##*/}" --api=certificate-api --project=$GOOGLE_CLOUD_PROJECT --quiet; done
gcloud api-gateway apis delete certificate-api --project=$GOOGLE_CLOUD_PROJECT --quiet
for f in cert-create-certificate cert-list-certificates cert-get-certificate cert-revoke-certificate \
         cert-download-certificate cert-verify-certificate cert-verify-certificate-file; do
  gcloud functions delete $f --gen2 --region=$GOOGLE_CLOUD_LOCATION --project=$GOOGLE_CLOUD_PROJECT --quiet; done
gcloud storage rm -r gs://$GCS_BUCKET_NAME                       # deletes ALL certificate PDFs
gcloud firestore databases delete --database="$FIRESTORE_DATABASE"   # deletes ALL records
for sa in cert-create-sa cert-admin-sa cert-verify-sa cert-gateway-sa; do
  gcloud iam service-accounts delete $sa@$GOOGLE_CLOUD_PROJECT.iam.gserviceaccount.com --quiet; done
gcloud kms keys versions destroy 1 --key=$KMS_KEY_NAME --keyring=$KMS_KEY_RING --location=$GOOGLE_CLOUD_LOCATION
```
Destroying the KMS version makes **all existing certificates unverifiable** (it is scheduled, with
a default grace period). The key ring and key names remain reserved forever. If the database
refuses deletion, check its delete-protection setting.

## Known limitations

* Not deployed or exercised against live GCP by the author; first deployment may need small
  adjustments (IAM propagation delays, build permissions, regional availability).
* The signature covers certificate metadata and the PDF digest, **not** the mutable `status`
  field. Status integrity relies on Firestore IAM (only the admin/create service accounts can
  write; clients are denied by rules). A Firestore administrator can therefore alter status.
* No idempotency key on `POST /admin/certificates`: retrying a timed-out request may issue a
  second certificate (each has its own ID and can be revoked).
* `EXPIRED` is computed at read time; it is persisted lazily on admin `GET` only, so the list
  `status` filter reflects stored status (`effective_status` in each item is always current).
* The PDF is not self-signed (no embedded PAdES signature): integrity is proven by uploading the
  exact file to the verification endpoint, by design.
* `check_revoked` for Identity Platform tokens is off (avoids an extra network call and IAM role);
  disabled users keep access until their ID token expires (~1 hour).
* Default PDF fonts cover Latin-1; see `PDF_FONT_PATH` for other scripts.
