#!/usr/bin/env bash
# Builds a self-contained package per function (main.py + requirements.txt + shared/)
# and deploys it as a private Cloud Run function (2nd gen, Python 3.12).
#
# Usage: scripts/deploy_functions.sh [function_dir ...]
#        e.g. scripts/deploy_functions.sh create_certificate verify_certificate
#
# The test-only signer (shared/dev_signer.py) is removed from every package.
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
require_var GCS_BUCKET_NAME KMS_KEY_RING KMS_KEY_NAME KMS_KEY_VERSION \
  IDENTITY_PLATFORM_PROJECT_ID PUBLIC_VERIFICATION_BASE_URL

ENVIRONMENT="${ENVIRONMENT:-production}"
if [[ "${ENVIRONMENT}" == "production" && "${USE_LOCAL_DEV_SIGNER:-false}" == "true" ]]; then
  echo "ERROR: USE_LOCAL_DEV_SIGNER=true is forbidden when ENVIRONMENT=production." >&2
  exit 1
fi

BUILD_DIR="${ROOT_DIR}/build"
rm -rf "${BUILD_DIR}"
mkdir -p "${BUILD_DIR}"

# Environment variables for the functions (a file avoids comma-escaping problems).
ENV_FILE="${BUILD_DIR}/env.yaml"
: > "${ENV_FILE}"
add_env() {
  local name="$1" value="${2:-}"
  [[ -z "${value}" ]] && return 0
  if [[ "${value}" == *'"'* || "${value}" == *$'\n'* ]]; then
    echo "ERROR: ${name} must not contain quotes or newlines." >&2
    exit 1
  fi
  printf '%s: "%s"\n' "${name}" "${value}" >> "${ENV_FILE}"
}
add_env GOOGLE_CLOUD_PROJECT "${PROJECT}"
add_env GOOGLE_CLOUD_LOCATION "${REGION}"
add_env FIRESTORE_DATABASE "${FIRESTORE_DATABASE}"
add_env GCS_BUCKET_NAME "${GCS_BUCKET_NAME}"
add_env KMS_KEY_RING "${KMS_KEY_RING}"
add_env KMS_KEY_NAME "${KMS_KEY_NAME}"
add_env KMS_KEY_VERSION "${KMS_KEY_VERSION}"
add_env IDENTITY_PLATFORM_PROJECT_ID "${IDENTITY_PLATFORM_PROJECT_ID}"
add_env ADMIN_EMAILS "${ADMIN_EMAILS:-}"
add_env PUBLIC_VERIFICATION_BASE_URL "${PUBLIC_VERIFICATION_BASE_URL}"
add_env MAX_UPLOAD_SIZE_MB "${MAX_UPLOAD_SIZE_MB:-10}"
add_env SIGNED_URL_EXPIRATION_MINUTES "${SIGNED_URL_EXPIRATION_MINUTES:-10}"
add_env ENVIRONMENT "${ENVIRONMENT}"
add_env LOG_LEVEL "${LOG_LEVEL:-INFO}"
add_env CORS_ALLOWED_ORIGINS "${CORS_ALLOWED_ORIGINS:-}"

SELECTED=("$@")
want() {
  [[ ${#SELECTED[@]} -eq 0 ]] && return 0
  for item in "${SELECTED[@]}"; do [[ "${item}" == "$1" ]] && return 0; done
  return 1
}

DEPLOYED=0
for spec in "${FUNCTION_SPECS[@]}"; do
  IFS=: read -r svc entry sa <<<"${spec}"
  want "${entry}" || continue

  step "Packaging ${entry}"
  stage="${BUILD_DIR}/${entry}"
  mkdir -p "${stage}"
  cp "${ROOT_DIR}/functions/${entry}/main.py" "${ROOT_DIR}/functions/${entry}/requirements.txt" "${stage}/"
  cp -R "${ROOT_DIR}/shared" "${stage}/shared"
  rm -f "${stage}/shared/dev_signer.py"
  find "${stage}" -name '__pycache__' -type d -prune -exec rm -rf {} +

  step "Deploying ${svc} (entry point ${entry}) as $(sa_email "${sa}")"
  memory="512Mi"
  gc functions deploy "${svc}" \
    --gen2 \
    --region="${REGION}" \
    --runtime=python312 \
    --source="${stage}" \
    --entry-point="${entry}" \
    --trigger-http \
    --no-allow-unauthenticated \
    --service-account="$(sa_email "${sa}")" \
    --env-vars-file="${ENV_FILE}" \
    --memory="${memory}" \
    --timeout=60s \
    --max-instances="${MAX_INSTANCES:-10}"
  DEPLOYED=$((DEPLOYED + 1))
done

if [[ "${DEPLOYED}" -eq 0 ]]; then
  echo "ERROR: no function matched: ${SELECTED[*]:-}" >&2
  exit 1
fi

step "Granting the API Gateway service account permission to invoke the functions"
"${ROOT_DIR}/scripts/configure_iam.sh" invoker

echo
echo "Deployed ${DEPLOYED} function(s). Next: scripts/deploy_api.sh"
