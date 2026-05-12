# Yannis EOSE — Developer Onboarding Guide

## Prerequisites

- **Node.js** 20+ (LTS recommended)
- **pnpm** 9+ (`npm install -g pnpm`)
- **PostgreSQL 18** connection string (Aiven, Neon, or any managed Postgres)
- **Redis** connection string (Upstash, Redis Cloud, or any managed Redis)
- **Google Cloud credentials** with access to the configured GCS bucket if you want direct uploads / image rehosting to work locally
- **Git** 2.30+

## Quick Start (< 10 minutes)

### 1. Clone & Install

```bash
git clone <repo-url> yannis-eose
cd yannis-eose
pnpm install
```

### 2. Configure Environment Variables

Copy the example env files and fill in your credentials:

```bash
# API
cp apps/api/.env.example apps/api/.env

# Web
cp apps/web/.env.example apps/web/.env

# Edge Worker (optional for local dev)
cp apps/edge-worker/.env.example apps/edge-worker/.env
```

**Required env vars for `apps/api/.env`:**

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | Postgres connection string | `postgres://user:pass@host:5432/yannis` |
| `REDIS_URL` | Redis connection string | `redis://127.0.0.1:6379` (local) |
| `PORT` | API port | `4444` |
| `CORS_ORIGIN` | Frontend URL | `http://localhost:4003` |
| `SESSION_TTL_SECONDS` | Session lifetime | `86400` |
| `SESSION_COOKIE_DOMAIN` | Parent cookie domain for split web/API hosts | `.roguedevtech.com` |
| `OBJECT_STORAGE_PROVIDER` | Object storage adapter to use | `gcs` |
| `OBJECT_STORAGE_BUCKET` | Bucket used for uploads + product image rehosting | `dev-yannis-eose-assets` |
| `OBJECT_STORAGE_PUBLIC_BASE_URL` | Public base URL for durable file URLs | `https://storage.googleapis.com/dev-yannis-eose-assets` |
| `ASSET_ENV_PREFIX` | Environment-specific object prefix | `dev` |
| `GCP_PROJECT_ID` | Required when using the `gcs` adapter | `my-gcp-project` |
| `AWS_REGION` | Required when using the `s3` adapter without a custom endpoint | `eu-north-1` |
| `S3_ENDPOINT` | Optional S3-compatible endpoint override | `https://s3.eu-north-1.amazonaws.com` |
| `S3_ACCESS_KEY_ID` | Optional static S3 credentials for local dev | `AKIA...` |
| `S3_SECRET_ACCESS_KEY` | Optional static S3 credentials for local dev | `secret` |

**Required env vars for `apps/web/.env`:**

| Variable | Description | Example |
|----------|-------------|---------|
| `API_URL` | Backend API URL | `http://localhost:4444` |
| `VITE_API_URL` | Client-side API URL | `http://localhost:4444` |
| `OBJECT_STORAGE_PROVIDER` | Object storage adapter to use | `gcs` |
| `OBJECT_STORAGE_BUCKET` | Bucket used by `/api/upload-url` | `dev-yannis-eose-assets` |
| `OBJECT_STORAGE_PUBLIC_BASE_URL` | Public base URL for uploaded assets | `https://storage.googleapis.com/dev-yannis-eose-assets` |
| `ASSET_ENV_PREFIX` | Environment-specific object prefix | `dev` |
| `GCP_PROJECT_ID` | Required when using the `gcs` adapter | `my-gcp-project` |
| `AWS_REGION` | Required when using the `s3` adapter without a custom endpoint | `eu-north-1` |
| `S3_ENDPOINT` | Optional S3-compatible endpoint override | `https://s3.eu-north-1.amazonaws.com` |
| `S3_ACCESS_KEY_ID` | Optional static S3 credentials for local dev | `AKIA...` |
| `S3_SECRET_ACCESS_KEY` | Optional static S3 credentials for local dev | `secret` |

### Redis Environment Split (Local vs Deployed Dev)

- Local laptop runtime uses `apps/api/.env`:
  - `REDIS_URL=redis://127.0.0.1:6379` (or your SSH tunnel endpoint)
