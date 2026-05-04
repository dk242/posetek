#!/usr/bin/env bash
# Apply CORS to Firebase Storage so localhost (e.g. Live Server) can load pose.json.
# Prerequisites: gcloud/gs from Homebrew `google-cloud-sdk`, and an account with
# storage.buckets.update on project kickai-69dd0.
# Run: gcloud auth login
# Then: ./scripts/apply-storage-cors.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUCKET="gs://kickai-69dd0.firebasestorage.app"
echo "Setting CORS from ${ROOT}/cors.json on ${BUCKET} ..."
gsutil cors set "${ROOT}/cors.json" "${BUCKET}"
echo "Current CORS configuration:"
gsutil cors get "${BUCKET}"
