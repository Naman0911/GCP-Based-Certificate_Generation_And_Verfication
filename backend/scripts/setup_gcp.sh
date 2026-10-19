#!/usr/bin/env bash
# Enables the required Google Cloud APIs and creates the private bucket,
# the Firestore (Native mode) database and the Firestore indexes.
#
# Usage: scripts/setup_gcp.sh        (idempotent; safe to re-run)
# Requires: gcloud authenticated (gcloud auth login) with permission to enable
# services and create buckets/databases in the project.

##### This is used to prepare the GCP resurces and APIs 

set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
require_var GCS_BUCKET_NAME

step "Enabling required APIs in ${PROJECT}"
gc services enable \
  run.googleapis.com \
  cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  firestore.googleapis.com \
  storage.googleapis.com \
  cloudkms.googleapis.com \
  identitytoolkit.googleapis.com \
  apigateway.googleapis.com \
  servicemanagement.googleapis.com \
  servicecontrol.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com

step "Creating private Cloud Storage bucket gs://${GCS_BUCKET_NAME}"
if gc storage buckets describe "gs://${GCS_BUCKET_NAME}" >/dev/null 2>&1; then
  echo "Bucket already exists - leaving it unchanged."
else
  gc storage buckets create "gs://${GCS_BUCKET_NAME}" \
    --location="${REGION}" \
    --uniform-bucket-level-access \
    --public-access-prevention
fi

step "Creating Firestore database ${FIRESTORE_DATABASE} (Native mode) in ${REGION}"
if gc firestore databases describe --database="${FIRESTORE_DATABASE}" >/dev/null 2>&1; then
  echo "Database already exists - leaving it unchanged."
else
  # The Firestore location cannot be changed later. It must be a valid Firestore
  # location (see https://cloud.google.com/firestore/docs/locations).
  gc firestore databases create \
    --database="${FIRESTORE_DATABASE}" \
    --location="${REGION}" \
    --type=firestore-native
fi

create_index() {
  # Re-running reports "already exists"; that is not an error here.
  if ! output="$(gc firestore indexes composite create --database="${FIRESTORE_DATABASE}" "$@" 2>&1)"; then
    if grep -qi "already exists" <<<"${output}"; then
      echo "Index already exists."
    else
      echo "${output}" >&2
      exit 1
    fi
  else
    echo "${output}"
  fi
}

step "Creating Firestore composite indexes (also described in firestore.indexes.json)"
create_index --collection-group=certificates --query-scope=collection \
  --field-config=field-path=status,order=ascending \
  --field-config=field-path=created_at,order=descending
create_index --collection-group=audit_events --query-scope=collection \
  --field-config=field-path=certificate_id,order=ascending \
  --field-config=field-path=created_at,order=descending

cat <<MSG

Done. Manual steps that cannot be scripted safely:
  1. Identity Platform: open https://console.cloud.google.com/customer-identity
     for project ${IDENTITY_PLATFORM_PROJECT_ID:-<your project>}, click "Enable", then add the
     "Email/Password" provider and create your first administrator account.
  2. Optional - deploy Firestore security rules (deny-all for clients):
       firebase deploy --only firestore:rules --project ${PROJECT}
Next: scripts/create_kms_key.sh
MSG