- Deployed dev uses the same external `REDIS_URL` pattern — Redis is **not** VM-local on either provider adapter.
- The shared runtime compose files are `infrastructure/deploy/docker-compose.runtime.yml` and `infrastructure/deploy/docker-compose.runtime.tunnel.yml`.
- `DEPLOY_PLATFORM=aws|gcp` selects the provider wrapper in CI and on the VM.
- VM runtime `.env` is refreshed via `infrastructure/deploy/refresh-env.sh`, which dispatches to the selected provider adapter.

### 3. Run Database Migrations

```bash
cd packages/shared
pnpm db:migrate
```

This creates all 20+ tables, history tables, temporal triggers, and RLS policies.

### 4. Seed Test Data (optional)

```bash
cd packages/shared
pnpm db:seed
```

Creates test users for all roles:

| Email | Role | Password |
|-------|------|----------|
| `admin@yannis.test` | SUPER_ADMIN | `Test@12345` |
| `cs.agent@yannis.test` | CS_CLOSER | `Test@12345` |
| `media.buyer@yannis.test` | MEDIA_BUYER | `Test@12345` |
| `finance@yannis.test` | FINANCE_OFFICER | `Test@12345` |
| `hr@yannis.test` | HR_MANAGER | `Test@12345` |
| `hom@yannis.test` | HEAD_OF_MARKETING | `Test@12345` |
| `rider@yannis.test` | TPL_RIDER | `Test@12345` |

### 5. Start Development

```bash
# From project root — starts all apps
pnpm turbo dev

# Or start individually:
pnpm turbo dev --filter=@yannis/api     # API on port 4444
pnpm turbo dev --filter=@yannis/web     # Web on port 4003
```

### 6. Verify

- **Web app**: http://localhost:4003
- **API**: http://localhost:4444
- **Swagger docs**: http://localhost:4444/api/docs
- **tRPC**: http://localhost:4444/trpc/health.ping

---

## Project Structure

```
yannis-eose/
├── apps/
│   ├── api/                    # NestJS backend (21 modules, 18 tRPC routers)
│   │   ├── src/
│   │   │   ├── auth/           # Authentication + session management
│   │   │   ├── audit/          # Audit trail service
│   │   │   ├── cart/           # Shopping cart service
│   │   │   ├── common/         # Guards, decorators, interceptors
│   │   │   ├── database/       # Drizzle + Postgres + Redis providers
│   │   │   ├── events/         # Socket.io gateway + service
│   │   │   ├── finance/        # Finance service + materialized views
│   │   │   ├── hr/             # HR + payroll + commission engine
│   │   │   ├── inventory/      # Inventory FIFO + stock management
│   │   │   ├── logistics/      # 3PL + transfers + escalation
│   │   │   ├── marketing/      # Campaigns + funding + metrics
│   │   │   ├── notifications/  # Notification service
│   │   │   ├── orders/         # Order service + state machine
│   │   │   ├── payments/       # Payment processing (Paystack)
│   │   │   ├── permission-requests/ # Approval workflow
│   │   │   ├── permissions/    # RBAC + permission management
│   │   │   ├── products/       # Product + category CRUD
│   │   │   ├── settings/       # System settings (feature flags, Redis-cached)
│   │   │   ├── trpc/           # tRPC routers + middleware + OpenAPI docs
│   │   │   ├── users/          # User management
│   │   │   └── voip/           # VOIP integration (Twilio 3-tier)
│   │   └── webpack.config.js   # Custom webpack for workspace bundling
│   │
│   ├── web/                    # Remix PWA frontend (65+ routes)
│   │   ├── app/
│   │   │   ├── components/     # Layout + UI components (32+)
│   │   │   ├── features/       # Feature page components (29 modules)
│   │   │   ├── hooks/          # React hooks (socket, VOIP, PWA, mobile, online)
│   │   │   ├── lib/            # API client, object storage upload, CSV export, PDF, offline sync
│   │   │   └── routes/         # Remix file-based routing (admin, auth, hr, rider, tpl, payment)
│   │   ├── e2e/                # Playwright E2E tests (7 specs)
│   │   └── public/             # SW, manifest, static assets
│   │
│   └── edge-worker/            # Cloudflare Worker (form submission + circuit breaker)
│
├── packages/
│   ├── shared/                 # Drizzle schema, Zod validators, types
│   │   ├── src/db/schema/      # 18 schema files (orders, products, finance, hr, etc.)
│   │   ├── src/validators/     # 14 Zod validator files
│   │   ├── src/enums/          # TypeScript enums
│   │   └── drizzle/            # 40+ SQL migrations
│   ├── ui/                     # Shared Tailwind components
│   └── config/                 # ESLint, TypeScript, Tailwind configs
│
├── docs/                       # Developer Guide, Runbook, ADRs
├── .github/workflows/          # CI/CD pipeline (ci.yml, deploy-dev.yml)
├── turbo.json                  # TurboRepo configuration
├── CLAUDE.md                   # AI agent instructions
├── prd.md                      # Product Requirements Document
└── task.md                     # Development task tracker
```

