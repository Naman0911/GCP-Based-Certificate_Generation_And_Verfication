#!/usr/bin/env bash
# Renders api/openapi.yaml with the real backend URLs and (re)deploys API Gateway.
#
# Usage: scripts/deploy_api.sh
# Optional: API_ID (default certificate-api), GATEWAY_ID (default certificate-gateway),
#           GATEWAY_LOCATION (default us-central1; API Gateway is only available in
#           selected regions - see the API Gateway locations documentation).
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
require_var IDENTITY_PLATFORM_PROJECT_ID
require_cmd python3

API_ID="${API_ID:-certificate-api}"
GATEWAY_ID="${GATEWAY_ID:-certificate-gateway}"
GATEWAY_LOCATION="${GATEWAY_LOCATION:-us-central1}"
BUILD_DIR="${ROOT_DIR}/build"
mkdir -p "${BUILD_DIR}"

function_url() { # <function name>
  local url
  url="$(gc functions describe "$1" --gen2 --region="${REGION}" --format='value(serviceConfig.uri)')"
  if [[ -z "${url}" ]]; then
    echo "ERROR: could not read the URL of function $1. Deploy it first (scripts/deploy_functions.sh)." >&2
    exit 1
  fi
  echo "${url}"
}

step "Reading deployed function URLs"
CREATE_CERTIFICATE_URL="$(function_url cert-create-certificate)"
LIST_CERTIFICATES_URL="$(function_url cert-list-certificates)"
GET_CERTIFICATE_URL="$(function_url cert-get-certificate)"
REVOKE_CERTIFICATE_URL="$(function_url cert-revoke-certificate)"
DOWNLOAD_CERTIFICATE_URL="$(function_url cert-download-certificate)"
VERIFY_CERTIFICATE_URL="$(function_url cert-verify-certificate)"
VERIFY_CERTIFICATE_FILE_URL="$(function_url cert-verify-certificate-file)"
export CREATE_CERTIFICATE_URL LIST_CERTIFICATES_URL GET_CERTIFICATE_URL REVOKE_CERTIFICATE_URL \
  DOWNLOAD_CERTIFICATE_URL VERIFY_CERTIFICATE_URL VERIFY_CERTIFICATE_FILE_URL IDENTITY_PLATFORM_PROJECT_ID

step "Rendering OpenAPI specification"
python3 "${ROOT_DIR}/scripts/render_openapi.py" --output "${BUILD_DIR}/openapi-rendered.yaml"

step "Ensuring API ${API_ID} exists"
if gc api-gateway apis describe "${API_ID}" >/dev/null 2>&1; then
  echo "API already exists."
else
  gc api-gateway apis create "${API_ID}" --display-name="Certificate Generation and Verification API"
fi

CONFIG_ID="${API_ID}-$(date -u +%Y%m%d-%H%M%S)"
step "Creating API config ${CONFIG_ID}"
gc api-gateway api-configs create "${CONFIG_ID}" \
  --api="${API_ID}" \
  --openapi-spec="${BUILD_DIR}/openapi-rendered.yaml" \
  --backend-auth-service-account="$(sa_email "${SA_GATEWAY}")"

step "Enabling the managed service for the API"
MANAGED_SERVICE="$(gc api-gateway apis describe "${API_ID}" --format='value(managedService)')"
gc services enable "${MANAGED_SERVICE}"

step "Deploying gateway ${GATEWAY_ID} in ${GATEWAY_LOCATION}"
if gc api-gateway gateways describe "${GATEWAY_ID}" --location="${GATEWAY_LOCATION}" >/dev/null 2>&1; then
  gc api-gateway gateways update "${GATEWAY_ID}" \
    --api="${API_ID}" --api-config="${CONFIG_ID}" --location="${GATEWAY_LOCATION}"
else
  gc api-gateway gateways create "${GATEWAY_ID}" \
    --api="${API_ID}" --api-config="${CONFIG_ID}" --location="${GATEWAY_LOCATION}"
fi

HOSTNAME="$(gc api-gateway gateways describe "${GATEWAY_ID}" --location="${GATEWAY_LOCATION}" --format='value(defaultHostname)')"
cat <<MSG

Gateway ready: https://${HOSTNAME}
  Public check:  curl -i https://${HOSTNAME}/verify/CERT-2026-00000000000000000000   (expects 404 INVALID)
  Admin routes require an Identity Platform ID token (see README, "Sample requests").
Use https://${HOSTNAME} as the base URL in the React frontend.
MSG
