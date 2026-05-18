# ==============================================================================
# Yannis EOSE — API Dockerfile (NestJS)
# Multi-stage build: install → build → runtime
# ==============================================================================

# ── Stage 1: Install dependencies ──────────────────────
FROM node:20-alpine AS base

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./

# Copy package.json files for dependency resolution
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/config/package.json packages/config/package.json

RUN pnpm install --frozen-lockfile

# ── Stage 2: Build ───────────────────────────────────────────────────────────
FROM base AS build

# Copy all source code
COPY packages/ packages/
COPY apps/api/ apps/api/

# Build the API (and its dependencies via turbo)
RUN pnpm turbo build --filter=@yannis/api

# ── Stage 3: Production runtime ──────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

# Copy built output and production dependencies
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/api/package.json ./package.json

ENV NODE_ENV=production
ENV NODE_PATH=/app/node_modules:/app/apps/api/node_modules
EXPOSE 4444

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4444/health || exit 1

CMD ["node", "dist/main.js"]