---

## Architecture Overview

### Backend (NestJS)

**Module pattern**: Each domain has its own NestJS module (e.g., `OrdersModule`, `FinanceModule`) with:
- **Service** — business logic, database operations
- **Module** — DI configuration, imports

**tRPC pattern**: NestJS services are injected into tRPC routers via a factory pattern:
```typescript
// In router file
let serviceInstance: OrdersService | null = null;
export function setOrdersService(s: OrdersService) { serviceInstance = s; }

// In TrpcModule.onModuleInit()
setOrdersService(this.ordersService);
```

**Auth flow**: Cookie-based sessions stored in Redis. Every request goes through:
1. `AuthGuard` — reads `yannis_session` cookie, looks up session in Redis
2. `RolesGuard` — checks `@Roles()` decorator against user role
3. `AuditInterceptor` — sets `yannis.current_user_id` in Postgres for audit trail

### Frontend (Remix)

**Routing**: Flat file routing with `.` separators (Remix v2 convention):
- `admin._index.tsx` → `/admin` (role-specific dashboard)
- `admin.cs.orders._index.tsx` → `/admin/cs/orders` (CS Orders list)
- `admin.marketing.orders._index.tsx` → `/admin/marketing/orders` (Marketing Orders list)
- `admin.orders._index.tsx` → redirects to `/admin/cs/orders`
- `admin.orders.$id.tsx` → `/admin/orders/:id` (shared order detail)
- `rider._index.tsx` → `/rider` (3PL rider mobile dashboard)
- `tpl._index.tsx` → `/tpl` (3PL partner dashboard)
- `hr.payroll.tsx` → `/hr/payroll` (HR payroll management)

**Feature extraction**: Large page components are in `app/features/{module}/`:
- `FinancePage.tsx`, `OrdersListPage.tsx`, `CEODashboardPage.tsx`, etc.
- Route files contain only the loader, action, and component wrapper

**Data flow**:
- `loader()` → server-side data fetching via `apiRequest()` (tRPC calls)
- `action()` → server-side mutations via `apiRequest()` (POST to tRPC)
- `useFetcher()` → client-side mutations without page navigation

### Database

- **PostgreSQL 18** with temporal tables (system-versioned audit trail)
- **Drizzle ORM** for type-safe queries
- Every write sets `yannis.current_user_id` for audit trail
- Row-Level Security (RLS) on 9 business tables
- FIFO batch costing for inventory

---

## Common Development Tasks

### Adding a New tRPC Procedure

1. Add Zod schema in `packages/shared/src/validators/{module}.ts`
2. Add service method in `apps/api/src/{module}/{module}.service.ts`
3. Add procedure in `apps/api/src/trpc/routers/{module}.router.ts`
4. Use `permissionProcedure('domain.resource.action')` for RBAC (permission-first)
5. Call from frontend via `apiRequest()` in route loader/action

### Adding a New Route (Frontend)

1. Create `apps/web/app/routes/admin.{name}/route.tsx` (directory-based)
   OR `apps/web/app/routes/admin.{name}.tsx` (flat file)
2. Add loader with `requireRole(request, ['ALLOWED_ROLES'])`
3. Add action for mutations
4. Create feature component in `app/features/{module}/`
5. Add nav item in `dashboard-layout.tsx` `allNavItems` array
6. Add icon in `sidebar.tsx` `SidebarIcons`

