#!/usr/bin/env bash
# ==============================================================================
# Run SQL migrations before docker compose up — uses the same runner as the API
# (`runSqlMigrations` in @yannis/shared). Requires DATABASE_URL in .env (same as api).
#
# Usage on the runtime VM (from directory containing docker-compose.runtime.yml and .env):
#   chmod +x run-migrations.sh
#   ./run-migrations.sh
#
# Env:
#   COMPOSE_FILES  space-separated compose files (default: docker-compose.runtime.yml)
#   PGSSLMODE      set to require for Aiven / SSL-only Postgres (default: require)
#   IMAGE_REGISTRY override compose image registry
#   IMAGE_TAG      override compose image tag
# ==============================================================================
set -euo pipefail

COMPOSE_FILES="${COMPOSE_FILES:-docker-compose.runtime.yml}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export PGSSLMODE="${PGSSLMODE:-require}"

compose_args=()
for file in $COMPOSE_FILES; do
  compose_args+=(-f "$file")
done

if ! grep -q '^DATABASE_URL=' .env 2>/dev/null; then
  echo "ERROR: DATABASE_URL missing from .env — migrations cannot run."
  exit 1
fi

echo "→ Running DB migrations via API image (tsx cli → runSqlMigrations)..."
docker compose "${compose_args[@]}" run --rm --no-deps \
  -e PGSSLMODE \
  api \
  sh -lc '
    set -e
    TSX=""
    for p in /app/node_modules/tsx/dist/cli.mjs /app/node_modules/tsx/dist/cli.cjs; do
      if [ -f "$p" ]; then TSX="$p"; break; fi
    done
    if [ -z "$TSX" ]; then
      TSX=$(find /app/node_modules -path "*/tsx/dist/cli.mjs" 2>/dev/null | head -1 || true)
    fi
    if [ -z "$TSX" ] || [ ! -f "$TSX" ]; then
      echo "ERROR: tsx CLI not found under /app/node_modules — rebuild API image after dependency update."
      exit 1
    fi
    exec node "$TSX" /app/packages/shared/src/migrations/cli.ts
  '

echo "→ Migrations finished OK."
