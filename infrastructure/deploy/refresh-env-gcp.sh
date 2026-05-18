#!/usr/bin/env bash
# ==============================================================================
# Yannis EOSE — Refresh .env from GCP Secret Manager (GCE deploy)
# Set RUNTIME_ENV_SECRET_NAME (for example `dev-yannis-runtime-env`).
# Secret payload should be raw KEY=value lines written straight to `.env`.
# ==============================================================================
set -euo pipefail

RUNTIME_ENV_SECRET_NAME="${RUNTIME_ENV_SECRET_NAME:-}"
if [ -z "$RUNTIME_ENV_SECRET_NAME" ]; then
  echo "RUNTIME_ENV_SECRET_NAME is not set. Skipping refresh-env."
  exit 0
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud CLI not found. Skipping refresh-env."
  exit 0
fi

RAW="$(gcloud secrets versions access latest --secret="$RUNTIME_ENV_SECRET_NAME" 2>/dev/null || true)"
if [ -z "$RAW" ]; then
  echo "No secret value returned. Leaving .env unchanged."
  exit 0
fi

printf '%s\n' "$RAW" | tr -d '\r' > .env
chmod 600 .env
echo "Refreshed .env from Secret Manager."