### Running Tests

```bash
# E2E tests (requires running dev server)
cd apps/web
pnpm exec playwright test

# With UI
pnpm exec playwright test --ui

# Specific test file
pnpm exec playwright test e2e/01-order-lifecycle.spec.ts
```

### RBAC Catalog and Matrix Workflow

- Permission codes are namespaced and dot-scoped (example: `users.staff.create`, `cs.team.overview.view`).
- **Staff create (`/hr/users/new`) — template baseline vs overrides**
  - Choosing a **Role** sets the default **SYSTEM** role template on the user (mapped by `mappedRole`); the matrix shows those codes as **inherited** (effective “on”) without writing every code to `user_permissions`.
  - `users.create` persists `roleTemplateId` on the new user. `applyPermissionOverrides` runs only when the form posts a non-empty `permissionOverrides` JSON object (`true` = explicit grant, `false` = explicit revoke).
  - Effective runtime permissions remain: `role template ∪ legacy role_permissions ∪ user grants − revokes` (see `PermissionsService.getEffectivePermissions`).
  - Changing **Permission template** in the dropdown updates the inherited baseline in the matrix before submit; use that when onboarding someone from a custom template instead of the role default.
- User **edit** uses the same matrix with stored overrides from `getUserMatrix`.
- After changing permission catalog or role mappings, always run:

```bash
pnpm --filter @yannis/shared db:seed-permissions
pnpm --filter @yannis/shared db:audit-permission-coverage
```

#### Manual QA checklist (create user permissions)

Run against a seeded dev/staging DB (`db:seed-permissions` applied).

1. Open `/hr/users/new`, pick a role (e.g. CS Closer) — matrix appears and **Inherited:** is greater than zero when the template has grants.
2. Submit without toggling any permission — new user can perform actions allowed by the template; `user_permissions` has no extra rows unless you had overrides.
3. Toggle one permission off (explicit revoke) or on (explicit grant), submit — only divergences persist in `user_permissions`; inherited rest still come from the template.
4. If multiple templates exist, change **Permission template** — inherited counts/labels update; saved user should carry the selected `roleTemplateId`.
5. Environment missing role templates — `users.create` should return a clear error mentioning migrations + `db:seed-permissions` (precondition failed path).

### Building for Production

```bash
# Build everything
pnpm turbo build

# Build specific app
pnpm turbo build --filter=@yannis/api
pnpm turbo build --filter=@yannis/web

# Deploy edge worker
cd apps/edge-worker
pnpm wrangler deploy
```

---

## Key Conventions

1. **No `any` type** — use `unknown` + Zod validation
2. **UUIDv7** for all primary keys (timestamp-ordered)
3. **Actor injection** — every write operation must set `yannis.current_user_id`
4. **Phone masking** — customer phone numbers never appear in API responses
5. **Nigerian Naira (₦)** — all currency formatting uses `&#8358;`
6. **Dark mode** — all components must support `dark:` Tailwind classes
7. **Inter font** — base 14px, compact scale
8. **State machine** — orders must follow the strict lifecycle (no state skipping)
9. **Loaders return plain objects** — no `json()` wrapper (v3_singleFetch streaming)
10. **Actions still use `json()`** — only loader returns are unwrapped
11. **Feature extraction** — large page components go in `app/features/{module}/`
12. **Numeric columns** — use `sql\`${value}::numeric\`` for Drizzle inserts, not `String()` or `.toFixed(2)`

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `@yannis/shared` import errors | Run `pnpm install` from root; shared package uses CJS, no `"type": "module"` |
| Webpack build fails | Check `apps/api/webpack.config.js` — `allowlist: [/^@yannis\//]` must include workspace packages |
| Redis connection refused | Verify `REDIS_URL` in `.env`; use `rediss://` for TLS |
| RLS blocks queries | Ensure `AuditInterceptor` sets both `yannis.current_user_id` and `yannis.current_user_role` |
| Temporal trigger errors | Run `pnpm db:migrate` to create trigger functions |
| Socket.io connection fails | Check `CORS_ORIGIN` matches frontend URL; cookies need `credentials: true` |
