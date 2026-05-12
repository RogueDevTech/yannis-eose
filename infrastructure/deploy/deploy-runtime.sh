#!/usr/bin/env bash
# ==============================================================================
# Yannis EOSE — Shared runtime deploy for provider adapters
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

if ! grep -q '^DATABASE_URL=' .env 2>/dev/null; then
  echo "DATABASE_URL missing from .env"
  exit 1
fi
if ! grep -q '^REDIS_URL=' .env 2>/dev/null; then
  echo "REDIS_URL missing from .env"
  exit 1
fi
echo "→ Freeing disk space..."
df -h /
docker system prune -af 2>/dev/null || true

echo "→ Stopping previous stack..."
IMAGE_REGISTRY="$IMAGE_REGISTRY" IMAGE_TAG="$IMAGE_TAG" docker compose "${compose_args[@]}" down 2>/dev/null || true

echo "→ Pulling images..."
IMAGE_REGISTRY="$IMAGE_REGISTRY" IMAGE_TAG="$IMAGE_TAG" docker compose "${compose_args[@]}" pull

echo "→ Running DB migrations..."
COMPOSE_FILES="$COMPOSE_FILES" IMAGE_REGISTRY="$IMAGE_REGISTRY" IMAGE_TAG="$IMAGE_TAG" ./run-migrations.sh

echo "→ Starting containers..."
IMAGE_REGISTRY="$IMAGE_REGISTRY" IMAGE_TAG="$IMAGE_TAG" docker compose "${compose_args[@]}" up -d

echo "→ Waiting for health checks..."
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18; do
  if curl -sf http://127.0.0.1:4444/health >/dev/null && curl -sf http://127.0.0.1:3000 >/dev/null; then
    echo "→ Health checks passed."
    docker image prune -f
    exit 0
  fi
  if [ "$i" -eq 18 ]; then
    echo "→ Health check timeout. Container status:"
    IMAGE_REGISTRY="$IMAGE_REGISTRY" IMAGE_TAG="$IMAGE_TAG" docker compose "${compose_args[@]}" ps -a
    echo "→ API logs (last 60 lines):"
    IMAGE_REGISTRY="$IMAGE_REGISTRY" IMAGE_TAG="$IMAGE_TAG" docker compose "${compose_args[@]}" logs --tail=60 api
    echo "→ Web logs (last 60 lines):"
    IMAGE_REGISTRY="$IMAGE_REGISTRY" IMAGE_TAG="$IMAGE_TAG" docker compose "${compose_args[@]}" logs --tail=60 web
    if IMAGE_REGISTRY="$IMAGE_REGISTRY" IMAGE_TAG="$IMAGE_TAG" docker compose "${compose_args[@]}" ps cloudflared >/dev/null 2>&1; then
      echo "→ Tunnel logs (last 60 lines):"
      IMAGE_REGISTRY="$IMAGE_REGISTRY" IMAGE_TAG="$IMAGE_TAG" docker compose "${compose_args[@]}" logs --tail=60 cloudflared || true
    fi
    exit 1
  fi
  sleep 5
done
