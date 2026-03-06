# ==============================================================================
# Yannis EOSE — Web Dockerfile (Remix)
# Multi-stage build: install → build → runtime
# ==============================================================================

# ── Stage 1: Install dependencies ────────────────────────────────────────────
FROM node:20-alpine AS base

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./

# Copy package.json files for dependency resolution
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN pnpm install --frozen-lockfile

# ── Stage 2: Build ───────────────────────────────────────────────────────────
FROM base AS build

# Copy all source code
COPY packages/ packages/
COPY apps/web/ apps/web/

# Build the Web app (and its dependencies via turbo)
RUN pnpm turbo build --filter=@yannis/web

# ── Stage 3: Production runtime ──────────────────────────────────────────────
# Preserve monorepo layout so pnpm symlinks (root .pnpm, apps/web node_modules) resolve.
FROM node:20-alpine AS runtime

WORKDIR /app

# Root node_modules (has .pnpm store); web node_modules (has .bin/remix-serve and symlinks)
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/packages/ui ./packages/ui
COPY --from=build /app/apps/web/build ./apps/web/build
COPY --from=build /app/apps/web/package.json ./apps/web/package.json

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=5 \
  CMD wget -qO- http://localhost:3000 || exit 1

# Run from web app dir so npx finds remix-serve and pnpm symlinks resolve
WORKDIR /app/apps/web
CMD ["npx", "remix-serve", "./build/server/index.js"]
