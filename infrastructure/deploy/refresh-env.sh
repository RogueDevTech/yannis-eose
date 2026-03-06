#!/usr/bin/env bash
# ==============================================================================
# Yannis EOSE — Refresh .env from AWS Secrets Manager (EC2 deploy)
# Set SECRET_NAME (e.g. yanis-eose) and AWS_REGION. Writes .env in current dir.
# Secret must be JSON key/value; output is KEY=value lines for Docker Compose.
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

RAW=$(aws secretsmanager get-secret-value \
  --secret-id "${SECRET_NAME}" \
  --region "${AWS_REGION}" \
  --query SecretString \
  --output text 2>/dev/null) || true

if [ -z "$RAW" ]; then
  echo "No secret value returned. Leaving .env unchanged."
  exit 0
fi

# If it looks like JSON, convert to KEY=value lines; otherwise write as-is
if echo "$RAW" | grep -q '^[[:space:]]*{'; then
  if command -v jq &>/dev/null; then
    # Escape for .env: backslash, double-quote, newline
    echo "$RAW" | jq -r 'to_entries[] | (.key + "=\"" + (.value | tostring | gsub("\\\\"; "\\\\") | gsub("\""; "\\\"") | gsub("\n"; "\\n")) + "\"")' > .env
  elif command -v python3 &>/dev/null; then
    # Fallback: Python (common on Ubuntu) — output KEY=value, one per line
    echo "$RAW" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for k, v in d.items():
    s = str(v).replace('\\\\', '\\\\\\\\').replace('\"', '\\\\\"').replace('\n', '\\\\n')
    print(f'{k}=\"{s}\"')
" > .env
  else
    echo "jq or python3 required for JSON secrets. Install jq, or store secret as plain KEY=value."
    exit 0
  fi
else
  echo "$RAW" > .env
fi

echo "Refreshed .env from Secrets Manager."
