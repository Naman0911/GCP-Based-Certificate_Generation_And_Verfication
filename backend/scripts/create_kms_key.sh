#!/usr/bin/env bash
# Creates the Cloud KMS key ring and the asymmetric RSA signing key used for
# every certificate signature. The key is created ONCE and never per certificate.
#
# Usage: scripts/create_kms_key.sh
# Environment: KMS_KEY_RING, KMS_KEY_NAME (+ optional KMS_PROTECTION_LEVEL=software|hsm,
#              KMS_ALGORITHM, default rsa-sign-pkcs1-3072-sha256)
#
# NOTE: key rings and keys can never be deleted in Cloud KMS (only key versions can
# be scheduled for destruction), and HSM keys cost more than software keys.

### Creates the Cryptographic Keys  

set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
require_var KMS_KEY_RING KMS_KEY_NAME

ALGORITHM="${KMS_ALGORITHM:-rsa-sign-pkcs1-3072-sha256}"
PROTECTION="${KMS_PROTECTION_LEVEL:-software}"

step "Creating key ring ${KMS_KEY_RING} in ${REGION}"
if gc kms keyrings describe "${KMS_KEY_RING}" --location="${REGION}" >/dev/null 2>&1; then
  echo "Key ring already exists."
else
  gc kms keyrings create "${KMS_KEY_RING}" --location="${REGION}"
fi

step "Creating asymmetric signing key ${KMS_KEY_NAME} (${ALGORITHM}, ${PROTECTION})"
if gc kms keys describe "${KMS_KEY_NAME}" --keyring="${KMS_KEY_RING}" --location="${REGION}" >/dev/null 2>&1; then
  echo "Key already exists - not creating another."
else
  gc kms keys create "${KMS_KEY_NAME}" \
    --keyring="${KMS_KEY_RING}" \
    --location="${REGION}" \
    --purpose=asymmetric-signing \
    --default-algorithm="${ALGORITHM}" \
    --protection-level="${PROTECTION}"
fi

step "Key versions"
gc kms keys versions list --key="${KMS_KEY_NAME}" --keyring="${KMS_KEY_RING}" --location="${REGION}"

cat <<MSG

Creating the key also created version 1. Set KMS_KEY_VERSION=1 in .env (or the
version number shown above as ENABLED). Each certificate stores the exact key
version that signed it, so rotating later never breaks old certificates - but
do not disable or destroy a version while certificates signed with it exist.
Next: scripts/configure_iam.sh
MSG
