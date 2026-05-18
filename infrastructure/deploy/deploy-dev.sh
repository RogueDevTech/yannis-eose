#!/usr/bin/env bash
# ==============================================================================
# Yannis EOSE — Provider selector for dev deploys
# Env:
#   DEPLOY_PLATFORM=aws|gcp     → deploy to that provider only
#   DEPLOY_PLATFORM=""  (unset) → deploy to BOTH providers in parallel
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
  "")
    echo "DEPLOY_PLATFORM is unset — deploying to BOTH providers in parallel."
    ./deploy-gcp-dev.sh &
    PID_GCP=$!
    ./deploy-aws-dev.sh &
    PID_AWS=$!

    FAILED=0
    wait "$PID_GCP" || { echo "GCP deploy failed."; FAILED=1; }
    wait "$PID_AWS" || { echo "AWS deploy failed."; FAILED=1; }
    exit $FAILED
    ;;
  *)
    echo "DEPLOY_PLATFORM must be 'aws', 'gcp', or unset (both)."
    exit 1
    ;;
esac
