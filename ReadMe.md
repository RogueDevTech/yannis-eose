# Yannis EOSE

START APP
cd apps/api && pnpm turbo dev
cd apps/web && pnpm turbo dev
cd apps/edge-worker && pnpm turbo dev

pnpm turbo dev

docker restart yannis-eose-api-1



<!-- cd infrastructure/terraform/gcp && terraform plan -state=prod.tfstate -var-file=terraform.tfvars.prod -out=bump-medium.tfplan && terraform apply -state=prod.tfstate "bump-medium.tfplan"   
 -->

pnpm --filter @yannis/api dev
START NEW DB

pnpm db:migrate:app
pnpm db:seed-permissions
pnpm --filter @yannis/shared db:seed


LOCAL REDIS
brew services list           # see status
brew services stop redis     # stop now (does not unregister)
brew services restart redis  # restart

brew services stop redis
brew services start redis
brew services list | grep redis   # should now show "started"



GCP TERRAFORM
terraform plan project-26c432ec-b4f1-4e21-a6a
terraform apply project-26c432ec-b4f1-4e21-a6a

```bash
pnpm install
cp apps/api/.env.example apps/api/.env    # Configure database + Redis
cp apps/web/.env.example apps/web/.env    # Configure API URL
cd packages/shared && pnpm db:migrate    # Run database migrations
cd packages/shared && pnpm db:seed       # Seed test data (optional)
cd ../.. && pnpm turbo dev               # Start all apps
```
migrate

pnpm db:migrate:app
cd packages/shared && pnpm run db:migrate
cd apps/api && npm run dev
cd apps/web && npm run dev

terraform plan -state=prod.tfstate -var-file=terraform.tfvars.prod                           
                                 

sed -i '' 's/machine_type = "e2-standard-4"/machine_type = "e2-custom-2-4096"/' terraform.tfvars.prod


#  pg_dump --no-owner --no-acl "postgresql://postgres:586686@34.35.38.230:5432/postgres?sslmode=require" > yannis_full_dump.sql  

#   /opt/homebrew/opt/postgresql@18/bin/pg_dump --no-owner --no-acl "postgresql://postgres:586686@34.35.38.230:5432/postgres?sslmode=require" > yannis_full_dump.sql

# Yannis-586686
#  DB PROD
# DATABASE_URL=postgresql://postgres:Yannis-eoseprod5866@34.51.148.220:5432/postgres?sslmode=require

# NEW PROD DB
# DATABASE_URL=postgresql://yannis_app:586686586686@34.39.26.212:5432/yannis?sslmode=require

# export OLD_URL='postgresql://postgres:Yannis-eoseprod5866@34.51.148.220:5432/postgres'
# export NEW_URL='postgresql://yannis_app:586686586686@34.39.26.212:5432/yannis'

# pg_dump --format=custom --no-owner --no-privileges "$OLD_URL" \
#   | pg_restore --no-owner --no-privileges --clean --if-exists --dbname="$NEW_URL"



# Unit tests — no DB needed, runs in ~2 seconds
  pnpm turbo test --filter=@yannis/api --filter=@yannis/shared
  pnpm turbo test --filter=@yannis/api
  pnpm turbo test --filter=@yannis/shared

  # Integration tests — needs test DB
  pnpm turbo test:integration --filter=@yannis/api

  # E2E tests — needs full app running
  pnpm --filter @yannis/web exec playwright test


**URLs:**
- Web: http://localhost:4003
- API: http://localhost:4444
- Swagger: http://localhost:4444/api/docs
- Edge Worker: http://localhost:8787

### Test Accounts (after seeding)

| Email | Role | Password |
|-------|------|----------|
| `admin@yannis.test` | SuperAdmin | `Test@12345` |
| `cs.agent@yannis.test` | CS Closer | `Test@12345` |
| `media.buyer@yannis.test` | Media Buyer | `Test@12345` |
| `finance@yannis.test` | Finance Officer | `Test@12345` |
| `hr@yannis.test` | HR Manager | `Test@12345` |
| `hom@yannis.test` | Head of Marketing | `Test@12345` |
| `rider@yannis.test` | 3PL Rider | `Test@12345` |

