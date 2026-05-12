#!/usr/bin/env bash
# ==============================================================================
# Yannis EOSE — AWS adapter for the shared dev deploy flow
#
# Required env:
#   AWS_REGION
#   AWS_ACCOUNT_ID
#   SECRET_NAME
#
# Optional env:
#   IMAGE_TAG                 default: dev-latest
# ==============================================================================
set -euo pipefail

AWS_REGION="${AWS_REGION:-}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-}"
SECRET_NAME="${SECRET_NAME:-}"
IMAGE_TAG="${IMAGE_TAG:-dev-latest}"

if [ -z "$AWS_REGION" ] || [ -z "$AWS_ACCOUNT_ID" ] || [ -z "$SECRET_NAME" ]; then
  echo "AWS_REGION, AWS_ACCOUNT_ID, and SECRET_NAME are required."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

chmod +x ./refresh-env-aws.sh ./deploy-runtime.sh ./run-migrations.sh
./refresh-env-aws.sh

ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

echo "→ Authenticating Docker to ECR..."
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ECR_REGISTRY"

COMPOSE_FILES="${COMPOSE_FILES:-docker-compose.runtime.yml docker-compose.runtime.tunnel.yml}" \
IMAGE_REGISTRY="$ECR_REGISTRY" \
IMAGE_TAG="$IMAGE_TAG" \
./deploy-runtime.sh
