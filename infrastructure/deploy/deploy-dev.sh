#!/usr/bin/env bash
# ==============================================================================
# Yannis EOSE — Provider selector for dev deploys
# Required env:
#   DEPLOY_PLATFORM=aws|gcp
# ==============================================================================
set -euo pipefail

DEPLOY_PLATFORM="${DEPLOY_PLATFORM:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

case "$DEPLOY_PLATFORM" in
  gcp)
    exec ./deploy-gcp-dev.sh
    ;;
  aws)
    exec ./deploy-aws-dev.sh
    ;;
  *)
    echo "DEPLOY_PLATFORM must be set to aws or gcp."
    exit 1
    ;;
esac