## Core Modules

| Module | Description | Status |
|--------|-------------|--------|
| Edge Sales & Intake | Order capture, dedup, circuit breaker, inventory cap | Done |
| CS Command & Privacy | VOIP bridge, weighted dispatch, phone masking, callbacks | Done |
| Inventory Management | FIFO batch costing, location tracking, virtual buffer, reconciliation | Done |
| 3PL Logistics | Dual-entry transfers, rider delivery, returns, offline sync | Done |
| Marketing Governance | Funding ledger, ad spend logging, CPA/ROAS metrics | Done |
| Financial Core | True profit (6 cost layers), approvals, budgets, invoicing (PDF) | Done |
| HR & Payroll | Commission engine (JSONB rules), settlement, clawback, add-ons | Done |
| Temporal Audit Trail | PostgreSQL system-versioned tables, time-travel queries | Done |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Remix (React 19) + Tailwind CSS |
| Backend | NestJS 11 + TypeScript 5.7 |
| Type Contract | tRPC 11 (internal) + Swagger (external) |
| Database | PostgreSQL 18 (temporal tables, RLS) |
| ORM | Drizzle 0.38 |
| Cache/Sessions | Redis (ioredis) |
| Real-time | Socket.io 4.8 |
| Edge | Cloudflare Workers |
| VOIP | Twilio Voice API + WebRTC |
| PWA | Service Workers + Web Push |
| File Storage | Provider-selectable object storage (GCS / S3) |
| Testing | Playwright (7 E2E specs) |
| CI/CD | GitHub Actions |

## Documentation

- [Developer Onboarding Guide](docs/DEVELOPER_GUIDE.md) — Setup, architecture, conventions
- [Multi-Cloud Deploy](docs/MULTI_CLOUD_DEPLOY.md) — Shared runtime contract, provider selector, and adapter model
- [GCP Dev Deploy](docs/GCP_DEV_DEPLOY.md) — Terraform, VM runtime, Cloudflare Tunnel, and runtime secret layout
- [Operational Runbook](docs/RUNBOOK.md) — Common operations and troubleshooting
- [Architecture Decision Records](docs/ADR.md) — 9 ADRs covering key technical choices
- [CLAUDE.md](CLAUDE.md) — Full system specification and agent directives
- [PRD.md](prd.md) — Complete product requirements document
- [TASK.md](task.md) — Development task tracker with completion status

## Project Structure

```
apps/api/          NestJS backend (21 modules, 18 tRPC routers)
apps/web/          Remix PWA frontend (65+ routes, 29 feature modules)
apps/edge-worker/  Cloudflare Worker (form submission + circuit breaker)
packages/shared/   Drizzle schema (18 files), Zod validators (14 files), types
packages/config/   ESLint, TypeScript, Tailwind configs
docs/              Developer Guide, Runbook, ADRs
```

## Key Commands

```bash
pnpm turbo dev                          # Start all apps
pnpm turbo build                        # Build all apps
pnpm turbo build --filter=@yannis/api   # Build API only
pnpm turbo build --filter=@yannis/web   # Build web only
cd packages/shared && pnpm db:migrate   # Run migrations
cd packages/shared && pnpm db:seed      # Seed test data
cd apps/web && pnpm exec playwright test # Run E2E tests
```

## The 4 Pillars

Every feature serves at least one of these pillars:

1. **Revenue Insurance** — Edge-first order capture, circuit breaker, PWA offline sync. Zero lost sales.
2. **Lead Fortress** — Phone numbers masked by default. VOIP bridges for calls. No raw PII in browser.
3. **Financial Truth** — FIFO batch costing. 6-layer True Profit formula. Real net cash profit, not estimates.
4. **Absolute Accountability** — PostgreSQL temporal tables. Immutable audit trail. Time-travel queries.

> **Note:** Secrets belong in `.env` files (gitignored) or your deployment platform's secret storage — never in the repo.

[[kv_namespaces]]

