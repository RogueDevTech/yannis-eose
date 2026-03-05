# Yannis EOSE

**Enterprise Operations & Sales Engine** — A high-integrity ERP and sales platform for performance marketing companies.

## Quick Start

Use pnpm 9.15.4 (e.g. `corepack enable && corepack prepare pnpm@9.15.4 --activate` or install via npm).

```bash
pnpm install
cp apps/api/.env.example apps/api/.env    # Configure database + Redis
cp apps/web/.env.example apps/web/.env    # Configure API URL
cd packages/shared && pnpm db:migrate    # Run database migrations
cd ../.. && pnpm turbo dev               # Start all apps
```

**URLs:**
- Web: http://localhost:4000
- API: http://localhost:4444
- Swagger: http://localhost:4444/api/docs
- Edge Worker: http://localhost:8787

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Remix (React) + Tailwind CSS |
| Backend | NestJS + TypeScript |
| Type Contract | tRPC (internal) + Swagger (external) |
| Database | PostgreSQL 18 (temporal tables, RLS) |
| ORM | Drizzle |
| Cache/Sessions | Redis |
| Real-time | Socket.io |
| Edge | Cloudflare Workers |
| PWA | Service Workers + Web Push |

## Documentation

- [Developer Onboarding Guide](docs/DEVELOPER_GUIDE.md)
- [Operational Runbook](docs/RUNBOOK.md)
- [Architecture Decision Records](docs/ADR.md)
- [CLAUDE.md](CLAUDE.md) — Full system specification

## Project Structure

```
apps/api/          NestJS backend (tRPC routers, services, auth)
apps/web/          Remix PWA frontend (all dashboards + rider views)
apps/edge-worker/  Cloudflare Worker (form submission + circuit breaker)
packages/shared/   Drizzle schema, Zod validators, shared types
```

## Key Commands

```bash
pnpm turbo dev                          # Start all apps
pnpm turbo build                        # Build all apps
pnpm turbo build --filter=@yannis/api   # Build API only
pnpm turbo build --filter=@yannis/web   # Build web only
cd packages/shared && pnpm db:migrate   # Run migrations
cd apps/web && pnpm exec playwright test # Run E2E tests
```

> **Note:** AWS/EC2 and other deployment secrets belong in environment variables or a secrets manager, not in this repo. Use `.env` (gitignored) or your deployment platform's secret storage.
