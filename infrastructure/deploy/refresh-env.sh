#!/usr/bin/env bash
# ==============================================================================
# Yannis EOSE — Refresh .env from AWS Secrets Manager (EC2 deploy)
# Set SECRET_NAME (e.g. yanis-eose) and AWS_REGION. Writes .env in current dir.
# ==============================================================================
set -e
if [ -z "${SECRET_NAME}" ] || [ -z "${AWS_REGION}" ]; then
  echo "SECRET_NAME and AWS_REGION must be set. Skipping refresh-env."
  exit 0
fi
if ! command -v aws &>/dev/null; then
  echo "AWS CLI not found. Skipping refresh-env."
  exit 0
fi
aws secretsmanager get-secret-value \
  --secret-id "${SECRET_NAME}" \
  --region "${AWS_REGION}" \
  --query SecretString \
  --output text > .env 2>/dev/null || true