binding = "DEDUP_CACHE"
id = "dd6aa2365f7a44c5b0d3b4825bdb8749"
binding = "DEDUP_CACHE"
preview_id = "e73dc2a62c124f05b1029332b7596ac0"

binding = "RATE_LIMIT_CACHE"
id = "b68391c82d004c40a9f3dfd61fd49866"
binding = "RATE_LIMIT_CACHE"
preview_id = "47b3b79e86e0452eb202d54d883f41aa"

binding = "INVENTORY_CACHE"
id = "7ef0945b3f044e0280db399fdcc2cdb7"
binding = "INVENTORY_CACHE"
preview_id = "4a79f1f5fe2541369c5d6c95a581f591"

binding = "CAMPAIGN_CACHE"
id = "7a4c4ff13803430fa1173674e88ff5b0"
preview_id = "36f748275dec4c669b6fe26dca9cf8db"


EDGE_API_KEY = "fa281444318a48163471c0469b8f23fa1a4ab5e2923bc492ea469ff50449c116"


site key=0x4AAAAAACwS5uc-71js3fAy
secret key=0x4AAAAAACwS5ss9tTk4mAVWT0jI_Nm-1Hw

QSTASH_URL = ""
QSTASH_TOKEN = ""
EDGE_API_KEY = "fa281444318a48163471c0469b8f23fa1a4ab5e2923bc492ea469ff50449c116"
TURNSTILE_SECRET_KEY = "0x4AAAAAACwS5ss9tTk4mAVWT0jI_Nm-1Hw"

[
  {
    "id": "7a4c4ff13803430fa1173674e88ff5b0",
    "title": "CAMPAIGN_CACHE",
    "supports_url_encoding": true
  },
  {
    "id": "36f748275dec4c669b6fe26dca9cf8db",
    "title": "CAMPAIGN_CACHE_preview",
    "supports_url_encoding": true
  },
  {
    "id": "d727ced193824b3db128d422163239eb",
    "title": "yannis-edge-worker-CAMPAIGN_CACHE",
    "supports_url_encoding": true
  },
  {
    "id": "fddd3a355ff8438db230a5932bd1f31b",
    "title": "yannis-edge-worker-CAMPAIGN_CACHE_preview",
    "supports_url_encoding": true
  },
  {
    "id": "dd6aa2365f7a44c5b0d3b4825bdb8749",
    "title": "yannis-edge-worker-DEDUP_CACHE",
    "supports_url_encoding": true
  },
  {
    "id": "e73dc2a62c124f05b1029332b7596ac0",
    "title": "yannis-edge-worker-DEDUP_CACHE_preview",
    "supports_url_encoding": true
  },
  {
    "id": "7ef0945b3f044e0280db399fdcc2cdb7",
    "title": "yannis-edge-worker-INVENTORY_CACHE",
    "supports_url_encoding": true
  },
  {
    "id": "4a79f1f5fe2541369c5d6c95a581f591",
    "title": "yannis-edge-worker-INVENTORY_CACHE_preview",
    "supports_url_encoding": true
  },
  {
    "id": "b68391c82d004c40a9f3dfd61fd49866",
    "title": "yannis-edge-worker-RATE_LIMIT_CACHE",
    "supports_url_encoding": true
  },
  {
    "id": "47b3b79e86e0452eb202d54d883f41aa",
    "title": "yannis-edge-worker-RATE_LIMIT_CACHE_preview",
    "supports_url_encoding": true
  }
]



[
  {
    "name": "QSTASH_URL",
    "type": "secret_text"
  }
]



# Fetch the password (it prints to your terminal)
PASS=$(gcloud secrets versions access latest \
  --secret=prod-yannis-eose-pg-app-password \
  --project=project-26c432ec-b4f1-4e21-a6a)

# Build the URL — replace <PUBLIC_IP> with the value from
# `terraform output cloud_sql_public_ip`
NEW_URL="postgres://yannis_app:${PASS}@<PUBLIC_IP>:5432/yannis?sslmode=require"

# Echo it so you can copy if needed (don't paste into chat — has the password)
echo "$NEW_URL"

