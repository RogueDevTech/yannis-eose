#!/usr/bin/env bash
# ==============================================================================
# Yannis EOSE — Provider selector for runtime .env refresh
# Env:
#   DEPLOY_PLATFORM=aws|gcp     → refresh on that provider only
#   DEPLOY_PLATFORM=""  (unset) → refresh on BOTH providers in parallel
# ==============================================================================
set -euo pipefail

DEPLOY_PLATFORM="${DEPLOY_PLATFORM:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

case "$DEPLOY_PLATFORM" in
  gcp)
    exec ./refresh-env-gcp.sh
    ;;
  aws)
    exec ./refresh-env-aws.sh
    ;;
  "")
    echo "DEPLOY_PLATFORM is unset — refreshing env on BOTH providers in parallel."
    ./refresh-env-gcp.sh &
    PID_GCP=$!
    ./refresh-env-aws.sh &
    PID_AWS=$!

    FAILED=0
    wait "$PID_GCP" || { echo "GCP env refresh failed."; FAILED=1; }
    wait "$PID_AWS" || { echo "AWS env refresh failed."; FAILED=1; }
    exit $FAILED
    ;;
  *)
    echo "DEPLOY_PLATFORM must be 'aws', 'gcp', or unset (both)."
    exit 1
    ;;
esac
