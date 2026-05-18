#!/usr/bin/env bash
# ==============================================================================
# Yannis EOSE — Shared runtime deploy for provider adapters
#
# Zero-downtime strategy:
#   1. Pull new images WHILE old containers keep running
#   2. Run DB migrations (backward-compatible by convention)
#   3. Recreate containers one-by-one (docker compose up -d --no-deps)
#   4. Health-check the new stack
#   5. Only prune old images after success
#   6. If health checks fail → auto-rollback to previous images
#
# Required env:
#   IMAGE_REGISTRY
#   IMAGE_TAG
#
# Optional env:
#   COMPOSE_FILES   space-separated compose files (default: docker-compose.runtime.yml)
# ==============================================================================
set -euo pipefail

IMAGE_REGISTRY="${IMAGE_REGISTRY:-}"
IMAGE_TAG="${IMAGE_TAG:-dev-latest}"
COMPOSE_FILES="${COMPOSE_FILES:-docker-compose.runtime.yml}"

if [ -z "$IMAGE_REGISTRY" ]; then
  echo "IMAGE_REGISTRY is required."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

compose_args=()
for file in $COMPOSE_FILES; do
  compose_args+=(-f "$file")
done

export IMAGE_REGISTRY IMAGE_TAG

if ! grep -q '^DATABASE_URL=' .env 2>/dev/null; then
  echo "DATABASE_URL missing from .env"
  exit 1
fi
if ! grep -q '^REDIS_URL=' .env 2>/dev/null; then
  echo "REDIS_URL missing from .env"
  exit 1
fi

# ---------------------------------------------------------------------------
# 0. Capture current image digests so we can rollback if the new deploy fails
# ---------------------------------------------------------------------------
PREV_API_IMAGE=$(docker inspect --format='{{.Image}}' "$(docker compose "${compose_args[@]}" ps -q api 2>/dev/null || true)" 2>/dev/null || echo "")
PREV_WEB_IMAGE=$(docker inspect --format='{{.Image}}' "$(docker compose "${compose_args[@]}" ps -q web 2>/dev/null || true)" 2>/dev/null || echo "")

# ---------------------------------------------------------------------------
# 1. Pull new images while old containers keep serving traffic
# ---------------------------------------------------------------------------
echo "→ Pulling new images (old containers still running)..."
docker compose "${compose_args[@]}" pull

# ---------------------------------------------------------------------------
# 2. Run DB migrations (must be backward-compatible with running code)
# ---------------------------------------------------------------------------
echo "→ Running DB migrations..."
COMPOSE_FILES="$COMPOSE_FILES" ./run-migrations.sh

# ---------------------------------------------------------------------------
# 3. Recreate containers — docker compose up -d recreates only changed services
#    Old containers stop, new ones start on the same ports. Brief (~2-5s) gap
#    per service, but no full-stack downtime like `down` + `up` caused.
# ---------------------------------------------------------------------------
echo "→ Recreating containers with new images..."
docker compose "${compose_args[@]}" up -d --remove-orphans

# ---------------------------------------------------------------------------
# 4. Health-check the new stack
# ---------------------------------------------------------------------------
echo "→ Waiting for health checks..."
HEALTHY=0
for i in $(seq 1 24); do
  # API on :4444, Web on :3000
  if curl -sf --max-time 3 http://127.0.0.1:4444/health >/dev/null 2>&1 && \
     curl -sf --max-time 3 http://127.0.0.1:3000 >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  echo "  health check attempt $i/24..."
  sleep 5
done

if [ "$HEALTHY" -eq 1 ]; then
  echo "→ Health checks passed. Deploy successful."
  echo "→ Freeing disk space..."
  docker image prune -f 2>/dev/null || true
  exit 0
fi

# ---------------------------------------------------------------------------
# 5. Health checks failed — attempt rollback
# ---------------------------------------------------------------------------
echo "→ Health check FAILED after 2 minutes. Dumping logs..."
docker compose "${compose_args[@]}" ps -a
echo "--- API logs (last 80 lines) ---"
docker compose "${compose_args[@]}" logs --tail=80 api 2>/dev/null || true
echo "--- Web logs (last 80 lines) ---"
docker compose "${compose_args[@]}" logs --tail=80 web 2>/dev/null || true
if docker compose "${compose_args[@]}" ps cloudflared >/dev/null 2>&1; then
  echo "--- Tunnel logs (last 40 lines) ---"
  docker compose "${compose_args[@]}" logs --tail=40 cloudflared 2>/dev/null || true
fi

if [ -n "$PREV_API_IMAGE" ] && [ -n "$PREV_WEB_IMAGE" ]; then
  echo ""
  echo "→ ROLLING BACK to previous images..."
  # Force the previous image digests back via docker compose
  docker compose "${compose_args[@]}" down 2>/dev/null || true
  # Re-tag previous images so compose picks them up
  docker tag "$PREV_API_IMAGE" "$IMAGE_REGISTRY/yannis-eose-api:$IMAGE_TAG" 2>/dev/null || true
  docker tag "$PREV_WEB_IMAGE" "$IMAGE_REGISTRY/yannis-eose-web:$IMAGE_TAG" 2>/dev/null || true
  docker compose "${compose_args[@]}" up -d
  echo "→ Rollback started. Waiting for old containers..."
  sleep 10
  if curl -sf --max-time 3 http://127.0.0.1:4444/health >/dev/null 2>&1; then
    echo "→ Rollback health check passed. App is back online with PREVIOUS version."
  else
    echo "→ Rollback also failed. Manual intervention required."
  fi
else
  echo "→ No previous images to rollback to. Manual intervention required."
fi

exit 1
