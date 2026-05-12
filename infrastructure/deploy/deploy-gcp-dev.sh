#!/usr/bin/env bash
# ==============================================================================
# Yannis EOSE — GCP adapter for the shared dev deploy flow
#
# Required env:
#   GCP_REGION                e.g. us-central1
#   GCP_PROJECT_ID
#   ARTIFACT_REPOSITORY_ID    e.g. dev-yannis-eose
#   RUNTIME_ENV_SECRET_NAME   e.g. dev-yannis-runtime-env
#
# Optional env:
#   IMAGE_TAG                 default: dev-latest
# ==============================================================================
set -euo pipefail

GCP_REGION="${GCP_REGION:-}"
GCP_PROJECT_ID="${GCP_PROJECT_ID:-}"
ARTIFACT_REPOSITORY_ID="${ARTIFACT_REPOSITORY_ID:-}"
RUNTIME_ENV_SECRET_NAME="${RUNTIME_ENV_SECRET_NAME:-}"
IMAGE_TAG="${IMAGE_TAG:-dev-latest}"

if [ -z "$GCP_REGION" ] || [ -z "$GCP_PROJECT_ID" ] || [ -z "$ARTIFACT_REPOSITORY_ID" ]; then
  echo "GCP_REGION, GCP_PROJECT_ID, and ARTIFACT_REPOSITORY_ID are required."
  exit 1
fi

ARTIFACT_REGISTRY_HOST="${ARTIFACT_REGISTRY_HOST:-${GCP_REGION}-docker.pkg.dev}"
IMAGE_REGISTRY="${ARTIFACT_REGISTRY_HOST}/${GCP_PROJECT_ID}/${ARTIFACT_REPOSITORY_ID}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

chmod +x ./refresh-env-gcp.sh ./deploy-runtime.sh ./run-migrations.sh
if [ -n "$RUNTIME_ENV_SECRET_NAME" ]; then
  ./refresh-env-gcp.sh
fi

echo "→ Authenticating Docker to Artifact Registry..."
gcloud auth configure-docker "$ARTIFACT_REGISTRY_HOST" --quiet

COMPOSE_FILES="${COMPOSE_FILES:-docker-compose.runtime.yml docker-compose.runtime.tunnel.yml}" \
IMAGE_REGISTRY="$IMAGE_REGISTRY" \
IMAGE_TAG="$IMAGE_TAG" \
./deploy-runtime.sh
