#!/usr/bin/env bash
# Shared helpers for the deployment scripts. Source this file; do not run it.
#
# Configuration is read from ../.env when present, otherwise from the
# environment (for example when run from Cloud Build).

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export ROOT_DIR

if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/.env"
  set +a
fi

require_cmd() {
  for cmd in "$@"; do
    command -v "${cmd}" >/dev/null 2>&1 || { echo "ERROR: '${cmd}' is not installed or not on PATH." >&2; exit 1; }
  done
}

require_var() {
  for name in "$@"; do
    if [[ -z "${!name:-}" ]]; then
      echo "ERROR: ${name} is not set. Copy .env.example to .env and fill it in." >&2
      exit 1
    fi
  done
}

require_cmd gcloud
require_var GOOGLE_CLOUD_PROJECT GOOGLE_CLOUD_LOCATION

PROJECT="${GOOGLE_CLOUD_PROJECT}"
REGION="${GOOGLE_CLOUD_LOCATION}"
FIRESTORE_DATABASE="${FIRESTORE_DATABASE:-(default)}"

# Least-privilege runtime identities (one per trust level).
SA_CREATE="cert-create-sa"     # issues certificates: Firestore write, bucket write, KMS sign
SA_ADMIN="cert-admin-sa"       # list/get/revoke/download: Firestore write, bucket read
SA_VERIFY="cert-verify-sa"     # public verification: Firestore read, KMS public key only
SA_GATEWAY="cert-gateway-sa"   # identity API Gateway uses to invoke the functions

# "<Cloud Run function name>:<entry point / source directory>:<runtime service account>"
FUNCTION_SPECS=(
  "cert-create-certificate:create_certificate:${SA_CREATE}"
  "cert-list-certificates:list_certificates:${SA_ADMIN}"
  "cert-get-certificate:get_certificate:${SA_ADMIN}"
  "cert-revoke-certificate:revoke_certificate:${SA_ADMIN}"
  "cert-download-certificate:download_certificate:${SA_ADMIN}"
  "cert-verify-certificate:verify_certificate:${SA_VERIFY}"
  "cert-verify-certificate-file:verify_certificate_file:${SA_VERIFY}"
)

sa_email() { echo "${1}@${PROJECT}.iam.gserviceaccount.com"; }

gc() { gcloud --project "${PROJECT}" "$@"; }

step() { echo; echo "==> $*"; }
