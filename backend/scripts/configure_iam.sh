#!/usr/bin/env bash
# Creates the least-privilege service accounts and grants ONLY the roles each one needs.
# No Owner/Editor roles are granted to any runtime service account.
#
# Usage:
#   scripts/configure_iam.sh           # service accounts + resource permissions
#   scripts/configure_iam.sh invoker   # after deploying: let API Gateway invoke the functions
#
# Optional: DEPLOYER_MEMBER=user:you@example.com  (or serviceAccount:...) is granted
# roles/iam.serviceAccountUser on the runtime/gateway service accounts so that
# the deploying principal may attach them to functions and API configs.

### Configures service accounts and permissions.

set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

MODE="${1:-all}"

ensure_service_account() {
  local name="$1" display="$2"
  if gc iam service-accounts describe "$(sa_email "${name}")" >/dev/null 2>&1; then
    echo "Service account ${name} already exists."
  else
    gc iam service-accounts create "${name}" --display-name="${display}"
  fi
}

bind_project() { # <sa name> <role>
  gc projects add-iam-policy-binding "${PROJECT}" \
    --member="serviceAccount:$(sa_email "$1")" --role="$2" --condition=None >/dev/null
  echo "  project: $1 -> $2"
}

bind_bucket() { # <sa name> <role>
  gc storage buckets add-iam-policy-binding "gs://${GCS_BUCKET_NAME}" \
    --member="serviceAccount:$(sa_email "$1")" --role="$2" >/dev/null
  echo "  bucket:  $1 -> $2"
}

bind_key() { # <sa name> <role>
  gc kms keys add-iam-policy-binding "${KMS_KEY_NAME}" \
    --keyring="${KMS_KEY_RING}" --location="${REGION}" \
    --member="serviceAccount:$(sa_email "$1")" --role="$2" >/dev/null
  echo "  kms key: $1 -> $2"
}

bind_self_token_creator() { # lets a service account sign URLs with signBlob (no key file)
  gc iam service-accounts add-iam-policy-binding "$(sa_email "$1")" \
    --member="serviceAccount:$(sa_email "$1")" --role="roles/iam.serviceAccountTokenCreator" >/dev/null
  echo "  self:    $1 -> roles/iam.serviceAccountTokenCreator (V4 signed URLs)"
}

if [[ "${MODE}" == "invoker" ]]; then
  step "Allowing ${SA_GATEWAY} to invoke the deployed functions"
  for spec in "${FUNCTION_SPECS[@]}"; do
    IFS=: read -r svc _entry _sa <<<"${spec}"
    gc functions add-invoker-policy-binding "${svc}" --region="${REGION}" \
      --member="serviceAccount:$(sa_email "${SA_GATEWAY}")" >/dev/null
    echo "  invoker: ${svc}"
  done
  echo "Functions stay private: only ${SA_GATEWAY} may invoke them."
  exit 0
fi

require_var GCS_BUCKET_NAME KMS_KEY_RING KMS_KEY_NAME

step "Creating service accounts"
ensure_service_account "${SA_CREATE}" "Certificates - issue (create function)"
ensure_service_account "${SA_ADMIN}" "Certificates - admin read/revoke/download"
ensure_service_account "${SA_VERIFY}" "Certificates - public verification"
ensure_service_account "${SA_GATEWAY}" "Certificates - API Gateway to functions"

step "Firestore (project-level; IAM cannot scope to one collection)"
bind_project "${SA_CREATE}" roles/datastore.user
bind_project "${SA_ADMIN}" roles/datastore.user
bind_project "${SA_VERIFY}" roles/datastore.viewer

step "Cloud Storage bucket gs://${GCS_BUCKET_NAME}"
bind_bucket "${SA_CREATE}" roles/storage.objectAdmin   # create + delete (rollback) + read for signed URL
bind_bucket "${SA_ADMIN}" roles/storage.objectViewer   # read for signed download URLs

step "Cloud KMS key ${KMS_KEY_NAME}"
bind_key "${SA_CREATE}" roles/cloudkms.signerVerifier  # sign + read public key
bind_key "${SA_VERIFY}" roles/cloudkms.publicKeyViewer # verification only; cannot sign

step "Signed URL support"
bind_self_token_creator "${SA_CREATE}"
bind_self_token_creator "${SA_ADMIN}"

if [[ -n "${DEPLOYER_MEMBER:-}" ]]; then
  step "Letting ${DEPLOYER_MEMBER} deploy with these service accounts"
  for sa in "${SA_CREATE}" "${SA_ADMIN}" "${SA_VERIFY}" "${SA_GATEWAY}"; do
    gc iam service-accounts add-iam-policy-binding "$(sa_email "${sa}")" \
      --member="${DEPLOYER_MEMBER}" --role="roles/iam.serviceAccountUser" >/dev/null
    echo "  serviceAccountUser: ${sa}"
  done
else
  echo
  echo "NOTE: DEPLOYER_MEMBER is not set. Whoever deploys needs roles/iam.serviceAccountUser"
  echo "      on the four service accounts above (see README, section IAM)."
fi

echo
echo "Done. After deploying the functions run: scripts/configure_iam.sh invoker"
