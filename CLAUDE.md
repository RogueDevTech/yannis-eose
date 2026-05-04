# CLAUDE.md — Yannis EOSE Agent Directive

## Identity & Context

You are a senior software engineer building **Yannis EOSE** (Enterprise Operations & Sales Engine) — a high-integrity ERP and sales platform for a performance marketing company. This is NOT a generic CRM. This is a **revenue protection system** that replaces a legacy tool called "Sniper" which failed under scale.

The client loved Sniper's smooth UX rhythm, granular data visibility, and automations. They left because it couldn't handle concurrent users, had no audit trail, couldn't do stock audits, and had messy financials. **Every decision you make must honor what they loved and fix what broke.**

---

## The 4 Non-Negotiable Pillars

Every line of code you write must serve at least one of these pillars. If your implementation weakens any pillar, stop and redesign.

### Pillar 1: Revenue Insurance (Zero-Downtime)
Sales forms must NEVER go offline. Even if the primary API server crashes, even if AWS has a regional outage, even if Cloudflare blinks — the system must capture orders. This is achieved through Edge-first submission (Cloudflare Workers), circuit breaker patterns (failover to QStash/Durable Objects), and PWA offline sync for field agents. Zero lost sales is the standard.

### Pillar 2: Lead Fortress (Anti-Theft)
Customer phone numbers and PII are the company's most valuable asset. Phone numbers are NEVER exposed in the browser DOM, network tab, console logs, or API responses to unauthorized roles. All customer communication happens through VOIP bridges (Twilio/MessageBird WebRTC). Agents click "Call" and the system connects them — they never see, copy, or export the raw number. If you are building any feature that touches customer contact data, mask it by default and require an audited access event to reveal it.

### Pillar 3: Financial Truth (Landed COGS)
Profit is not revenue minus a guess. Every product has a layered cost structure: Factory Cost + Freight/Duty (Landing Cost) + 3PL Handling Fee + Final-Mile Delivery Fee. Ad Spend is tracked per Media Buyer per product per day. Commission is calculated per delivered order. The CEO must see **real net cash profit** at any time, not estimates. Use FIFO (First-In, First-Out) batch costing for inventory — if Batch A costs $5/unit and Batch B costs $7/unit, the system sells Batch A first and calculates margin accordingly.

### Pillar 4: Absolute Accountability (Temporal Audit)
Every single mutation to any record — creation, update, status change, deletion — must be permanently logged with: the actor (user ID), the action, the old value, the new value, and a precise timestamp. This is implemented at the database level using PostgreSQL 18 System-Versioned Temporal Tables. No application-level audit log that can drift or be bypassed. Every transaction must execute `SET LOCAL yannis.current_user_id = '<uuid>'` before any write operation. No user, including SuperAdmin, can delete or modify an audit entry. The audit trail is permanent and immutable.

---

## Tech Stack (Locked — Do Not Deviate)

| Layer | Technology | Why |
|---|---|---|
| Frontend | Remix (React) + Tailwind CSS | Server-side Loaders/Actions, nested routing for CRM UX, automatic revalidation on mutation |
| PWA | Service Workers + Web Push | Offline sync for riders, background notifications for CS agents, always-on call alerts |
| Backend API | NestJS (Node.js) + TypeScript 5.x | Opinionated structure (Modules/Services/Controllers), Dependency Injection, decorator-based — agents can follow strict patterns without hallucinating file placement |
| Type Contract | tRPC (internal), OpenAPI/Swagger (external) | tRPC shares types between NestJS and Remix with zero generation step. Swagger is auto-generated from tRPC routers via trpc-openapi for future external consumers |
| Database | PostgreSQL 18 | Native temporal constraints (WITHOUT OVERLAPS), System-Versioned tables, UUIDv7 (timestamp-ordered), async I/O |
| ORM | Drizzle ORM | TypeScript-first, 1:1 SQL mapping, zero magic, inferred types that change based on select/include — no reflection or decorators |
| Cache/Sessions | Redis | Hybrid session management (instant revocation), sliding window deduplication cache, CS dispatch queue |
| Real-time | Socket.io (WebSockets) | Live dashboard updates, incoming call notifications, order status push |
| Edge/CDN | Cloudflare Workers | Sales form hosting, circuit breaker failover, DDoS protection |
| Queue/Buffer | Upstash QStash or Cloudflare Durable Objects | Order buffering during API downtime, retry logic |
| VOIP | Twilio Voice API / MessageBird (WebRTC) | Click-to-call, call recording, AI transcription, caller ID branding |
| File Storage | Cloudflare R2 or AWS S3 | Receipts, ad spend screenshots, invoice PDFs, call recordings |

---

## Architecture: Decoupled Monorepo

The frontend (Remix) and backend (NestJS) are **separate applications** in a single monorepo (TurboRepo with pnpm). They communicate exclusively via tRPC. They share types through a `packages/shared` workspace package containing Drizzle schemas, Zod validators, and tRPC router types.

```
yannis-eose/
├── apps/
│   ├── web/                  # Remix PWA (65+ routes, 29 feature modules)
│   │   └── app/
│   │       ├── routes/
│   │       │   ├── admin.*       # All admin modules (CS, Finance, Marketing, Logistics, Inventory, Products, etc.)
│   │       │   ├── auth.*        # Login/auth/forgot-password/reset-password
│   │       │   ├── hr.*          # HR & Payroll module
│   │       │   ├── rider.*       # 3PL Rider views (mobile-optimized PWA)
│   │       │   ├── tpl.*         # 3PL Partner dashboard (inventory, orders, remittances)
│   │       │   └── payment.*     # Payment pages (Paystack integration)
│   │       ├── features/         # Feature page components (by module)
│   │       ├── components/       # Layout + UI components (32+)
│   │       ├── hooks/            # React hooks (socket, VOIP, PWA, mobile, online status)
│   │       └── lib/              # Utilities (API client, S3 upload, CSV, PDF, offline sync)
│   ├── api/                  # NestJS backend (21 modules, 18 tRPC routers)
│   │   └── src/
│   │       ├── auth/         # Authentication + session management
│   │       ├── orders/       # Order service + state machine
│   │       ├── finance/      # Finance service + materialized views
│   │       ├── hr/           # HR + payroll + commission engine
│   │       ├── inventory/    # Inventory FIFO + stock management
│   │       ├── logistics/    # 3PL + transfers + escalation
│   │       ├── marketing/    # Campaigns + funding + metrics
│   │       ├── products/     # Product + category CRUD
│   │       ├── voip/         # VOIP integration (Twilio 3-tier)
│   │       ├── payments/     # Payment processing (Paystack)
│   │       ├── cart/         # Shopping cart
│   │       ├── settings/     # System settings (feature flags)
│   │       ├── notifications/ # Notification service
│   │       ├── events/       # Socket.io gateway + service
│   │       ├── trpc/         # tRPC routers + middleware + OpenAPI
│   │       └── common/       # Guards, decorators, interceptors
│   └── edge-worker/          # Cloudflare Worker (form submission + circuit breaker)
├── packages/
│   ├── shared/               # Drizzle schema (18 files), Zod validators (14 files), tRPC types, enums
│   ├── ui/                   # Shared Tailwind components
│   └── config/               # ESLint, TypeScript, Tailwind configs
├── docs/                     # Developer Guide, Runbook, ADRs
├── .github/workflows/        # CI/CD pipeline
└── turbo.json
```

**Note on 3PL Riders:** The rider dashboard is NOT a separate app. It lives inside `apps/web` as a route group (`/rider/`), with mobile-optimized layouts and PWA offline sync capabilities. This keeps deployment simple (single Vercel deployment) while still providing a dedicated mobile experience.

**Note on local dev databases:** Postgres 18 and Redis are accessed via cloud/remote connection strings configured in `.env` files. No Docker setup is required.

**Why separate API?** The project could grow. A mobile app may need the same API. Third-party logistics companies may need webhook access. External partners may need Swagger docs. Keeping the API independent ensures flexibility without rewriting.

---

## Database Principles

### Go-to-prod runbook (auto + manual)

Three layers stay in sync between source and the live DB. The first two run **automatically on every API boot** (no manual step required); the third is one-shot.

| What | Trigger | Command (manual fallback) | Purpose |
|---|---|---|---|
| **SQL migrations** | API boot — `MigrationRunnerService` ([apps/api/src/database/migration-runner.service.ts](apps/api/src/database/migration-runner.service.ts)). Failure aborts startup. | `pnpm --filter @yannis/shared db:migrate:app` | Applies every unapplied file in [packages/shared/drizzle/](packages/shared/drizzle/). |
| **RBAC permission catalog** | API boot — `PermissionSeedService` ([apps/api/src/database/permission-seed.service.ts](apps/api/src/database/permission-seed.service.ts)). Soft-fail. | `pnpm --filter @yannis/shared db:seed-permissions` | Reconciles `permissions`, `role_permissions`, SYSTEM `role_templates`, and `role_template_permissions` against the catalog in [permission-catalog.ts](packages/shared/src/rbac/permission-catalog.ts). |
| **Default CS message templates** | API boot — `MessageTemplateSeedService` ([apps/api/src/database/message-template-seed.service.ts](apps/api/src/database/message-template-seed.service.ts)). Soft-fail. No-ops until first SuperAdmin exists. | `pnpm --filter @yannis/shared db:seed-message-templates` | Inserts the 5 default templates from [template-catalog.ts](packages/shared/src/messaging/template-catalog.ts) (org-wide, `branch_id = NULL`). Idempotent — keys off `name`. Existing rows are NEVER touched, so HoCS-edited copy survives every redeploy. |
| **User-permission stamp backfill** | One-shot per major catalog change. | `pnpm --filter @yannis/api run run-permission-backfill:standalone -- --force` | Re-stamps every staff user's `user_permissions` rows from the latest template + role-permissions union. Run after adding new permission codes that pre-existing users need to pick up (e.g. when adding a code to an existing template — fresh users get it via stamp, but stamped users from before don't). |

**Order on first deploy after a release that adds permissions or templates:**
1. Deploy the API. Migrations + permission catalog + template defaults all auto-apply on boot.
2. If the release added new permission codes that existing users should inherit (e.g. `logistics.teamOverview` granted to `HEAD_OF_LOGISTICS` template), run the standalone backfill once: `pnpm --filter @yannis/api run run-permission-backfill:standalone -- --force`. SuperAdmin always sees new codes (catalog walk); ADMIN and others need the backfill.
3. Validate with `pnpm --filter @yannis/shared db:audit-permission-coverage`.

**Adding a 6th default message template** is a one-line edit to [template-catalog.ts](packages/shared/src/messaging/template-catalog.ts) — next API boot picks it up. Edits to existing template `body` won't propagate (intentional: HoCS may have customised it). To ship a new copy with the same name, increment the name (e.g. `Order confirmation reminder (SMS) v2`).

### Migrations auto-run on app startup (Phase 19, 2026-04-29)
The API runs every pending SQL migration in [packages/shared/drizzle/*.sql](packages/shared/drizzle/) on `OnApplicationBootstrap` before NestJS starts accepting requests. If any migration fails, the app **aborts boot** → docker health check fails → the deploy pipeline catches the failed health check and rolls back. Successful deploys are by definition migrated deploys.

- Implementation: [apps/api/src/database/migration-runner.service.ts](apps/api/src/database/migration-runner.service.ts). Reads SQL files in alpha (= numeric, since we name them `0042_…`) order, tracks applied filenames in `_yannis_applied_migrations` (created on first boot), runs each unapplied file inside its own transaction.
- We deliberately do **not** use `drizzle-kit migrate` here — the journal at [packages/shared/drizzle/meta/_journal.json](packages/shared/drizzle/meta/_journal.json) only catches drizzle-kit-generated files, but most of our migrations are hand-written (RLS, triggers, history-table syncs). The custom runner is journal-free: it sees the directory, period.
- Escape hatch: set `MIGRATIONS_AUTORUN=false` on a single instance to boot without running migrations. Use only when you need to debug a stuck migration; never in normal prod.
- Do **NOT** require a separate `psql -f` step in the deploy pipeline anymore. The `psql` route stays as a one-off fallback if the auto-runner is intentionally disabled. The docker-compose deploy in `infrastructure/deploy/` runs the API with the runner enabled by default.
- Hand-written migrations work without `_journal.json` entries — the runner doesn't read it. But if you also use `pnpm db:generate` on the schema, the journal still gets updated; the runner just ignores it.

### UUIDv7 Everywhere
All primary keys use UUIDv7 (timestamp-ordered). This improves B-tree index performance and gives a free creation timestamp embedded in every ID. Never use auto-incrementing integers or UUIDv4.

### Native `uuid` columns — identifiers are never `text` (locked)

**PostgreSQL:** Every primary key and every foreign-key / pointer column (`id`, `user_id`, `created_by`, `approved_by`, `*_id` referencing entities, etc.) MUST use the **`uuid`** type — **never `text`** (even when values look like `"018c…"` strings). Migration **`0062_uuid_column_type.sql`** normalized legacy `text` UUID columns to native `uuid`; new migrations must stay aligned.

**Drizzle (`packages/shared/src/db/schema/`):** Use **`uuid('column_name')`** (and **`uuidv7Pk()`** for PKs) for all identifiers and user/entity FKs. **`text()`** is only for human-readable strings (names, emails, hashed phones, URLs, free-form notes, enum-like labels stored as strings where appropriate).

**Temporal audit:** `modified_by` may still be typed as legacy text on some historical rows — prefer **`uuid`** when adding new actor-pointer columns; do not introduce **new** identifier columns as `text`.

### Temporal Tables (System-Versioned)
Every table that stores business data (orders, inventory, products, users, funding, ad_spend) must use PostgreSQL 18 system-versioned temporal logic. Every row has a `valid_period` (tstzrange) that records when that version of the row was true. When a row is updated, the old version is preserved with its time range. You can query the state of any record at any point in history.

### Row-Level Security (RLS)
Permissions are enforced at the database level, not just the application level. Even if the API has a bug, the database will block unauthorized access. Media Buyers can only see their own orders. CS agents can only see orders assigned to them. Finance can see all orders but only edit financial fields. Third-Party Logistics partners can only see orders allocated to their location.

### The Actor Injection Pattern
Every NestJS service method that performs a write operation must:
1. Begin a transaction
2. Execute `SET LOCAL yannis.current_user_id = '<authenticated_user_uuid>'`
3. Perform the write
4. Commit

This ensures the PostgreSQL trigger that manages the temporal audit trail knows WHO made the change. Never skip this step. Never hardcode a user ID.

**Use `withActor()` — never bare `pgClient.set_config`:**
The canonical pattern lives in [apps/api/src/common/db/with-actor.ts](apps/api/src/common/db/with-actor.ts):

```ts
import { withActor } from '../common/db/with-actor';

async someWrite(input: X, actor: SessionUser) {
  return withActor(this.db, actor, async (tx) => {
    await tx.insert(schema.orders).values({ ... });
    await tx.update(schema.users).set({ ... });
    return result;
  });
}
```

`withActor()` opens a drizzle transaction, runs `SET LOCAL yannis.current_user_id` as the first statement, then executes the callback on the pinned connection. Every write inside the callback is attributed to the actor.

**Why bare `pgClient.set_config(..., true)` is BROKEN (seen in the wild, flagged 2026-04-24):**
postgres.js uses a pooled connection pool (default `max: 5`). Running
```ts
await this.pgClient`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`;
// ... this.db.insert(...) or this.db.transaction(...)
```
sets the variable on ONE pooled connection for the duration of that bare SELECT's auto-commit transaction — **the setting dies the instant the SELECT completes**. The subsequent drizzle write lands on whatever pooled connection is available (often different, never guaranteed), where `yannis.current_user_id` is empty. The trigger records `NULL`, and the audit UI displays "System" for the actor. This is silent — it *sometimes* works when the pool reuses the same connection, masking the bug until someone inspects the audit trail.

The fix is ALWAYS to put `SET LOCAL` inside the same drizzle transaction as the writes (use `withActor()` or `tx.execute(sql\`SET LOCAL...\`)` as the first statement in an existing `this.db.transaction(...)` call).

**Migration status (2026-04-24):** inventory, products, and settings services have been converted. Cart, logistics, marketing, hr, finance, orders, users, voip, permission-requests services still have `this.pgClient\`SELECT set_config...\`` callsites and will intermittently show "System" in audit until converted. Convert them when touching those service methods for other reasons — the refactor is mechanical but multi-file and should not be rushed.

### Numeric Columns, Temporal Triggers, and History Table Sync (Troubleshooting)

**Problem:** Drizzle/Postgres.js can serialize numeric values as text. The `yannis_capture_history_insert` trigger copies new rows into `*_history` tables. When numeric columns arrive as text, PostgreSQL errors: `column "X" is of type numeric but expression is of type text`.

**Three layers to fix:**

| Layer | Cause | Fix |
|-------|-------|-----|
| **API insert** | Drizzle sends numbers as strings | Use `sql\`${value}::numeric\`` for numeric columns in `.values()` or `.set()` |
| **Trigger** | Generic `EXECUTE ... USING NEW` loses numeric types in dynamic SQL | Add table-specific trigger with explicit `(NEW.column_name)::numeric` casts (see `0012_fix_capture_history_insert_numeric.sql` for products example) |
| **History schema** | `*_history` tables drift when main table is altered | When altering a main table, add migration to sync `*_history` (ADD COLUMN, DROP COLUMN, etc.) |

**Tables with numeric columns using the INSERT trigger:** orders, order_items, invoices, stock_batches, offer_templates, marketing_funding, ad_spend_logs, payout_records, earnings_adjustments, finance tables, hr tables.

**Avoid:** `String(value)` or `value.toFixed(2)` for numeric columns — use `sql\`${value}::numeric\`` or pass numbers and let the trigger cast. Reference: `packages/shared/drizzle/0012_fix_capture_history_insert_numeric.sql`, `apps/api/src/products/products.service.ts`.

---

## The Order Lifecycle (The Most Critical State Machine)

This is the heartbeat of the entire system. Every module connects to this flow. Get this wrong and everything breaks.

```
UNPROCESSED → CS_ASSIGNED → CS_ENGAGED → CONFIRMED → ALLOCATED → DISPATCHED → IN_TRANSIT → DELIVERED → COMPLETED
       |            |              |
       |            |              PARTIALLY_DELIVERED
       |            |              RETURNED
       |            |              RESTOCKED / WRITTEN_OFF
       |            CANCELLED
       CANCELLED
```

- **CS_ASSIGNED**: Set when the algorithm or Head of CS assigns an order to a sales agent; the agent has not yet clicked Engage. Transition to CS_ENGAGED when the agent engages (e.g. clicks Call).

### State Transition Rules (Enforce as Hard Constraints)

| From | To | Trigger | Gate (Must Pass) | Side Effect |
|---|---|---|---|---|
| — | UNPROCESSED | Edge form submission | Dedup check (phone+product, 6hr window) | None — stock not touched yet |
| UNPROCESSED | CS_ASSIGNED | Algorithm or HoS assigns order to agent | Agent has capacity | None — order in agent queue |
| UNPROCESSED | CS_ENGAGED | CS agent takes unassigned order | Agent must have capacity (pending < max) | Order locked to agent for 15 min |
| UNPROCESSED | CANCELLED | CS/HoS cancels | Mandatory reason note (min 10 chars) | None |
| CS_ASSIGNED | CS_ENGAGED | CS agent clicks Engage / Call | Agent must have capacity (pending < max) | Order locked to agent for 15 min |
| CS_ASSIGNED | CANCELLED | CS/HoS cancels | Mandatory reason note (min 10 chars) | None — stock was never reserved |
| CS_ENGAGED | CONFIRMED | CS clicks Confirm | VOIP call_duration > 15 seconds | Stock: Available → Reserved |
| CS_ENGAGED | CANCELLED | CS clicks Cancel | Mandatory reason note (min 10 chars) | None — stock was never reserved |
| CONFIRMED | ALLOCATED | **Assigned CS agent**, Logistics, or admin assigns to 3PL | 3PL location must have available stock | Stock: Reserved → Allocated_to_3PL |
| ALLOCATED | DISPATCHED | 3PL rider picks up | Rider must be assigned | Stock: Allocated → In_Transit |
| DISPATCHED | IN_TRANSIT | Rider confirms departure | GPS ping logged | Delivery timer starts |
| ALLOCATED / DISPATCHED / IN_TRANSIT | DELIVERED | Rider confirms delivery **OR** assigned CS agent / HoLogistics confirms via follow-up call | Rider path: OTP/signature/GPS; CS/HoLogistics path: delivery note + screenshot both optional. 3PL not in-app yet — CS is the de facto rider-proxy and normally marks from ALLOCATED directly. | Stock: Deducted. Commission: Triggered. Revenue: Recognized |
| IN_TRANSIT | PARTIALLY_DELIVERED | Rider marks partial | Must specify delivered qty vs returned qty | Split: delivered portion completes, returned portion enters return flow |
| IN_TRANSIT | RETURNED | Rider marks rejected | Mandatory return reason | Return flow begins |
| RETURNED | RESTOCKED | 3PL marks sellable | Quality check by 3PL manager | Stock: +1 at 3PL local inventory |
| RETURNED | WRITTEN_OFF | 3PL marks damaged | Mandatory damage note | Logged as Operational Loss in Finance |

**Hard rules:**
- Orders CANNOT skip states. UNPROCESSED cannot jump to DISPATCHED.
- Every state transition requires an authenticated actor (no system auto-progression without a named user, except UNPROCESSED which is created by the Edge Worker).
- Every state transition is permanently logged in the temporal audit trail.
- The UI must disable state-change buttons that violate the allowed transitions.

---

## Module-Specific Agent Instructions

### When Building the Edge Sales Module
- The form is hosted on a Cloudflare Worker, NOT on the Remix server
- Implement idempotency: hash fingerprint + phone + timestamp to prevent double-submissions
- Implement the circuit breaker: if NestJS API latency > 2000ms or returns 5xx, buffer the order in QStash
- Implement the inventory budget cap: query Redis for (pending + confirmed) count per product. If >= (total_stock - 10% buffer), return a Sold Out response to the form
- The form supports 3 deployment modes: Shadow DOM snippet, iframe, and hosted URL
- Media Buyers select from pre-approved Offer Templates (configured by Stock Manager). They CANNOT set prices or modify product details

**Dedup is per-Media-Buyer, not global (CEO directive 2026-04-27 — migration 0079):**
The 6-hour `(phone + product)` dedup key in Cloudflare KV is scoped by `mediaBuyerId`. Same MB resubmits → KV short-circuits at the edge with `alreadySubmitted: true` (no API call, no order, no record — same as before). DIFFERENT MB submits the same `(phone + product)` within 6h → KV miss; the API runs `OrdersService.detectDuplicates` and, if a same-phone+product order exists from another MB in the last 6h, the API does **NOT** create a new order. Instead it inserts a `cross_funnel_attempts` row and returns `{ crossFunnelAttempt: true }`. The Edge Worker then marks dedup for the runner-up MB and returns `alreadySubmitted: true` to the form (same UX as same-MB dedup).

**Cross-funnel attempts are strictly per-MB visibility:**
- The runner-up MB (the one who would have lost attribution silently) sees their attempts on `/admin/marketing/cross-funnel`. HoM sees their branch's MBs. Admin-class sees all. CS / Logistics / Finance / HR **never** see this data.
- These rows are **NOT orders**. They never appear in `orders.list`, the CS queue, the Order Pipeline, profit reports, CPA / ROAS, commission, or any materialized view. Do NOT add joins from `orders` → `cross_funnel_attempts` that bleed counts back into operational metrics — the entire point of the separate table is metrics isolation.
- Phone is stored as `customer_phone_hash` only (Pillar 2). Customer name and product are stored so the MB has enough context to recognize their own funnel's traffic without exposing PII beyond what an order would already show.
- tRPC procedures: `marketing.listMyCrossFunnelAttempts` (paginated), `marketing.crossFunnelStats` (totals + per-product breakdown). Service: `MarketingService.listMyCrossFunnelAttempts` / `crossFunnelStats` ([apps/api/src/marketing/marketing.service.ts](apps/api/src/marketing/marketing.service.ts)). Page: [apps/web/app/features/marketing/MarketingCrossFunnelPage.tsx](apps/web/app/features/marketing/MarketingCrossFunnelPage.tsx).
- Detection lives in `OrdersService.create` and **only fires for `orderSource === 'edge-form'` with a `mediaBuyerId`**. Direct/admin/CS-offline order paths do not record cross-funnel attempts (no funnel attribution to compare).
- Form UX: when the API returns `alreadySubmitted: true` (whether from KV or cross-funnel), the form shows the message inline AND **disables the submit button** AND **skips the `successCallbackUrl` redirect**. Without this, the funnel's thank-you page silently masks duplicate submissions and customers can post the same order 3+ times thinking each worked. Do NOT remove the `alreadySubmitted` branch from `submitOrder().then(...)` in [apps/edge-worker/src/index.ts](apps/edge-worker/src/index.ts).

### When Building the CS Module
- Phone numbers in API responses must be masked: 0803****1234. The full number is NEVER sent to the frontend
- The Call button sends a call_token to the VOIP provider, which connects the two parties. The frontend never receives the raw number
- Four dispatch modes configurable by HoCS via `system_settings` (`CS_DISPATCH_STRATEGY.strategy`). Default is `manual`. UI must list them in this order:
  - `manual` (DEFAULT): no auto-assignment and no claim broadcast. Orders land as `UNPROCESSED` with `csAgentId = null` and wait for HoCS / SuperAdmin / Branch Admin to assign via Hot Swap. Agents cannot pull orders.
  - `load_balanced`: algorithm auto-pushes to agent with fewest pending, tie-breaker most idle.
  - `performance`: prioritises agents with higher delivery + confirmation rates (this month).
  - `claim`: orders sit in an open pool; reps race to claim via `claimOrder()` with atomic Redis/Postgres lock.
  - Claim cap (`CS_CLAIM_CAP.cap`, default 2): rep blocked from claiming if they have ≥ cap unconfirmed orders — enforced server-side. Only applies in `claim` mode.
  - CEO directive: `manual` is the default so Head of CS retains full control over order distribution. Do NOT change the default without an explicit product decision.
- **Confirm gate (locked 2026-04-26 — keep backend + web in sync):** For the **assigned CS agent**, the Confirm button stays disabled until a qualifying call exists on the order (VOIP: `call_duration ≥ 15s` on a completed call; manual mode: at least one call log). **Overrides (3PL often off-platform):** `SuperAdmin` / `Admin` (`isAdminLevel` — `apps/api/src/common/authz.ts`, `apps/web/app/lib/rbac.ts`) and **Branch Admin** (`BRANCH_ADMIN` when `order.branchId === session.currentBranchId`) **bypass** the call-log requirement for confirm (server gate in `orders.service.ts::validateTransitionGates` + UI in `OrderDetailPage.tsx`). **Head of CS** (org-wide) may confirm using **any** rep's qualifying call on **that order** (not only `actor.id`), for orders that have a `branch_id`. Do NOT strip these overrides without a CEO directive — they exist so ops can confirm when reps or 3PL are not in-app.
- **Order reassignment is a management action only.** CS agents CANNOT transfer orders between themselves. Only HoCS and SuperAdmin can reassign via Hot Swap. The `order_transfer_requests` table and all agent-initiated transfer UI/procedures are REMOVED.
- Head of CS can Hot Swap — select orders from one agent and mass-reassign to another
- When CS updates an order (address change, quantity change, upsell), the system creates a VERSION SNAPSHOT, not an in-place edit. The original data is preserved in the temporal table. The order history timeline shows every change with the agent's name and timestamp

**CS owns the order end-to-end (rider-proxy model):**
Because the 3PL partners are not in-app yet, the assigned CS agent is the de facto operator through delivery. They:
- Allocate to a 3PL (`CONFIRMED → ALLOCATED`) themselves — see "Share to 3PL" below. Authorized: assigned CS agent, HoCS, HoLogistics, LogisticsManager, SuperAdmin, Admin. (CS-only **confirm/cancel** also allows **Branch Admin** same-branch — see confirm gate above.)
- Confirm delivery via follow-up call (`ALLOCATED → DELIVERED`, or from DISPATCHED / IN_TRANSIT if the order passed through those). Authorized: assigned CS agent, HoLogistics, SuperAdmin, Admin (plus TPL_MANAGER with resolveReceiptUrl). Both `deliveryNote` and `deliveryProofUrl` are optional (CEO directive 2026-04-24 reversed the prior mandatory-note rule). When provided, they're stored on the order (`delivery_notes`, `delivery_proof_url`).
- COMPLETED stays with the accountant — set only when remittance is received/reconciled. CS never marks COMPLETED. Do not shortcut this.

**Share to 3PL (WhatsApp group flow):**
- 3PL locations carry an optional `whatsapp_group_link` (added in migration 0058). Logistics partners page form accepts it at creation time. Only `chat.whatsapp.com/...` or `wa.me/...` URLs are valid.
- `message_channel` enum gained `WHATSAPP_GROUP` so `message_templates` and `outbound_messages` can carry dispatch-to-3PL messages without conflating them with customer-facing SMS/WhatsApp DMs.
- tRPC: `messaging.shareToLogistics({ orderId, locationId, templateId })` renders the template, writes `outbound_messages` + `order_timeline_events` in one transaction, returns `{ renderedBody, groupLink, locationName }`.
- UI flow ("Share to 3PL" on Order detail, visible when order is `CONFIRMED` or `ALLOCATED` AND at least one location has a group link AND at least one `WHATSAPP_GROUP` template exists): user picks location + template, hits "Copy & open group". Client copies rendered body to clipboard, then `window.open(groupLink)`. User pastes + sends manually in the group.
- WhatsApp platform limit: group invite links (`chat.whatsapp.com/...`) **cannot** carry a pre-filled `?text=` payload. Do NOT try to deep-link with text — it's silently ignored. The two-step (copy + open) is the best one-click UX available and is intentional.
- Placeholders supported in WHATSAPP_GROUP templates: all the CS ones (`{{customer_name}}`, `{{order_id}}`, `{{product_name}}`, `{{delivery_address}}`, `{{estimated_date}}`) plus `{{quantity}}`, `{{total_amount}}`, `{{payment_status}}`. Server-side allowlist in `messaging.router.ts::ALLOWED_TEMPLATE_PLACEHOLDERS` is the source of truth.
- Double-entry is expected for the first 6 months while 3PL managers learn to trust in-app notifications — the Share button exists to make that copy/paste step take 2 seconds instead of 30, not to replace the group chat. HoCS / HoLogistics own the template content via the existing template admin UI.

**CS Communication Panel (order detail page):**
- Three channels in one unified panel: Call (existing VOIP), SMS, WhatsApp
- SMS: rep types/selects message, platform sends via messaging bridge (Twilio SMS). Raw phone NEVER exposed.
- WhatsApp: one-click template messages only. Templates have placeholders (`{{customer_name}}`, `{{product_name}}`, `{{order_id}}`, `{{delivery_address}}`, `{{estimated_date}}`). Auto-filled from order data. Rep selects template → previews rendered message → sends. No custom freeform WhatsApp messages.
- All sends go through the platform bridge. Rep never sees the raw phone number.
- Every send is written to `outbound_messages` table AND triggers an `order_timeline_events` entry in the same transaction.
- Template management: HoCS/SuperAdmin create/edit/archive `message_templates` (branch-scoped). New NestJS module: `messaging/`. New tRPC router: `messaging.router.ts`.

**Supervisor Mirror View** (Socket.io live screen-state — distinct from "Mirror Mode" below):
- HoCS can open a read-only live view of any CS rep's current screen state
- CS rep broadcasts `agent:state_update` event via Socket.io on every route/panel change: `{ agentId, currentRoute, currentOrderId, currentPanel, lastActionAt }`
- Server stores last known agent state in Redis; relays to supervisor's room
- `supervisor:watching` event sent back to rep when mirror is opened — rep must see an "Being Observed" indicator in the UI (transparency requirement)
- Mirror View is strictly read-only. Supervisor cannot take actions through it.
- New Socket.io events: `agent:state_update`, `supervisor:watching`, `supervisor:stopped_watching`

**Mirror Mode** (full-session impersonation — distinct from Supervisor Mirror View above):
The admin temporarily renders the entire app *as* another user — their role, branch, RLS, sidebar, theme, font scale. Different from Supervisor Mirror View, which only watches a rep's screen state via Socket.io. Mirror Mode actually **swaps the session identity**.

- **Trigger**: "Mirror user" on the user detail page (`/hr/users/:id`) when `viewerShowsMirror` is true (server: `branches.canMirrorToUser`: `allowed` or `previewEligible`). While already mirroring, `allowed` is false (no nested chains) but `previewEligible` may be true so the button shows **disabled** until exit mirror. POSTs `intent=mirror` to `/auth/mirror/start` then redirects to `/admin`.
- **Permission gate** (`apps/api/src/common/authz.ts::canMirror` for role-matrix heads/admins; **plus** async supervision in `auth.service.ts::startMirror` and `branches.canMirrorToUser`):
  - SuperAdmin / Admin can mirror anyone except another admin-level user.
  - HEAD_OF_CS → CS_AGENT (any branch — org-wide head).
  - HEAD_OF_MARKETING → MEDIA_BUYER (any branch — org-wide head).
  - HEAD_OF_LOGISTICS → LOGISTICS_MANAGER / TPL_MANAGER / TPL_RIDER / STOCK_MANAGER (any branch — org-wide head).
  - **Branch supervisors** (`branch_teams` / `branch_team_members`, same active branch): CS team supervisor → supervised `CS_AGENT`; marketing team supervisor → supervised `MEDIA_BUYER`.
  - HR_MANAGER cannot mirror anyone (per CEO directive — HR doesn't need it).
  - Nobody can self-mirror; nested mirroring is forbidden (you must exit first).
- **Read-only enforcement**: `apps/api/src/trpc/trpc.ts` has a root-level middleware (`blockMutationsWhileMirroring`) that rejects any tRPC `mutation` while `ctx.user.mirroredBy` is set. Returns a clear `FORBIDDEN` with the message "Read-only while mirroring user. Exit mirror mode to make changes." Backend services don't need to know about Mirror Mode — the gate is centralised.
- **Session shape**: `SessionUser` carries `mirroredBy: { id, name, role } | null` and `mirrorSessionId: string | null`. The mirrored session has the **target user's** id, role, branch, theme, font-scale; `mirroredBy` points to the original admin. `/auth/me` returns these fields and `getCurrentUser` (web) re-exposes them on the loader user object.
- **Audit trail** — `mirror_sessions` table (migration `0065_mirror_sessions.sql`):
  - One row per mirror session (`actor_id`, `target_id`, `started_at`, `ended_at`, `ip_address`, `user_agent`).
  - `started_at` stamped on `startMirror`. `ended_at` stamped on `stopMirror`. Rows are **permanent** — never delete; never reuse the row when a new mirror starts (open a fresh row).
  - Indexed on `actor_id`, `target_id`, `started_at`, `ended_at`.
  - Surfaced in the UI at `/admin/analytics/audit` as a separate "Mirror Mode sessions" card above the row-level audit table — populated by `audit.mirrorSessions` tRPC procedure (in `apps/api/src/audit/audit.service.ts::getMirrorSessions`). Active sessions render with a pulsing green "Active" badge.
- **No side-effects on the target user** — Mirror Mode is *strictly* view-only:
  - Server: `blockMutationsWhileMirroring` rejects every tRPC mutation.
  - Notifications: `NotificationsStateProvider` receives `readOnly={!!user.mirroredBy}` from DashboardLayout — both `markAsRead` and `markAllReadFn` no-op so the admin's clicks never mark the target's notifications as read on their behalf. The bell still renders the user's notifications visually.
  - Socket broadcasts: `useAgentStateBroadcast` reads `document.documentElement.dataset.mirror` before emitting and skips when set — admin navigation while mirroring a CS agent doesn't bleed into the supervisor mirror view or update the target's `lastActionAt`.
  - DashboardLayout writes/clears `<html data-mirror="1">` on mount based on `user.mirroredBy`. Any new client-side side-effect helper MUST check this flag and bail.
- **UI chrome** — when `mirroredBy` is set:
  - A `fixed inset-0 pointer-events-none z-[80] border-4 border-success-500` overlay frames the entire viewport (not `ring-inset` on the layout div — that hugs the content area and misses the bottom of long pages).
  - Full-screen "Entering mirror mode…" / "Exiting mirror…" loader is rendered while `useNavigation()` reports a `mirror` or `exitMirror` form submit. The same DashboardLayout wraps both `/hr/users/:id` (where mirror starts) and `/admin/*` (the redirect target), so the loader persists across the redirect — no flash of the old page.
  - Header renders an "Exit mirror" pill (success-coloured, pulsing dot, tooltip showing both names) that posts `intent=exitMirror` to `/admin?index` → the admin layout action calls `/auth/mirror/stop` → the original session is restored and we redirect to `/admin`.
  - Sidebar / branch switcher / notifications all render against the target's identity automatically — no special handling needed.
- **Phone numbers stay masked**: when an admin mirrors a CS agent, the agent's regular phone-mask + Click-to-Call rules apply. Mirror Mode is not a side-channel for raw PII.
- **Do NOT** add an "exit mirror" hard route at the API layer — the cookie + session is updated in place by `stopMirror`, and any redirect-based "logout" would also kill the original admin's session.
- **Do NOT** use Mirror Mode to perform actions on the user's behalf — that's what `users.update` is for. Every mutation throws by design.
- Files: `apps/api/src/auth/auth.service.ts` (start/stopMirror + supervision fallback), `apps/api/src/auth/auth.controller.ts` (`POST /auth/mirror/start`, `POST /auth/mirror/stop`), `apps/api/src/branches/branch-teams.service.ts` (supervision graph), `apps/api/src/trpc/routers/branches.router.ts` (`canMirrorToUser`), `apps/api/src/common/decorators/current-user.decorator.ts` (SessionUser fields), `apps/api/src/common/authz.ts` (canMirror), `apps/api/src/trpc/trpc.ts` (mutation block middleware), `apps/web/app/components/layout/dashboard-layout.tsx` (green ring), `apps/web/app/components/layout/header.tsx` (Exit pill), `apps/web/app/features/users/UserDetailPage.tsx` (Mirror button), `apps/web/app/routes/hr.users.$id/route.tsx` (mirror intent → start; mirror button uses `branches.canMirrorToUser`), `apps/web/app/routes/admin/route.tsx` (exitMirror intent → stop).

**Order Lifecycle Timeline (shared across ALL order detail pages):**
- Every state transition service method MUST write an `order_timeline_events` row in the same transaction — never separately, never optionally
- Use the `writeTimelineEvent(tx, { orderId, eventType, actorId, actorName, description, metadata })` helper (to be built in `orders.service.ts`)
- `actor_name` is denormalized at write time (snapshot of name at moment of event) — do NOT join on users at query time
- The `OrderTimeline` component (`~/components/ui/order-timeline.tsx`) is shared across all role-specific order detail pages: CS, Logistics, Finance, 3PL, SuperAdmin
- Role filtering of visible event types is applied in the tRPC procedure (`orders.getTimeline`), not in the frontend component

### When Building the Inventory Module
- Inventory is tracked by LOCATION (Main Warehouse, 3PL Location A, 3PL Location B, etc.)
- Product creation supports optional initial stock: quantity + location. When provided, creates a FIFO batch using cost price as factory cost (landing = 0). Restock via Inventory → Stock Intake.
- Use FIFO batch costing: each stock intake is a separate batch with its own landed cost
- Stock states per unit: AVAILABLE, RESERVED, ALLOCATED_TO_3PL, IN_TRANSIT, DELIVERED, RETURNED, WRITTEN_OFF
- The Virtual Buffer means the Sales Module sees 10% less stock than actually exists, preventing overselling during high-traffic bursts
- Ghost Stock prevention: if a 3PL physical count does not match the digital record, the Dispatch button for that location is LOCKED until a Stock Reconciliation form is submitted with mandatory reason codes (Damaged, Lost, Expired, Theft)

**Order ↔ shelf integrity (locked 2026-04-26 — do not regress):** Shelf truth lives in `inventory_levels` (`stock_count`, `reserved_count` per `product_id × location_id`). FIFO COGS consumption lives in `stock_batches.remaining_quantity` (per product, global batches). Order transitions must stay aligned with `InventoryService` — do not reintroduce “movements only” without level updates.

| Transition | Server enforcement | Implementation |
|---|---|---|
| `CONFIRMED` | Before status write: sum of `(stock_count − reserved_count)` across **all** locations plus sum of batch `remaining_quantity` must cover each product line (`assertGlobalAvailabilityForOrder`). | `apps/api/src/inventory/inventory.service.ts` from `orders.service.ts::validateTransitionGates` |
| `ALLOCATED` | After dispatch-lock check: same coverage **at the chosen `logistics_location_id`** (`assertLocationCanFulfillOrder`). Side effect: **one transaction** — increment `reserved_count` at that location + insert `ALLOCATION` movements per product aggregate (`reserveForAllocateWithMovements`). | Same files; `executeTransitionSideEffects` must receive **post-update** order + metadata so `logisticsLocationId` is never read from a stale row |
| `DELIVERED` | Requires `orders.logistics_location_id`. **One `withActor` transaction:** FIFO decrement `stock_batches`, insert `DELIVERY` movement, decrement `stock_count` and up to `min(reserved_count, qty)` at that location (`completeDeliveryInventory`). Then low-stock notify. | `inventory.service.ts` |

**3PL off-platform — verify warehouse transfers:** `inventory.verifyTransfer` is granted to `TPL_MANAGER`, **`HEAD_OF_LOGISTICS`**, and **`STOCK_MANAGER`** in `packages/shared/scripts/seed-permissions.ts` so internal staff can post receipt when the partner never logs in. After changing role matrices, run `pnpm db:seed-permissions` so `role_permissions` stays synced.

### When Building the App Theme System
- 6 theme IDs: `system`, `light`, `dark`, `dim`, `ink`, `soft`
- `users.app_theme` is nullable — `null` means follow org default (`system_settings.client_ui_config.defaultTheme`)
- Always inline `getThemeBootScript()` in `root.tsx` BEFORE `<style>` tags to prevent theme flash on load
- `applyAppTheme(id)` sets `data-app-theme` attribute on `<html>` + adds/removes `dark` class
- `useAppTheme()` hook dispatches a custom `app-theme-change` event for cross-component sync
- Legacy migration: map `'neutral'` → `'dim'` and `'contrast'` → `'light'` on any read from localStorage
- Server persistence: call `users.updateMyAppTheme(appTheme)` via `trpc-browser.ts` (session-less fetch)

### When Building the Font Scale System
- 3 scale IDs: `base` (14 px root, default), `large` (15.75 px, ×1.125), `xlarge` (17.5 px, ×1.25).
- `users.font_scale` is nullable — `null` means `base`.
- Implemented by scaling the root `html` `font-size`; every Tailwind utility is rem-based so text + spacing scale together (behaves like browser zoom but persisted per-user).
- Inline `getFontScaleBootScript()` in `root.tsx` next to the theme script — both MUST be the first `<script>` tags in `<head>` (before any stylesheet link) to prevent a pixel-size flash on paint.
- `applyFontScale(id)` sets `data-font-scale` on `<html>` and writes `documentElement.style.fontSize = <px>`. The inline style wins over the `html { font-size: 14px }` CSS fallback in `tailwind.css`.
- `useFontScale()` hook mirrors `useAppTheme()` (localStorage + cross-tab `yannis-font-scale-change` event + server sync).
- Server sync: `useServerFontScaleSync(isLoggedInArea)` in `root.tsx` pulls `settings.getClientConfig.effectiveFontScale` on login so preference follows the user across devices.
- Do NOT add media queries for font scaling — it's a root-relative rem scale that works mobile + desktop identically.

### When Building the Push Notification Center
The push system has four layers — all must be consistent:

**1. Mirror In-App → Push**
- In `notifications.service.ts`, after every `db.insert(notifications)`, call `sendPush(userId, { title, body, data: { url }, tag })`.
- Never fire push without also saving the in-app notification row first.

**2. Broadcast (`/admin/notifications/broadcast`)**
- Insert one `push_broadcasts` row, then fan out to all target users' subscriptions as `push_delivery_log` rows with status `SENT`.
- Role scope enforcement server-side: HoCS→CS_AGENT only, HoM→MEDIA_BUYER only, HoLogistics→RIDER+LOGISTICS_MANAGER only, SuperAdmin→all.
- The broadcast tRPC procedure must reject out-of-scope targets even if the client sends them.

**3. Automation Rules (`push_automation_rules` table)**
- `CRON` rules: registered with `@nestjs/schedule` `@Cron()` dynamically from DB at startup + on rule create/update/toggle.
- `EVENT` rules: checked inline in the relevant service method when the event fires (e.g. `ordersService` checks for `order_stuck` rules after status check).
- Placeholders in `title_template`/`body_template` resolved before send: `{{user_name}}`, `{{order_count}}`, `{{product_name}}`, etc.
- Active toggle: disabling a rule must unregister its cron job. Enabling must re-register it.

**4. Delivery Log + Ack**
- Every `sendPush()` call writes to `push_delivery_log` with status `SENT` or `FAILED` (on VAPID error).
- `POST /api/push/ack { logId, event: 'shown' | 'clicked' }` — called from service worker. No session auth, but validate `logId` exists. Updates `shown_at` / `clicked_at` and advances status.
- Stale `410 Gone` VAPID errors → delete the `push_subscriptions` row immediately.
- Resend: re-calls `sendPush()` with the same payload and creates a NEW `push_delivery_log` row (do not mutate the original failed row).

**Platform rules (always apply):**
- Android PWA installed + permission granted → lock screen delivery works.
- iOS 16.4+: MUST be added to Home Screen. Show install banner when `isIOS && !navigator.standalone`. Request notification permission only after banner interaction.
- Every push payload: `{ title, body, icon: '/icon-192.png', badge: '/badge-72.png', data: { url, logId }, tag }`.
- SW `push` handler: always call `self.registration.showNotification()` — never skip even if app is open.
- SW `notificationclick` handler: `clients.openWindow(data.url)` + POST to `/api/push/ack` with `clicked`.
- SW `push` handler: after `showNotification()`, POST to `/api/push/ack` with `shown`.

### When Building the Third-Party Logistics Module
- Third-Party Logistics partners get their OWN login and simplified dashboard (not the full internal UI)
- Dual-Entry Transfer: when Main Warehouse sends 100 units, those units are IN_TRANSIT — NOT available at the 3PL until the 3PL manager clicks Verify and Receive and inputs the actual received quantity
- If received qty < sent qty, the system auto-generates a Shrinkage Alert to the CEO and Head of Logistics
- Local Restock: when a return is marked Sellable by the 3PL, the unit goes directly back into that 3PL local available stock (no return-freight to main warehouse)
- Rider views live inside `apps/web` at the `/rider/` route group — NOT a separate app. Mobile-optimized layouts with PWA offline sync
- Rider Offline Sync: the rider PWA routes store delivery confirmations (with GPS + timestamp) in IndexedDB and syncs when back online. Use last-write-wins with GPS verification to prevent fraudulent timestamping

**Logistics Team Analysis (`/admin/logistics/team`):** Provider-company rollup of order-level outcomes — delivery rate, delinquency rate (returned + partially delivered + written off / assigned), and a per-status stacked-bar breakdown ranked by deliveryRate desc. Audience: `SUPER_ADMIN`, `ADMIN`, `HEAD_OF_LOGISTICS`, gated by the `logistics.teamOverview` permission code (granted to `HEAD_OF_LOGISTICS` in [packages/shared/src/rbac/permission-catalog.ts](packages/shared/src/rbac/permission-catalog.ts); ADMIN inherits via `ALL_PERMISSION_CODES`). Filters orders by `orders.allocated_at` so providers are scored only on what they've actually been responsible for. Branch scoping uses `ctx.currentBranchId` server-side; SuperAdmin/Admin and org-wide HoLogistics see all branches. Backend lives in `LogisticsService.getLogisticsProviderPerformance` exposed via `logistics.teamOverview` tRPC. After editing `permission-catalog.ts`, run `pnpm --filter @yannis/shared db:seed-permissions` to land the role-template grant. Files: [apps/api/src/logistics/logistics.service.ts](apps/api/src/logistics/logistics.service.ts), [apps/api/src/trpc/routers/logistics.router.ts](apps/api/src/trpc/routers/logistics.router.ts), [apps/web/app/routes/admin.logistics.team/route.tsx](apps/web/app/routes/admin.logistics.team/route.tsx), [apps/web/app/features/logistics/LogisticsTeamPage.tsx](apps/web/app/features/logistics/LogisticsTeamPage.tsx).

### When Building the Marketing Module
- Funding Ledger: HoM creates a funding record with amount + receipt image upload. Status starts as SENT. Media Buyer receives a PWA push notification and must click Mark Received (status becomes COMPLETED) or Not Received (status becomes DISPUTED, triggers alert to CEO)
- **Approve funding request = ledger row:** When HoM/Finance/SuperAdmin/Admin approves a `marketing_funding_requests` row (`approveFundingRequest`), the API **must** insert a matching `marketing_funding` row in the **same transaction** (status `SENT`, optional `source_funding_request_id` FK) so **Total Received**, the **Transfers** tab, and **getFundingBalance** stay aligned with **My Requests**. `createFunding` (Send Funding) remains the other path into the same ledger.
- Ad Spend Logging: Media Buyers log daily spend per product with a MANDATORY Ads Manager screenshot. No screenshot = no log entry accepted
- **Daily-grouped Add Expense (Phase 17, CEO directive 2026-04-27 — migration 0082):** The single-row "Log spend" form is replaced by a multi-line **"Add Expense"** modal where MBs record an entire day's spend in one batch (one shared `spendDate`, N line items each with campaign + auto-filled product + amount + platform + optional ad URL + screenshot). Backend: `marketing.createAdSpendBatch` writes all rows in one `withActor` transaction; HoM gets **ONE** notification per batch (`marketing:ad_spend_submitted`) — never N pings for one busy day. The `/admin/marketing/ad-spend` page renders an accordion grouped by `(spend_date, media_buyer_id)` (`marketing.listAdSpendGrouped`) — each accordion row = one day's batch with rolled-up status (`PENDING` if any line is pending; `APPROVED` / `REJECTED` only when uniform; otherwise `MIXED`). The legacy flat per-line table is preserved behind a "Detailed view" toggle for HoM/admin who need single-line edit/preview flows. New columns on `ad_spend_logs`: `platform ad_platform NOT NULL DEFAULT 'FACEBOOK'` (enum: FACEBOOK / TIKTOK / GOOGLE — extend with `ALTER TYPE ADD VALUE`) and `ad_url text` (optional, app-level URL validation). The `ad_spend_logs_history` and INSERT trigger were synced in the same migration. Do NOT regress to per-row-only entry — a busy MB has ~5–15 lines/day and the accordion is what makes that workflow tolerable.
- CPA = Total Ad Spend / Total Orders Created (all statuses)
- True ROAS = Total Revenue from DELIVERED orders only / Total Ad Spend
- If a Media Buyer logged spend vs actual leads exceeds a configurable threshold, auto-alert the Head of Marketing (High CPA Warning)

**Funding page layout — two-section model (CEO directive 2026-04-26):**
The two-tier funding flow (Finance → HoM, HoM → MB) is reflected in the page layout itself, so HoMs (who are both *receiver* and *disburser*) don't have to mentally untangle two roles on one screen. `/admin/marketing/funding` renders:

- **Section 1 — "Funds I've Received" / "Incoming Funding"** (always shown). HoM sees money from Finance; MB sees money from HoM. Tabs: **Transfers** (incoming, mark-received CTA on each `SENT` row) | **My Requests** (their outbound asks). Title is dynamic — `Funds I've Received` for HoM/Admin, `Incoming Funding` for MB (since some of their funding is still `SENT` waiting).
- **Section 2 — "Funds I Distribute"** (`canDistribute` — HoM/Admin only). Tabs: **Transfers** (sent ledger, read-only) | **MB Requests** (pending approval inbox). Header has a **+ Send Funding** button.

The shared ledger card header shows **+ Request Funds** whenever `canRequestFunding` (Media Buyer or Head of Marketing) — **not** only on Section 1 — so HoM can ask Finance without switching back from **Funds I Distribute**. **+ Send Funding** still appears only while the active primary tab is **Funds I Distribute** (`canSendFunding`).

URL state is `?section=received|distributing&tab=transfers|requests` plus per-(section,tab) `page` / `status` / `requestStatus` / `search`. Switching section drops those filter params (they're scoped to the slice you came from). Affordances stay unambiguous: `+ Request Funds` always means "ask upstream", `+ Send Funding` always means "disburse downstream".

**Funding-relevant top metrics** (replaced the old marketing-perf strip — CPA / ROAS / Delivery Rate / Confirmation Rate didn't speak to funding work):
- `Total Received` (period sum, incoming ledger `marketing_funding` — any status, `sent_at` in range)
- `Current balance` (Media Buyer + Head of Marketing on `/admin/marketing/funding` via `marketing.getFundingBalance`): **COMPLETED** incoming ledger total minus **APPROVED** ad spend on their campaigns (can trail Total Received while `SENT` transfers await mark-received)
- `Total Distributed` (HoM/Admin only — period sum, outgoing)
- `Pending Mark-Received` (count — incoming `SENT` awaiting confirmation; warning-coloured when > 0)
- `Disputed` (count of `DISPUTED` you're party to as either sender or receiver; danger-coloured when > 0)

Backed by `marketing.fundingByDirectionSummary` ([apps/api/src/marketing/marketing.service.ts](apps/api/src/marketing/marketing.service.ts)). Period filter applies to `sent_at`. No branch scoping — keyed entirely on the actor's id.

**Disputed banner**: when `disputedAsReceiver + disputedAsSender > 0`, a danger-coloured banner appears above the sections with a `Review` CTA that deep-links to the section/tab where most disputes live (`?status=DISPUTED`). Don't remove this — disputes are easy to lose track of in a busy ledger and the CEO has flagged them as the #1 funding-trust signal.

**Per-slice direction filters added 2026-04-26:**
- `marketing.fundingStatusCounts` accepts `senderId` (for outgoing-only counts) in addition to the existing `receiverId`.
- `marketing.fundingRequestStatusCounts` and `marketing.listFundingRequests` accept `excludeSelfAsRequester: boolean` so HoM's "MB Requests" inbox doesn't include their own outbound requests to Finance. Mutually exclusive with `requesterId` (explicit `requesterId` wins).

Do NOT regress the page back to a single-tabbed feed. The split is the whole point — `/admin/marketing/funding/my-requests` was the dead tail end of the old single-feed model and has been removed.

**Funding Request Notification Rules (never change these):**
- **Media Buyer requests funding** → notify `HEAD_OF_MARKETING` only. HoM is the one who funds them — SuperAdmin and Finance do NOT get this notification.
- **Head of Marketing requests funding** → notify `SUPER_ADMIN` + `FINANCE_OFFICER` only. This is a disbursement request that Finance must act on.
- **Funding disputed** (Media Buyer marks Not Received) → notify `SUPER_ADMIN` + `HEAD_OF_MARKETING`.
- Implemented in `marketing.service.ts` → `createFundingRequest()`. The `if (requesterRole === 'HEAD_OF_MARKETING')` branch handles HoM; the `else` branch handles Media Buyers. Do NOT collapse these or add SuperAdmin/Finance to the Media Buyer branch.

### When Building the Finance Module
- The True Profit formula: Revenue - (Landed COGS + Ad Spend + 3PL Fee + Delivery Fee + Commission)
- Column-Level Security: cost_price, landed_cost, and margin fields are STRIPPED from API responses unless the authenticated user has SuperAdmin or FinanceHead role. Use a NestJS interceptor for this — not frontend hiding
- Invoices use sequential reference numbers (INV-2026-0001). Auto-generated. No manual override
- Budget tracking: Finance Officers set budget limits per department/campaign. Requests exceeding remaining budget trigger a warning (approval still possible but requires explicit override with reason)

**Cash Remittance — accountant-led flow (Phase 18, CEO directive 2026-04-29):**
The 3PL partners aren't on-platform yet, so the **accountant** records cash remittances directly from `/admin/finance/delivery-remittances`. Flow:
1. Accountant clicks **Create cash remittance** → modal lists every `DELIVERED` order not yet on a remittance (`logistics.listDeliveryRemittanceEligibleOrders` — open to FINANCE / Finance hat / admin-class).
2. Multi-select orders sharing the SAME logistics location (server validates one-location-per-remittance — "one cash drop = one source"), upload receipt(s), optional notes.
3. **Mark received now** checkbox: when ticked, `logistics.createDeliveryRemittance` writes the remittance with `status = RECEIVED` AND bulk-transitions every linked order from `DELIVERED → COMPLETED` in the same transaction. When unticked, status stays `SENT` and the accountant marks Received later from the detail page (`logistics.markDeliveryRemittanceReceived` cascades the same COMPLETED transition).
4. Tabs: **All / Pending (SENT) / Received (RECEIVED) / Disputed (DISPUTED)** using the shared `<Tabs>` component. Filters: location, **Sent by** (accountant who recorded; populated from FINANCE_OFFICER + Finance hat + admin-class roles), date range.
5. Order detail surfaces a "Cash remittance: <id> · <Pending/Settled/Disputed>" badge linking to the remittance — explains why a `DELIVERED` order isn't yet `COMPLETED`, or where the receipt that closed it lives.

**Server gates** ([apps/api/src/logistics/logistics.service.ts](apps/api/src/logistics/logistics.service.ts) — yes, the methods live in LogisticsService for historical reasons):
- `createDeliveryRemittance` — TPL_MANAGER (legacy, when 3PL onboards) OR `hasFinanceAccess(actor) || isAdminLevel(actor)`. Validates: orders are DELIVERED, share one logistics location, none are already on a remittance.
- `markDeliveryRemittanceReceived` — Finance / admin / Finance hat. Cascade `DELIVERED → COMPLETED` on every linked order in the same `withActorAndBranch` transaction. Status guard (`AND status = 'DELIVERED'`) so a manually reverted order doesn't get stamped COMPLETED.
- `disputeDeliveryRemittance` — same gate. Does NOT touch order status.

**Do NOT** route remittance creation through `permissionProcedure('logistics.remit')` — that grant is for the legacy 3PL→warehouse stock transfer flow (`transferRemittances`, different table), not delivery cash remittances. The Phase 18 procedure is `authedProcedure` with role-gating in the service. The `logistics.remit` permission stays with TPL_MANAGER for the stock-transfer use case.

**Finance Payout workspace (Phase 19, rollout 2026-04-28):**
- New page: `/admin/finance/payout` (Finance group sidebar). Audience: `FINANCE_OFFICER`, Finance hat, admin-class.
- Purpose: review payroll batches in `PENDING_FINANCE`/`PAID`, inspect per-staff payout lines, export payout documents (CSV/XLSX) with bank details.
- Data source: `hr.listMonthlyPayrolls` + `hr.getBatch` (single source of truth; no duplicate finance-only payroll tables).
- Bank fields live on `users` (`payout_bank_name`, `payout_account_name`, `payout_account_number`; migration `0090_users_payout_bank_fields.sql`) and must be treated as finance-sensitive: expose only in finance flows, never in general staff lists.

**Finance "hat" (deputization, migration 0059 — CEO directive 2026-04-23):**
Finance is the ONLY role that can be worn on top of another primary role. Every other role is single-assignment. The hat is org-wide and a singleton: exactly one user in the entire org holds it at a time.
- Column on `users`: `is_finance_officer boolean not null default false`. Partial unique index `users_only_one_finance_officer` on `((1)) WHERE is_finance_officer = true` enforces the singleton at the DB layer.
- Session payload gains `isFinanceOfficer: boolean`. `hasFinanceAccess(user)` in [apps/api/src/common/utils/strip-finance-fields.ts](apps/api/src/common/utils/strip-finance-fields.ts) returns true when `role === 'FINANCE_OFFICER'` OR `isFinanceOfficer === true` (plus the existing admin/permission paths). Column-stripping interceptor and all finance tRPC gates honour this automatically.
- Assignment is atomic-swap: `UsersService.createStaff` / `update` clear the flag from the current holder in the same transaction before writing the new one. Do NOT try to enforce the singleton purely with the DB index — the app-level pre-clear is what lets the swap succeed without conflict. The index is the safety net.
- UI: the "Finance hat" checkbox appears on the user create form and the edit tab in [apps/web/app/features/users/UserCreatePage.tsx](apps/web/app/features/users/UserCreatePage.tsx) + [apps/web/app/features/users/UserDetailPage.tsx](apps/web/app/features/users/UserDetailPage.tsx). The form queries `users.getCurrentFinanceOfficer` at load time and shows a warning if another user already holds the hat — the save still goes through because the service does the swap.
- Primary role of `FINANCE_OFFICER` does NOT need the hat (role already grants the same powers). The UI hides the checkbox for that role.
- User detail header shows a `+ Finance hat` badge when the flag is set. The "Finance Activity" tab is visible for either `role === 'FINANCE_OFFICER'` OR `isFinanceOfficer === true`.
- Commission/payroll attribution is UNCHANGED — the hat is a capability grant, not a second commission bucket. Mary (Stock Manager + hat) still earns on her Stock Manager commission plan, not a Finance one.
- Assignment notifications are MANDATORY. When the hat moves, both parties are notified via the standard in-app + push + email channel:
  - New holder gets `account:finance_hat_assigned` ("You now hold the Finance hat").
  - Displaced holder (if any) gets `account:finance_hat_revoked` ("Finance hat reassigned to <name>").
  - Plain revoke (hat turned off without reassignment) also sends `account:finance_hat_revoked` to the user losing it.
  - Fired from `UsersService.notifyFinanceHatChange()` AFTER the swap transaction commits — notifications must never roll back the assignment on failure.

### When Building the HR and Payroll Module
- Settlement Window is **monthly only** (CEO directive 2026-04-26). The `settlement_window` enum still carries `WEEKLY`/`BIWEEKLY` for legacy rows, but the UI no longer offers them and `setSettlementConfig` should always be called with `MONTHLY`. Do not reintroduce sub-month cadences without a new directive.
- Commissions are calculated based on DELIVERED_AT timestamp, NOT CREATED_AT. A January order delivered in February is paid in the February cycle
- Clawback Engine: if a delivered order is later returned, the system creates a PENDING_DEDUCTION for both the Media Buyer AND the CS agent. This is subtracted from their next payout as a negative line item
- Add-on Earnings: HR can add manual bonuses (Special Service, Extra Shift, Performance Bonus). Each add-on requires Admin approval and appears as a DISTINCT line item in the staff payout breakdown — not lumped into base pay
- Commission rules are stored as JSONB in a commission_plans table. The structure supports: base salary thresholds (if orders >= X, base = Y), performance multipliers (if delivery_rate > Z%, bonus = W per extra order), and category tags for different staff roles
- Every staff member (CS, Media Buyer, Logistics, etc.) can have their own pay structure. The system is flexible enough that rules can be changed at any time by HR without developer intervention

**Multi-stage payroll workflow (CEO directive 2026-04-26 — migration 0067):**

Payroll is no longer a flat list of payouts that HR approves one by one. Each month, payroll is grouped into **batches** by `(branch_id × period_month × department)` so heads of department prepare their own team's payroll, HR reviews + adds adjustments, and Finance disburses. Tables: `payroll_batches`, plus `batch_id` FK on `payout_records`. Enums: `payroll_batch_status` (`DRAFT → PENDING_HR → PENDING_FINANCE → PAID`) and `payroll_department` (`CS | MARKETING | LOGISTICS | HR`).

**Department → owning Head mapping (locked):**
| Dept | Roles in batch | Owner who prepares |
|---|---|---|
| `CS` | `CS_AGENT` | `HEAD_OF_CS` |
| `MARKETING` | `MEDIA_BUYER` | `HEAD_OF_MARKETING` |
| `LOGISTICS` | `LOGISTICS_MANAGER`, `TPL_MANAGER`, `TPL_RIDER`, `STOCK_MANAGER` | `HEAD_OF_LOGISTICS` |
| `HR` | `HR_MANAGER`, `HEAD_OF_*`, `BRANCH_ADMIN`, `FINANCE_OFFICER` | `HR_MANAGER` (own bucket — heads can't pay themselves) |

`SUPER_ADMIN` / `ADMIN` are not on payroll. The mapping lives in `apps/api/src/hr/payroll-batch.service.ts::DEPARTMENT_ROLES` + `DEPARTMENT_OWNER_ROLE` — keep the two tables here in sync with that file.

**Lifecycle + permission gates:**
| Stage | Trigger | Gate (`apps/api/src/hr/payroll-batch.service.ts`) |
|---|---|---|
| `DRAFT` | `generateBatch()` derives payouts for staff in (branch, dept) | `canPrepareDept(viewer, branchId, dept)` — admin OR matching Head (`currentBranchId` matches branch, or org-wide head with null session branch — uses `input.branchId`) OR branch team supervisor (`CS`/`MARKETING`) OR branch `HR_MANAGER` for `LOGISTICS`/`HR` |
| `PENDING_HR` | `submitBatch()` (DRAFT → PENDING_HR) | Same as DRAFT (the owner submits) |
| `PENDING_FINANCE` | `approveBatch()` (PENDING_HR → PENDING_FINANCE) — HR may attach `hrNotes` and add per-staff adjustments via `addBatchAdjustment` while in this stage | `canReviewBatch` — admin OR `HR_MANAGER` |
| `PAID` | `markBatchPaid({ financeReference })` cascades all child payouts to PAID | `canProcessBatch` — admin OR `FINANCE_OFFICER` OR Finance hat (`hasFinanceAccess`) |

**Reject is an action, not a state.** `rejectBatch({ reason })`:
- From `PENDING_HR` → `DRAFT` (HR rejects to head; reason ≥ 10 chars)
- From `PENDING_FINANCE` → `PENDING_HR` (Finance rejects to HR)
- The batch is never destroyed. Forward-stage timestamps clear; rejection metadata persists until the next forward transition.

**Adjustments by stage:** `addBatchAdjustment` now supports both `DRAFT` (eligible preparers: head/admin/supervisor, plus branch HR for `LOGISTICS`/`HR`) and `PENDING_HR` (HR/admin review stage). All writes still route through `earnings_adjustments` + recompute helpers; do NOT edit payout totals directly.

**Generation rules:**
- `generateBatch` is only allowed for slots that are missing or in `DRAFT`. Submitted batches must be rejected first to be re-generated. Re-generating a `DRAFT` wipes its payouts and re-derives from the latest commission plans + delivered orders. Pending unattached `CLAWBACK` adjustments re-link to the new payout.
- One non-rejected batch per `(branch_id, period_month, department)` — enforced by `uq_payroll_batch_per_branch_dept_month`.
- A staff member with no commission plan is silently skipped (existing behavior).

**Notifications (4 new types in `packages/shared/src/notifications/config.ts`):**
- `hr:batch_submitted` → HR_MANAGER on the batch's branch (when head submits to HR)
- `hr:batch_approved` → all FINANCE_OFFICER + Finance hat holders (when HR forwards to Finance)
- `hr:batch_rejected` → owner of the previous stage (Head or HR)
- `hr:batch_paid` → HR_MANAGER + owning Head + every staff member in the batch (per-staff sent as the existing `hr:payout_approved` so the existing in-app feed handles it)

Deep-link mapper in `notifications.service.ts::getLinkPathForType` routes any `hr:batch_*` payload to `/hr/payroll?batchId=…` — the page auto-opens that batch's detail panel.

**RBAC + UI:**
- HR module is split across **two pages**, not one tabbed page (CEO directive 2026-04-26):
  - `/hr/payroll` — Monthly Payrolls (multi-stage batches). Admins / HR_MANAGER / Heads / Finance can land here. Heads see only their dept's batches.
  - `/hr/plans` — Commission Plans. Admins / HR_MANAGER / Heads can land here. Heads see + create + edit only their dept's roles.
  - Adjustments inbox lives on `/hr/payroll` for HR + admins. Heads / Finance don't see it. The legacy `/hr/payouts` flat list was retired (2026-04-28) — per-payout `payoutRecords.status` is now visible inside each batch detail panel as a `<StatusBadge />` column. Once Finance runs `markBatchPaid`, every child payout row shows `PAID` and the batch detail also surfaces a one-line note ("Finance marked this batch paid — every staff payout below is now PAID."). Settlement Config UI was removed — payroll always runs monthly.
  - Both sidebar entries are in the HR group (`dashboard-layout.tsx`). Do NOT merge them back into a tabbed page.
- `listMonthlyPayrolls` auto-scopes:
  - admins → all branches
  - HR Manager / Finance → their `currentBranchId`
  - Org-wide department heads with **null** `currentBranchId` → their **dept only**, all branches (optional `input.branchId` to narrow); heads with a session branch → that branch AND their dept only
  - branch supervisors (`branch_team_members.is_supervisor`) → their supervised department (`CS` / `MARKETING`) on their active branch only
- `hr.payrollPrepareAccess` is the canonical guard for non-head preparers entering `/hr/payroll` (e.g. branch supervisors). Do not open `/hr/payroll` to all CS/Marketing agents just to reach generation.
- `listCommissionPlans` / `createCommissionPlan` / `updateCommissionPlan` auto-scope by `getManageableRolesForViewer` (exported from `payroll-batch.service.ts`):
  - admin / HR_MANAGER → every role across all departments
  - HEAD_OF_CS → `CS_AGENT` only
  - HEAD_OF_MARKETING → `MEDIA_BUYER` only
  - HEAD_OF_LOGISTICS → `LOGISTICS_MANAGER` / `TPL_MANAGER` / `TPL_RIDER` / `STOCK_MANAGER`
  - everyone else → empty (no plan management)
  - The `createCommissionPlan` and `updateCommissionPlan` tRPC procedures are `authedProcedure` — they intentionally do NOT use `permissionProcedure('hr.write')` because Heads need to write without holding `hr.write`. The service layer is the canonical gate.
- Branch context flows through `withActorAndBranch(this.db, { id, currentBranchId }, ...)` — every batch write sets both `yannis.current_user_id` and `yannis.current_branch_id` so RLS + audit attribution work.

Files to know: [apps/api/src/hr/payroll-batch.service.ts](apps/api/src/hr/payroll-batch.service.ts), [apps/api/src/hr/hr.service.ts](apps/api/src/hr/hr.service.ts), [apps/api/src/trpc/routers/hr.router.ts](apps/api/src/trpc/routers/hr.router.ts), [apps/web/app/features/hr/MonthlyPayrolls.tsx](apps/web/app/features/hr/MonthlyPayrolls.tsx), [apps/web/app/features/hr/CommissionPlansPage.tsx](apps/web/app/features/hr/CommissionPlansPage.tsx), [apps/web/app/routes/hr.payroll/route.tsx](apps/web/app/routes/hr.payroll/route.tsx), [apps/web/app/routes/hr.plans/route.tsx](apps/web/app/routes/hr.plans/route.tsx), [apps/web/app/routes/hr.payroll-batch.$id/route.tsx](apps/web/app/routes/hr.payroll-batch.$id/route.tsx), [packages/shared/drizzle/0067_payroll_batches.sql](packages/shared/drizzle/0067_payroll_batches.sql).

---

## Permission-first RBAC (locked)

**Authoritative product write-up:** [prd.md](prd.md) **§5.3** (Permission-first RBAC). **Build / merge checklist:** [task.md](task.md) **Locked: Permission-first RBAC**. **Cursor lockfile (always-on):** [.cursor/rules/permission-first-rbac.mdc](.cursor/rules/permission-first-rbac.mdc).

- Authorization is **permission-first**; **`SUPER_ADMIN`** is the only unrestricted `permissionProcedure` bypass — do not treat **`ADMIN`** as automatic full permission.
- Effective perms = template ∪ legacy `role_permissions` ∪ user overrides (see `PermissionsService`).
- After catalog changes: `pnpm --filter @yannis/shared db:seed-permissions`; audit: `pnpm --filter @yannis/shared db:audit-permission-coverage`.

---

## RBAC Role Matrix

**Admin tier:** Two roles sit at the top. `SUPER_ADMIN` is a singleton (exactly one per org, created via `/auth/setup`). `ADMIN` is multi-instance and has equivalent operational authority EXCEPT the ability to manage other admin-level accounts.

| Role | Dashboard Scope | Can See COGS? | Can See Full Phone? | Can Approve Finance? | Can Edit Commission Rules? |
|---|---|---|---|---|---|
| SuperAdmin | Everything (all branches) | Yes | Via audit log only | Yes | Yes |
| Admin | Everything (all branches) | Yes | Via audit log only | Yes | Yes |
| Branch Admin | Own branch — users, settings, reports | No | No | Branch only | No |
| Head of Marketing | Marketing + Media Buyer performance | No | No | No | No |
| Media Buyer | Own campaigns, own orders, own payouts | No | No | No | No |
| Head of CS | CS team performance, all CS orders | No | No | No | No |
| CS Agent | Own assigned orders only | No | No (masked + VOIP) | No | No |
| Finance Officer | All financial data, all orders (read) | Yes | No | Yes (not own requests) | No |
| Head of Logistics | All logistics, all 3PL locations | No | No | No | No |
| Logistics Manager | Assigned location orders | No | No | No | No |
| 3PL Manager | Own location orders + stock only | No | No | No | No |
| 3PL Rider | Own assigned deliveries only | No | No (masked) | No | No |
| Stock Manager | Inventory, stock movements, procurement | No | No | No | No |
| HR Manager | All staff payouts, commission configs | No | No | No | Yes |

**SuperAdmin-only (Admin cannot):**
- Create, promote, demote, or deactivate another `ADMIN` or `SUPER_ADMIN` (Admin → non-admin-level staff only; ADMIN creating another ADMIN triggers the `permission_requests` approval flow, not a direct create).
- Kill sessions of another admin-level user (`DELETE /auth/sessions/:userId` blocks ADMIN targeting ADMIN/SUPER_ADMIN).
- Transfer the SUPER_ADMIN role (enforced in `users.service.update` — promotion to SUPER_ADMIN is rejected for all non-SuperAdmin callers).
- Access the initial `/auth/setup` flow (only creates when zero users exist).

**Implementation source of truth (do NOT inline `role === 'SUPER_ADMIN'` for admin-class checks):**
- Backend: `apps/api/src/common/authz.ts` → `isAdminLevel(user)`, `isSuperAdminOnly(user)`, `ADMIN_LEVEL_ROLES`.
- Frontend: `apps/web/app/lib/rbac.ts` → same helpers mirrored.
- Permission bypass: ONLY `SUPER_ADMIN` short-circuits in `PermissionsService.getEffectivePermissions` and `permissionProcedure`. `ADMIN` does NOT bypass — they go through the standard permission check just like every other role. The `ROLE_PERMISSIONS.ADMIN` entry in [packages/shared/src/rbac/permission-catalog.ts](packages/shared/src/rbac/permission-catalog.ts) is `ALL_PERMISSION_CODES` (every code in the catalog), so an ADMIN's session loads with the full set of 107 codes via the snapshot model, and every `permissionProcedure` check passes by membership rather than by short-circuit. Do not change this — admin-class privilege should be auditable in `user_permissions`, not invisible via a runtime bypass.
- Finance field stripping: `hasFinanceAccess` returns true for both.
- Branch visibility: `canViewAllBranches` returns true for admin-class **and** for org-wide department heads (`HEAD_OF_CS`, `HEAD_OF_MARKETING`, `HEAD_OF_LOGISTICS`).
- `SENSITIVE_ROLES` includes both `SUPER_ADMIN` and `ADMIN` — creating/promoting anyone into an admin-level role generates a `permission_request` for SuperAdmin approval.

**Head / HR uniqueness (ACTIVE + PENDING both count):**
- **Org-wide singletons:** `HEAD_OF_CS`, `HEAD_OF_MARKETING`, and `HEAD_OF_LOGISTICS` — at most one `ACTIVE` holder per role for the **whole org** (partial unique indexes `uq_active_head_of_*_org_wide` in migration `0080_org_wide_department_heads.sql`). Service-layer conflict checks use the same roles **without** filtering by `primary_branch_id`.
- **Per branch:** **`HR_MANAGER`** — at most one `ACTIVE`/`PENDING` per `primary_branch_id` (migration 0060 + service check on `HR_MANAGER` + branch).

Only `INACTIVE` / `DEACTIVATED` / `ARCHIVED` frees a slot for the next invite. Enforcement lives at:
- **Service:** `UsersService.createStaff` / `UsersService.update` — org-wide head roles vs `HR_MANAGER` branch-scoped path; filter `inArray(status, ['ACTIVE', 'PENDING'])`.
- **DB:** org-wide partial unique on `(true)` per head role (`0080`) + `uq_active_hr_manager_per_branch` for HR. Service checks remain the canonical guard for `PENDING`.
- **UI proactive warning:** `users.listActiveHeads` + `HEAD_ROLES` on `UserCreatePage.tsx` / `UserDetailPage.tsx` — org-wide head conflicts show for **any** primary branch choice; HR conflicts stay branch-keyed.

**Edge case — `primary_branch_id`:** Org-wide heads still **carry** a primary branch for HR/home-branch UX; uniqueness for their role is **not** keyed on that column. `HR_MANAGER` remains keyed on `primary_branch_id`.

---

## UI Component Reuse Rules (Non-Negotiable)

**The Platform has a shared component library. Every UI element must use it.**

### Component-First Rule
If a UI pattern appears in **2 or more places**, it must be a shared component in `apps/web/app/components/ui/`. Never duplicate raw Tailwind patterns across feature pages.

### When building new UI, always reach for these components first:

| Need | Use |
|---|---|
| Text input (any type) | `<TextInput />` |
| Multiline text | `<Textarea />` |
| Dropdown select | `<FormSelect />` |
| Searchable / long dropdown | `<SearchableSelect />` |
| Amount / currency input | `<AmountInput />` |
| Search bar | `<SearchInput />` |
| Label + input + error wrapper | `<FormField />` (when using custom inputs) |
| Radio buttons | `<RadioGroup />` |
| Checkbox | `<Checkbox />` |
| Button | `<Button />` |
| Modal / dialog | `<Modal />` |
| Confirmation dialog | `<ConfirmActionModal />` |
| Tab navigation | `<Tabs />` |
| Page header (title + actions) | `<PageHeader />` |
| Crowded header on small screens (date + several buttons + refresh) | `<PageHeaderMobileTools />` — below `md`: `PageRefreshButton` `iconOnly` + kebab → bottom sheet; `md+`: `desktop` slot only. Put `DateFilterBar` with `triggerLayout="blockCenter"` in the sheet when the pill would crowd. Optional `mobileLeading` (e.g. live indicator). See `apps/web/app/components/ui/page-header-mobile-tools.tsx`. |
| Search row + inline selects that crowd on mobile | `<ToolbarFiltersCollapsible />` — below `breakpoint` (default `md`): full-width **Filters** button above `searchRow`; filter controls in a sheet with **Done**. At `breakpoint+`: one row (`searchRow` + `desktopInlineFilters`). Optional `badgeCount`. See `apps/web/app/components/ui/toolbar-filters-collapsible.tsx`. |
| Stat card (KPI) | `<StatCard />` from `card.tsx` |
| Card / panel surface | `<Card />`, `<CardHeader />`, `<CardBody />`, `<CardFooter />` |
| Financial P&L rows | `<StatRow />`, `<StatRowGroup />` |
| List tables (default — incl. loader refetch overlay, mobile card rows) | `<CompactTable />` |
| Compact dense table for detail / tabbed views (typed columns, action column, optional `pagination`, `selection`, `renderMobileCard`, `footer`) | `<CompactTable />` |
| Table/list URL refetch (blur overlay; keep stale rows mounted) | `<TableLoadingOverlay show={…} />` with `useLoaderRefetchBusy()` (`apps/web/app/hooks/use-loader-refetch-busy.ts`) — `navigation.state === 'loading'`, same-pathname guard on by default; additive with `<NavProgressBar />` |
| CompactTable while loader refetches (no row swap) | `<CompactTable loading loadingVariant="overlay" />` — default `loadingVariant` is `replace` |
| Row actions: mobile kebab → slide-up sheet (reuse with `CompactTable` action column) | `<TableRowActionsSheet />` (`apps/web/app/components/ui/table-row-actions-sheet.tsx`) |
| Empty list state | `<EmptyState />` |
| Pagination | `<Pagination />` |
| Status badge (generic) | `<StatusBadge />` |
| Order status badge | `<OrderStatusBadge />` |
| User role chip | `<RoleBadge role={role} />` (consistent dept-color palette across the app — never hand-roll `badge-info` for roles) |
| Order ID + copy button | `<OrderIdBadge />` (renders truncated ID + click-to-copy of the full UUID; pass `linkTo` to wrap as a link, `uppercase`/`ellipsis=""` to match existing variants) |
| ₦ price display | `<NairaPrice />` |
| Filter pills / toggle group | `<FilterPills />` |
| Key/value detail rows | `<DescriptionList />` |
| Breadcrumb trail | `<Breadcrumb />` |
| Collapsible section | `<Collapsible />` |
| Accordion | `<Accordion />` |
| Toast notifications | `<ToastProvider />` + `useToast()` |
| File upload | `<FileUpload />` |
| Date range filter | `<DateFilterBar />` |
| Dropdown actions menu | `<ActionDropdown />` |
| **In-table action button (View / Edit / Approve / Remove etc.)** | `<TableActionButton variant="primary | neutral | danger" />` — locked variant rule, see "Table Action Buttons (Non-Negotiable)" |
| Loading spinner | `<Spinner />` |
| Global page-loading indicator | `<NavProgressBar />` (mounted once per layout — do not add per-page) |

### When a new component IS needed
If you need a UI pattern that isn't in the list above **and** it will appear in 2+ places:
1. Create the component in `apps/web/app/components/ui/`
2. Add it to the table above in this CLAUDE.md
3. Use it immediately in all places it's needed

### Never do this
- Raw `<input className="border rounded...">` — use `<TextInput />`
- Raw `<select className="...">` — use `<FormSelect />`
- Inline `₦{value.toLocaleString()}` — use `<NairaPrice />`
- Manual `<div className="flex justify-between"><span>Label</span><span>Value</span></div>` rows — use `<StatRow />`
- Manual empty state divs with dashed borders — use `<EmptyState />`
- Manual pagination controls — use `<Pagination />`

---

## Table Action Buttons (Non-Negotiable)

In-table action columns must use the shared `<TableActionButton>` component at [apps/web/app/components/ui/table-action-button.tsx](apps/web/app/components/ui/table-action-button.tsx) — never `<Button size="sm">` (the 2px `btn-*` border + `btn-sm` padding inflates row height past the text-only cells in the same row, breaking the compact table density the CEO has explicitly asked for).

### Variant rule

| Variant | Color | Use for |
|---|---|---|
| `primary` | Brand blue | The row's main affordance — `View`, `Open`, `Edit`, `Approve`, `Confirm`. **When a row has only one action button, it must always be `primary`** so the cell has clear weight. |
| `neutral` | Muted grey | Secondary actions paired with a `primary` (e.g. `Add stock` next to `View`). Quieter visual rank. |
| `danger` | Red | Destructive / negative actions: `Remove`, `Delete`, `Cancel`, `Reject`, `Dispute`, `Deactivate`, `Archive`. |

### Examples

```tsx
// One action → primary
<TableActionButton to={`/admin/orders/${o.id}`} variant="primary">View</TableActionButton>

// Two actions: View + Edit → primary + neutral
<TableActionButton to={`/admin/products/${p.id}`} variant="primary">View</TableActionButton>
<TableActionButton onClick={() => setEditing(p)} variant="neutral">Edit</TableActionButton>

// View + destructive Remove → primary + danger
<TableActionButton to={`/admin/inventory/${l.id}`} variant="primary">View</TableActionButton>
<TableActionButton onClick={() => openAdjust(l, 'decrease')} variant="danger">Remove</TableActionButton>

// Three actions: View (primary) + Add (neutral) + Remove (danger)
<TableActionButton to={`/admin/inventory/${l.id}`} variant="primary">View</TableActionButton>
<TableActionButton onClick={() => openAdjust(l, 'increase')} variant="neutral">Add</TableActionButton>
<TableActionButton onClick={() => openAdjust(l, 'decrease')} variant="danger">Remove</TableActionButton>

// Optimistic-row View placeholder — non-interactive but styled as primary at 50% opacity
<TableActionButton inert variant="primary">View</TableActionButton>
```

### Sizing — locked

The component renders at:
- `border` (1px), `px-2 py-0.5`, `text-xs font-medium leading-none`
- Total button height ≈ 22px → fits inside the table's `py-3` cell padding without forcing the row to grow
- Renders as `<button>` (default), `<Link>` (when `to` is set), or `<span aria-disabled>` (when `inert: true`) via a discriminated union

### Do NOT

- Do NOT use `<Button size="sm" variant="primary|secondary|ghost">` in table action columns — those have a 2px border + `px-3 py-1.5` that pushes row height taller than text-only cells.
- Do NOT add `text-xs`, `text-sm`, or `border-0` className overrides — `<TableActionButton>` already sets the right typography and border weight; overriding breaks the across-the-app uniformity.
- Do NOT colour the View button neutral when it's the row's only action — it must be `primary` so the cell reads as actionable. The single-action-blue rule is the visual contract users read; breaking it makes some rows look disabled.
- Do NOT wrap a View `<Link>` in `<Button>` chrome — pass `to` directly to `<TableActionButton>`; the component handles the Link↔button switch internally.

---

## Modal + Optimistic UI Pattern (Non-Negotiable)

Every modal-form-driven list page in the app follows this pattern. CEO directive: when a user submits a modal form, the new/edited row appears in the table **immediately**, and the modal closes the **same React tick** the success toast appears. No 100–500 ms lag while the loader revalidates.

### The five ingredients

1. **Optimistic ADD** — derive synthetic rows from `fetcher.formData` (the in-flight payload) and prepend them to the loader-data list. Use `useOptimisticListMerge<T>(fetcher, build)` from [apps/web/app/hooks/useOptimisticListMerge.ts](apps/web/app/hooks/useOptimisticListMerge.ts). Synthetic IDs come from `optimisticId(suffix?)` in [apps/web/app/lib/optimistic.ts](apps/web/app/lib/optimistic.ts) so consumers can detect them later.
2. **Optimistic EDIT** — when the form submission contains the new field values for an existing row (text edits, status flips), overlay them on the matching server row by `id`. Use `useOptimisticListPatches<T>(fetcher, build)` + `applyOptimisticPatches(rows, patches)` + `isOptimisticPatched(patches, id)` from [apps/web/app/hooks/useOptimisticListPatches.ts](apps/web/app/hooks/useOptimisticListPatches.ts). Patched rows keep their REAL id (no `__optimistic_` prefix) so action buttons remain meaningful — disable them via `isOptimisticPatched(...)` while in flight.
3. **Edge-trigger close** — close the modal the instant `fetcher.data` flips to `{ success: true }` (NOT when `fetcher.state === 'idle'`). Use `useCloseOnFetcherSuccess(fetcher, onSuccess)` from [apps/web/app/hooks/useCloseOnFetcherSuccess.ts](apps/web/app/hooks/useCloseOnFetcherSuccess.ts).
4. **Toast on the same tick** — keep the existing `useFetcherToast(fetcher.data, ...)` import. All three hooks watch `fetcher.data` reference, so the toast appears and the modal closes together with no lag.
5. **Visual marker on in-flight rows** — render with `opacity-60` + an inline "Saving…" chip, and `disabled={isOptimistic}` on row action buttons (View / Edit / Delete on a synthetic ID would 404 the API; on a patched id it would race against the in-flight write). Detect via `isOptimisticId(row.id)` (adds) or `isOptimisticPatched(patches, row.id)` (edits).

### Canonical reference

[apps/web/app/features/logistics/LogisticsPage.tsx](apps/web/app/features/logistics/LogisticsPage.tsx) is the reference implementation. New modal+list pages should copy its shape; existing pages migrate onto the shared hooks rather than hand-rolling a fourth variant.

### Wired example — ADD

```tsx
import { useFetcher } from '@remix-run/react';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useOptimisticListMerge } from '~/hooks/useOptimisticListMerge';
import { isOptimisticId, optimisticId } from '~/lib/optimistic';
import { useFetcherToast } from '~/components/ui/toast';

const fetcher = useFetcher();
useFetcherToast(fetcher.data, { successMessage: 'Widget created' });

const optimisticWidgets = useOptimisticListMerge<Widget>(fetcher, (fd, intent) => {
  if (intent !== 'createWidget') return null;
  const name = fd.get('name')?.toString().trim();
  if (!name) return null;
  return [{ id: optimisticId(), name, status: 'ACTIVE', createdAt: new Date().toISOString() }];
});

useCloseOnFetcherSuccess(fetcher, () => setShowAdd(false));

const display = [...optimisticWidgets, ...widgets];
// …in the row: className={isOptimisticId(w.id) ? 'opacity-60' : ''}
```

### Wired example — EDIT (text or status overlay)

```tsx
import {
  applyOptimisticPatches,
  isOptimisticPatched,
  useOptimisticListPatches,
} from '~/hooks/useOptimisticListPatches';

const widgetPatches = useOptimisticListPatches<Widget>(fetcher, (fd, intent) => {
  if (intent === 'updateWidget') {
    const id = fd.get('widgetId')?.toString();
    if (!id) return null;
    return [{ id, patch: { name: fd.get('name')?.toString() ?? '', status: fd.get('status')?.toString() ?? '' } }];
  }
  if (intent === 'approveWidget') {
    const id = fd.get('widgetId')?.toString();
    if (!id) return null;
    return [{ id, patch: { status: 'APPROVED' } }];   // status badge flips instantly
  }
  return null;
});

const display = applyOptimisticPatches(widgets, widgetPatches);
// …in the row: className={isOptimisticPatched(widgetPatches, row.id) ? 'opacity-60' : ''}
// …on action buttons: disabled={isOptimisticPatched(widgetPatches, row.id)}
```

If the server rejects the patch, the row visibly snaps back to its server state and `useFetcherToast` surfaces the error — that UX is correct: the user knows their change didn't take.

### Do NOT

- Do NOT trigger close from a derived boolean (`useEffect([actionSuccess])`). The boolean stays `true` across consecutive submits, React skips the effect on submission #2, and the modal stays open. **The reference comparison inside `useCloseOnFetcherSuccess` is exactly what avoids this**.
- Do NOT wait for `fetcher.state === 'idle'`. The post-action loader revalidation holds state at `'loading'` for 100–500 ms; the modal lingers visibly after the toast.
- Do NOT close the modal in the form's `onSubmit` handler. It closes BEFORE the action validates, hiding server errors. We tried it; reverted.
- Do NOT close the modal imperatively from the action route callback. Actions return data, they don't own client UI state.
- Do NOT skip the `__optimistic` ID prefix on optimistic ADD rows. Action buttons (View / Edit / Delete) on a synthetic ID would 404 against the API.
- Do NOT add the `__optimistic_` prefix on optimistic EDIT rows. They keep their REAL id so action buttons stay meaningful (a stale-form race during the in-flight window is prevented by `disabled={isOptimisticPatched(...)}`, not by changing the id).
- Do NOT detect optimistic-edit by deep-equality of fields against the canonical row. Trust the `patches` array — that's the canonical "is this row mid-flight" signal. Field-equality detection misses cases where the patch matches the existing value (e.g. clicking Approve on a row already locally APPROVED in another tab).
- Do NOT reuse one fetcher across two unrelated modals without the `intent` discriminator. Returning `null` from `build` for non-matching intents in `useOptimisticListMerge` / `useOptimisticListPatches` is the canonical way to scope per-modal/per-intent.
- Do NOT hand-roll new variants of close-on-success / optimistic-list-merge / optimistic-list-patches. Use the hooks. New variants always reintroduce one of the bugs above.
- Do NOT use `applyOptimisticPatches` to deep-merge nested objects. The helper is shallow merge by design — if a patch needs to update a nested object, the caller spreads inside `patch` (e.g. `{ recipientInfo: { ...row.recipientInfo, name: newName } }`). Deep-merging silently masks bugs where a partial nested update overwrites unrelated sibling fields.

---

## Code Quality Standards

### TypeScript Strictness
- `strict: true` in all tsconfig files
- No `any` type. Ever. Use `unknown` and narrow with Zod validation
- All API inputs validated with Zod schemas (defined in packages/shared)
- All API outputs typed through tRPC inference

### File Naming and Structure
- Domain-Driven Design: each module (orders, inventory, logistics, marketing, finance, hr) has its own folder with routes/, services/, schemas/, and validators/
- NestJS: one module per domain. Services contain business logic. Controllers are thin (just call services and return)
- Remix: one route file per page. Loaders fetch data. Actions handle mutations. Components render UI. No business logic in components

### Error Handling
- All database operations wrapped in try/catch with meaningful error messages
- All tRPC procedures use Zod input validation — invalid requests fail at the schema level before hitting business logic
- Edge Worker implements graceful degradation — never show a user a 500 error. Buffer the order and show "Order received, processing shortly"

### Testing Requirements
- Every state transition in the Order Lifecycle must have an integration test
- Every permission boundary (RLS) must have a test proving unauthorized access is blocked
- Every edge case documented in the PRD must have a corresponding test case

---

## Multi-Branch Architecture

### Branch Context in Every Write
Every write operation now sets TWO session variables before any mutation:
```sql
SET LOCAL yannis.current_user_id = '<user_uuid>';
SET LOCAL yannis.current_branch_id = '<branch_uuid>';
```
NestJS services must pass `branchId` alongside `actorId` in every write context. RLS policies on branch-scoped tables filter by `current_setting('yannis.current_branch_id', true)`.

### Branch-Scoped Tables
These tables carry `branch_id` and are filtered by RLS: `orders`, `campaigns`, `marketing_funding`, `ad_spend_logs`, `inventory_levels`, `commission_plans`, `payout_records`, `logistics_locations`, `message_templates`, `outbound_messages`, `order_timeline_events`.

**Products and `stock_batches` are NOT branch-scoped** — global catalog. Sellable units are tracked in `inventory_levels` per `location_id` (logistics location), not via a `branch_id` column on that table; branch visibility still flows from session + RLS on branch-scoped domain tables (e.g. `orders.branch_id`).

### SuperAdmin / Global Finance Bypass
SuperAdmin and global Finance bypass branch RLS entirely. Their session `current_branch_id` is set to `NULL` and RLS policies treat NULL as "show all branches".

### Org-wide department heads (CS, Marketing, Logistics)
`HEAD_OF_CS`, `HEAD_OF_MARKETING`, and `HEAD_OF_LOGISTICS` are **org-wide singletons** (at most one `ACTIVE` holder per role for the whole org — migration `0080_org_wide_department_heads.sql`). They use the same session pattern as admin-class: `canViewAllBranches` is true, so **`currentBranchId` is `NULL`** on login. They see and act across all branches for their domain (orders, marketing, logistics, payroll batch prep, mirror targets). **Mutations** that require branch context still use explicit `branchId` in the payload (see `requireBranchScopeForGlobalAdminMutations` in `apps/api/src/trpc/trpc.ts` and `BranchScopeGuardProvider` on the web). **Branch team supervisors** remain branch-scoped (`branch_teams`); they do not replace org-wide heads.

### Branch Switcher Session
If a user belongs to multiple branches, the active branch is stored in their Redis session as `currentBranchId`. The sidebar shows a branch selector. Switching branch calls `auth.switchBranch(branchId)` which updates the Redis session.

### New Module: `branches/`
- NestJS: `apps/api/src/branches/` — service, controller, module
- tRPC: `apps/api/src/trpc/routers/branches.router.ts`
- Schema: `packages/shared/src/db/schema/branches.ts`

---

## What NOT To Do

- Do NOT use localStorage or sessionStorage for anything security-sensitive. Sessions live in Redis
- Do NOT expose raw **customer** phone numbers in any API response, log, or error message — ever. The Lead Fortress pillar applies to `orders.customer_phone`, `cart_submissions.phone`, and any other PII column tied to leads. **Staff** phone numbers (`users.phone`) are different: they are contact info for HR/admins/heads to reach their team. The mask helper in `apps/api/src/users/users.service.ts::resolveStaffPhone` returns the raw phone to authorized viewers (self, admin-class, HR, heads viewing their direct-report role; or anyone with `users.read` / `hr.read` permission) and the masked form to other authenticated users — do not blanket-mask `users.phone`.
- Do NOT use auto-incrementing IDs — use UUIDv7
- Do NOT declare PKs or FKs / actor pointers (`*_id`, `created_by`, `approved_by`, etc.) as PostgreSQL **`text`** or Drizzle **`text('…')`** — use native **`uuid`** / Drizzle **`uuid('…')`** (see **Native `uuid` columns — identifiers are never `text`** above)
- Do NOT skip the actor injection (`SET LOCAL yannis.current_user_id` AND `SET LOCAL yannis.current_branch_id`) on any write operation
- Do NOT allow state skipping in the order lifecycle — enforce the state machine
- Do NOT use TypeORM — use Drizzle. TypeORM reflection-based types are unreliable for this level of data integrity
- Do NOT hardcode commission rules — they must be dynamic JSONB configs editable by HR
- Do NOT build a separate mobile app or a separate rider app — use PWA route groups within `apps/web` with offline sync
- Do NOT store files locally — use Cloudflare R2 or S3 for all uploads (receipts, screenshots, invoices)
- Do NOT implement the audit trail at the application level — it must be at the PostgreSQL trigger level using temporal tables
- Do NOT use `String()` or `.toFixed(2)` for Drizzle inserts into `numeric` columns — use `sql\`${value}::numeric\`` to avoid trigger type errors
- Do NOT alter a main table without syncing its `*_history` table in the same migration (ADD/DROP columns)
- Do NOT create a new business-data table without a `branch_id` column (exception: products, stock_batches — global catalog)
- Do NOT allow CS agents to initiate order transfers between themselves — only HoCS and SuperAdmin can reassign orders
- Do NOT bypass or reorder the **order ↔ inventory** gates: `InventoryService.assertGlobalAvailabilityForOrder` on `CONFIRMED`, `assertLocationCanFulfillOrder` on `ALLOCATED`, then `reserveForAllocateWithMovements` and `completeDeliveryInventory` in side effects. Do NOT read `logistics_location_id` from a stale pre-update order row in `executeTransitionSideEffects` — pass the post-update order + metadata. Locked spec: `CLAUDE.md` → "When Building the Inventory Module" → "Order ↔ shelf integrity".
- Do NOT shrink `inventory.verifyTransfer` in `packages/shared/scripts/seed-permissions.ts` to **only** `TPL_MANAGER` — `HEAD_OF_LOGISTICS` and `STOCK_MANAGER` must retain verify when partners are off-platform; re-run `pnpm db:seed-permissions` after edits.
- Do NOT change the **confirm call-gate overrides** (admin-class via `isAdminLevel`, same-branch `BRANCH_ADMIN`, org-wide `HEAD_OF_CS` any-call-on-order) without updating **both** `apps/api/src/orders/orders.service.ts::validateTransitionGates` **and** `apps/web/app/features/orders/OrderDetailPage.tsx` in the same change — server and UI must stay aligned.
- Do NOT send raw phone numbers via SMS or WhatsApp — always route through the platform bridge
- Do NOT write `order_timeline_events` rows outside of the same database transaction as the triggering mutation — timeline events must be atomic with their state change
- Do NOT render the Mirror View with any interactive action buttons — it is read-only, always
- Do NOT bypass the `blockMutationsWhileMirroring` tRPC middleware on any new router. Mirror Mode read-only enforcement lives at the root middleware so individual services don't have to know about it; if you ever build a non-tRPC mutation endpoint (REST controller, webhook handler, raw fetch handler), you MUST add `if (ctx.user?.mirroredBy) throw FORBIDDEN` before any write. See `apps/api/src/trpc/trpc.ts` for the canonical pattern.
- Do NOT change `canMirror()` permission rules without a CEO directive. The matrix (SuperAdmin → anyone, org-wide Heads → their direct-report role set **without** same-branch requirement, branch supervisors → supervised users on the active branch, HR → nobody) is locked. If product asks to expand it, write a new memory entry first.
- Do NOT delete `mirror_sessions` rows. The audit trail is permanent — even when a session ends, the row stays with `ended_at` stamped. Closed rows are how we answer "who looked through whose account, and when."
- Do NOT let admin clicks during Mirror Mode mutate the target user's data — including soft-mutations like "mark notification as read", `lastActionAt` updates, `agent:state_update` socket broadcasts, push-ack receipts, or any client-side optimistic UI that pretends a write happened. Mirror Mode is **strictly view-only**. Implementation:
  - Server: `blockMutationsWhileMirroring` middleware (already in place) rejects every tRPC mutation.
  - Client: `NotificationsStateProvider` accepts a `readOnly` flag (set from `user.mirroredBy` in `DashboardLayout`); both `markAsRead` and `markAllReadFn` no-op when it's true.
  - Socket: `useAgentStateBroadcast` checks `<html data-mirror="1">` before emitting and skips when set. `DashboardLayout` writes that attribute when mirroring.
  - When adding a NEW client-side side-effect helper (e.g. "mark seen", "track view", "ping recently active"), check `document.documentElement.dataset.mirror === '1'` first and bail. The flag is the canonical "we are pretending; touch nothing" signal.
- Do NOT fire a Web Push without first inserting the in-app notification row — push is always the mirror layer, not a standalone channel
- Do NOT send push from an automation EVENT rule outside the triggering service method's transaction — inline check only
- Do NOT delete a `push_delivery_log` row on failure — mark as `FAILED` and use resend flow
- Do NOT apply app theme changes only on the client — always sync to server via `users.updateMyAppTheme` so the preference survives session restoration
- Do NOT inline theme script AFTER stylesheets — it must be the first `<script>` in `<head>` to prevent flash of wrong theme
- Do NOT inline `user.role === 'SUPER_ADMIN'` when granting admin-class privilege — use `isAdminLevel(user)` from `apps/api/src/common/authz.ts` (backend) or `apps/web/app/lib/rbac.ts` (frontend). Inline literal checks silently lock `ADMIN` users out.
- Do NOT create a user with role `SUPER_ADMIN` through any path other than the public `/auth/setup` endpoint. `createStaff` rejects it; the enum exists only to persist the initial singleton. If you need to transfer ownership, implement an explicit transfer mutation — do not reuse `createStaff` or `update`.
- Do NOT let an `ADMIN` directly create or deactivate another `ADMIN`/`SUPER_ADMIN`. The service layer (`users.service.ts`) funnels such attempts through the `permission_requests` approval flow so the SuperAdmin retains unique authority over who holds admin-level access. Do not add shortcut code paths around this.
- Do NOT set `font-size` directly on any element when you mean "scale the app" — the root font-size is controlled by `applyFontScale()` / the inline boot script and every Tailwind utility is rem-based. Per-element `font-size` will break the scale.
- Do NOT change the default dispatch mode from `manual` without an explicit product decision. CEO wants HoCS in full control of distribution; `manual` is the default and must be listed first in the Settings UI.
- Do NOT let CS mark orders as `COMPLETED`. COMPLETED is the accountant's signal that remittance was received + reconciled. CS's last action in the lifecycle is `DELIVERED`.
- The `deliveryNote` and `deliveryProofUrl` fields on CS/HoLogistics Mark Delivered are both optional (CEO directive 2026-04-24 reversed the prior "min 10 chars note" mandatory rule). If they supply either, persist it; never block the transition on them. Do NOT reintroduce the length gate without a new CEO directive.
- Do NOT attempt to pre-fill a WhatsApp **group** invite link with `?text=` — WhatsApp ignores it for groups. Only `wa.me/<number>` links support pre-fill. The Share-to-3PL flow intentionally copies to clipboard + opens the group; do not try to "fix" this with a deep-link.
- Do NOT use `message_channel = 'WHATSAPP'` for 3PL dispatch messages. `WHATSAPP` is customer-facing DMs; use `WHATSAPP_GROUP` for 3PL coordination so outbound_messages analytics stay meaningful.
- Do NOT add placeholders to templates outside `ALLOWED_TEMPLATE_PLACEHOLDERS` in `messaging.router.ts`. Unknown placeholders are rejected at template save time; adding them elsewhere will silently pass through unrendered.
- Do NOT generalize the Finance "hat" pattern into a generic multi-role system. Finance is intentionally the ONLY role that can be layered on top of a primary role — the CEO asked for this specifically to cover absent-accountant scenarios. Adding other hats duplicates the complexity of multi-role auth without the use case to justify it.
- Do NOT set `users.is_finance_officer = true` on more than one user in a single statement. The atomic-swap in `UsersService` clears the current holder before setting the new one; bypassing it will hit the `users_only_one_finance_officer` unique index.
- Do NOT write `user.role === 'FINANCE_OFFICER'` as a standalone finance-access check. Use `hasFinanceAccess(user)` from [apps/api/src/common/utils/strip-finance-fields.ts](apps/api/src/common/utils/strip-finance-fields.ts) so both the primary role AND the Finance hat are honoured.
- Do NOT move the Finance hat silently. The new holder and the displaced holder must each receive an `account:finance_hat_assigned` / `account:finance_hat_revoked` notification via `notifyFinanceHatChange()`. Skipping the notification breaks the audit expectation CEO set when approving this feature.
- Do NOT serve the heavy CEO Executive Overview on `/admin` for SuperAdmin/Admin. The landing page is intentionally lightweight (`dashboard.quickOverview`); the full report lives at `/admin/ceo` and is reached via the card on the landing. Reverting to "show everything on /admin" reintroduces the slow-first-paint problem flagged 2026-04-23.
- Do NOT query a materialized view without applying the user's date filter to it. Every cost line in `getFastProfitReport` must be scoped by `startDate`/`endDate` (via `spend_date`, `period_month`, `delivery_date`, etc.). An unfiltered MV query silently returns all-time totals and corrupts the CEO dashboard.
- Do NOT set the audit actor with `this.pgClient\`SELECT set_config('yannis.current_user_id', ..., true)\``. It runs outside any drizzle transaction and the setting dies before the next `this.db.*` call — writes get attributed to "System" in the audit trail. Always use `withActor(this.db, actor, async (tx) => { ... })` from `apps/api/src/common/db/with-actor.ts` and route every write through `tx`, never `this.db`, inside the callback. See the "Actor Injection Pattern" section for the full rationale.
- Do NOT remove `HR_MANAGER` from the `HEAD_ROLES` tuples in `users.service.ts` or the frontend equivalents. CEO directive 2026-04-23: HR follows **one per branch** (`ACTIVE`/`PENDING` on `primary_branch_id`). The three department heads are **org-wide** singletons (migration `0080` + service); do not collapse HR into the org-wide head indexes.
- Do NOT let HR approve payroll batches one payout at a time. The unit of HR review is the **batch** (`payroll_batches`) — `approveBatch` / `rejectBatch` move the whole `(branch, dept, month)` slot together so the audit trail tells one coherent story per stage. Per-payout APIs (`hr.approvePayout`, `hr.generatePayouts`) still exist for legacy DRAFT rows, but new flows must use the batch lifecycle.
- Do NOT bypass `withActorAndBranch()` on payroll batch writes. Every batch insert/update/transition must run inside that wrapper so both `yannis.current_user_id` AND `yannis.current_branch_id` are set on the same pinned connection — RLS on branch-scoped child tables (and audit attribution on `payroll_batches_history`) depend on it. See "Actor Injection Pattern".
- Do NOT regenerate a non-DRAFT payroll batch. `generateBatch` rejects any slot already in `PENDING_HR` / `PENDING_FINANCE` / `PAID` with `CONFLICT`. To revise a submitted batch, the reviewer must first `rejectBatch` it (sends back to `DRAFT`), then the head re-generates and re-submits.
- Do NOT add new departments or change the `DEPARTMENT_ROLES` mapping in `payroll-batch.service.ts` without updating both the table in CLAUDE.md → "When Building the HR and Payroll Module" → "Department → owning Head mapping" AND the corresponding `DEPT_OWNER_ROLE` map in [apps/web/app/features/hr/MonthlyPayrolls.tsx](apps/web/app/features/hr/MonthlyPayrolls.tsx). The frontend mirrors the backend mapping for UX-side action gating; drift breaks the Generate button visibility and the per-batch action permissions.
- Do NOT reintroduce Weekly / Bi-Weekly cadences to the settlement config UI. CEO directive 2026-04-26: payroll runs monthly, period. The enum values stay in the DB for legacy rows but the form must always submit `MONTHLY`. If product asks for sub-month cadences, write a new memory entry first.
- Do NOT collapse `/hr/payroll` and `/hr/plans` back into one tabbed page. They are intentionally split: Monthly Payrolls (the workflow heads + HR + Finance live in) is one page; Commission Plans (the rule-config tool heads + HR own) is another. Same role gating, different concerns. CEO directive 2026-04-26.
- Do NOT inline `permissionProcedure('hr.write')` on the commission plan tRPC procedures. Heads of Department need to create + edit plans for their own dept's roles without holding the org-wide `hr.write` permission — the service layer (`HrService.createCommissionPlan` / `updateCommissionPlan` / `listCommissionPlans`) is the canonical gate via `getManageableRolesForViewer`. If you tighten the procedure to `permissionProcedure(...)`, every Head loses access silently.
- Do NOT skip the "edit-against-existing-role" check in `updateCommissionPlan`. Reading the existing plan's role and verifying it's in the actor's `manageable` set is what stops a Head from taking over a plan in another department by knowing its planId. The check looks redundant alongside `createCommissionPlan`'s gate but covers a different attack surface.
- Do NOT hand-roll close-on-success effects on submit-driven modals. **Use the shared hooks** documented in `## Modal + Optimistic UI Pattern (Non-Negotiable)` above (`useCloseOnFetcherSuccess`, `useOptimisticListMerge`, `useOptimisticListPatches`, `applyOptimisticPatches`, `isOptimisticId`, `isOptimisticPatched`). The `MonthlyPayrolls.tsx` `generateInFlightRef` + `fetcher.state === 'idle'` variant is **superseded** by the shared hooks — it waits for loader revalidation and lags the close 100–500 ms behind the toast. Two non-negotiables carry over from the old directive: server errors must still surface inline (the action returns `{ error }`, the page renders it via `PageNotification` and `useFetcherToast` shows the error toast — both keep working unchanged); and modal backdrop dismissal must still be blocked while the request is in flight (the existing `mousedown+mouseup` rule on `<Modal>` already covers this — do not regress to `onSubmit={() => setOpen(false)}`, which closes BEFORE the action validates).
- Do NOT leave the Month picker on the Generate batch modal blank. Always default `<input type="month">` to the current `YYYY-MM` so HoDs in the common case (running this month's payroll) just hit Generate. The default is computed inside a `useMemo([showGenerate])` so the value refreshes if the modal is reopened in a long-lived tab that has crossed midnight on the 1st.
- Do NOT use `LIKE … INCLUDING ALL` to clone a table that has UNIQUE indexes if the clone is meant to hold multiple rows per the unique tuple. INCLUDING ALL copies UNIQUE INDEXES too — and unique indexes are NOT constraints, so the constraint-stripping loop in audit migrations doesn't catch them. Either use `INCLUDING DEFAULTS` (skip indexes) and recreate the lookup indexes you actually want, OR follow up with `DROP INDEX IF EXISTS …_unique_idx` like migration 0068 had to. The `payroll_batches_history` UPDATE-blowup was caused by exactly this oversight.
- Do NOT skip a payout row for a staff member when generating a batch — even if their commission plan is missing or computes to zero. CEO directive 2026-04-26: every active staff member in (branch × dept) MUST appear in the batch with a default-zero payout so HR has a complete roster to review and adjust manually. The previous "if (!computed) continue;" left people invisible in the batch; replace any future similar shortcut with the always-insert default-zero pattern in `payroll-batch.service.ts::generateBatch`.
- Do NOT render a user role as `badge-info` (or any single-color badge). Use `<RoleBadge role={role} />` from [apps/web/app/components/ui/role-badge.tsx](apps/web/app/components/ui/role-badge.tsx) — it picks a consistent department color (red admin / blue CS / amber marketing / green logistics / indigo finance / purple HR) so role chips are scannable across pages. Hand-rolled `badge-info` makes every role look identical and was flagged 2026-04-26 on `/hr/plans`. The component lives in the table at "User role chip" → see "UI Component Reuse Rules".
- Do NOT remove the `successCallbackUrl` field from `formConfigSchema` (or rename it) without updating both [apps/edge-worker/src/index.ts](apps/edge-worker/src/index.ts) (the form's `data-success-callback` attribute + the redirect block in `submitOrder().then()`) AND the form-builder UI in [apps/web/app/features/campaigns/CampaignsPage.tsx](apps/web/app/features/campaigns/CampaignsPage.tsx). The field is OPTIONAL — when missing/empty the form falls back to the inline success message; when set it redirects to the Media Buyer's funnel thank-you page. Paystack `authorizationUrl` always wins over the callback URL so payment flows aren't broken. The validator enforces a full http(s) URL — partial paths are rejected.
- Do NOT render the `<DateFilterBar />` bare on a page. Always wrap it in the standard pill chrome: `<div className="flex items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1 shrink-0">` so the filter has visual presence. Bare it renders as a tiny text-xs button that disappears into toolbars (this was the bug on `/admin/cs/orders` flagged 2026-04-26).
- Do NOT bypass the bulk-assign `intent` on the CS queue when an HoCS picks multiple unassigned cards. The `bulkAssignToCS` intent in [apps/web/app/routes/admin.cs.queue/route.tsx](apps/web/app/routes/admin.cs.queue/route.tsx) calls `orders.bulkAssignToCS` (the existing tRPC procedure). The card UI uses a Set-based selection state and a separate fetcher; do NOT collapse it into the legacy single-`assign` intent loop because the bulk procedure is atomic + emits one Socket.io event, while looping single-assign produces N events and N retry windows.
- Do NOT close `<Modal>` on a bare `onClick` of the backdrop. iOS dismisses native pickers (`<input type="date">`, native `<select>`) by firing a phantom click that bubbles to the backdrop and would dismiss the modal mid-interaction — losing whatever the user was about to submit. The `Modal` component in [apps/web/app/components/ui/modal.tsx](apps/web/app/components/ui/modal.tsx) only closes when `mousedown` AND `mouseup` both land on the backdrop itself (`e.target === e.currentTarget`). Do not revert to `onClick={onClose}`, do not add a separate `onClick={onClose}` on the inner content, and do not stop-propagation on the inner pane — the press-start-and-end check covers all the cases. Modals must NEVER auto-close while the user is still working on the form inside them; the only paths to close are the explicit Done/Save/Cancel buttons, the X icon, the Escape key, or a clean tap on the backdrop.
- Every filterable page must show a loading indicator while the loader re-runs after a filter / sort / search / pagination change. The `<NavProgressBar />` component in [apps/web/app/components/ui/nav-progress-bar.tsx](apps/web/app/components/ui/nav-progress-bar.tsx) is mounted once at the top of each layout (`DashboardLayout`, `TplLayout`, `rider/route.tsx`) and listens to Remix `useNavigation()` — it ramps a thin brand-coloured bar at the top of the viewport for ANY non-idle navigation (route change, search-param update, fetcher action) and fades out when the loader resolves. New pages do NOT need to wire `useNavigation` themselves to indicate loading — the global bar covers it. Do NOT remove `<NavProgressBar />` from the layouts; do NOT pass non-Promise values to `<DeferredSection>`/`<Await>` and rely on this bar instead — `<Await>` requires a Promise and will throw if given a sync value. Per-page inline spinners next to specific filter controls are still allowed but no longer required.

---

## Performance Benchmarks (Target)

| Metric | Target |
|---|---|
| Edge Form Load | < 400ms |
| VOIP Connection Latency | < 1.5 seconds |
| Dashboard Data Refresh (Socket.io) | < 60 seconds staleness |
| Customer Profile Search (CS) | < 3 seconds |
| Profit/Loss Report Generation | < 3 seconds for 100k records (use Materialized Views) |
| Order State Transition (API) | < 500ms |
| Offline Sync (Rider PWA) | Auto-sync within 30 seconds of network recovery |
| Admin landing (`/admin`) for SuperAdmin/Admin | < 200ms (single `dashboard.quickOverview` call, no MVs) |
| Executive Overview (`/admin/ceo`) | < 2s cold, < 500ms cached (60s Redis cache + 15-min MV refresh) |

---

## Dashboard architecture (2026-04-23)

Two-page split for admin-level users so landing on `/admin` stays fast:

- **`/admin`** — lightweight "quick overview" for SuperAdmin and Admin. One tRPC call (`dashboard.quickOverview`), renders today's status counts, active orders, pending approvals, and prominent jumps to the rest of the app. No materialized views, no profit aggregation, no charts. Built in `apps/web/app/features/dashboard/AdminQuickDashboard.tsx`. All non-admin roles continue to use the role-specific dashboards (CS, Finance, Marketing, etc.) at the same route.
- **`/admin/ceo`** — full Executive Overview. Heavy (profit report via materialized views, time series, pipeline charts, media buyer / CS leaderboards, branch breakdown). 60-second Redis cache keyed on branch + date range. Always linked from `/admin` via a prominent "Executive Overview" card. Served by `dashboard.ceoOverview` + `dashboard.ceoOverviewTimeSeries` + `dashboard.orderPipelineChart` + `dashboard.ceoBranchBreakdown`.

**Materialized view refresh:** `FinanceService.refreshMaterializedViewsCron()` fires every 15 minutes via `@Cron('0 */15 * * * *')`. Without this, `mv_profit_summary` / `mv_ad_spend_summary` / `mv_commission_summary` / `mv_order_pipeline` drift out of sync with live data and the Executive Overview shows stale numbers. Do NOT remove the cron without replacing it (e.g. post-commit hooks, streaming CDC).

**Fast-path filter pitfall:** `FinanceService.getFastProfitReport` reads from materialized views. Every cost category must apply the user's date filter to the MV — ad spend uses `spend_date`, commission uses `period_month` (bucketed by `DATE_TRUNC('month', period_start)`). An earlier bug ignored the date filter for commission, inflating CEO dashboard numbers to all-time totals. Full audit of MV queries lives in `apps/api/src/finance/finance.service.ts::getFastProfitReport`.

---

## Current Implementation Status (March 2026)

The system is **97%+ complete**. All 7 core modules are fully built with backend services, tRPC routers, and frontend dashboards.

### What Is Built
- **22 NestJS modules** (auth, orders, finance, hr, inventory, logistics, marketing, products, voip, payments, cart, settings, notifications, events, audit, users, permission-requests, permissions, database, common, trpc, branches)
- **19 tRPC routers** (audit, branches, cart, dashboard, finance, health, hr, inventory, logistics, marketing, notifications, orders, permission-requests, product-categories, products, settings, users, voip + root index)
- **65+ Remix routes** across admin, auth, hr, rider, tpl, payment route groups
- **32 feature modules** in `apps/web/app/features/`
- **20 schema files** and **16 validator files** in `packages/shared`
- **55 SQL migrations** including temporal triggers, RLS, history tables, push notification tables, multi-branch schema
- **7 Playwright E2E specs** covering all critical user flows
- **CI/CD pipeline** (.github/workflows/ci.yml + deploy-dev.yml)
- **3 documentation guides** (Developer Guide, Runbook, ADRs)

### What Remains (Infrastructure Only)
- Task 6.1: Multi-CDN DNS Failover (requires DNS provider setup)
- Task 6.3: Load Testing (requires production-scale data)
- Edge Worker KV namespace provisioning (Cloudflare account setup)
- Twilio credential configuration (works in mock mode without)

### Phase 8 — Feature Batch 2 (COMPLETE as of March 2026)
- **Task 8.x: Order Lifecycle Timeline** ✅ — `order_timeline_events` table, `writeTimelineEvent()` helper, `orders.getTimeline` tRPC, `OrderTimeline` UI component
- **Task 9.x: Multi-Branch Architecture** ✅ — `branches` + `user_branches` schema, RLS updates with `yannis.current_branch_id`, branch session context, branch switcher UI, cross-branch reporting, `BRANCH_ADMIN` role
- **Task 10.1: Remove Agent Order Transfer** ✅ — `order_transfer_requests` table + procedures + UI removed
- **Task 11.x: CS Communication Panel** ✅ — `message_templates` + `outbound_messages` schema, `messaging.service.ts`, template management UI, unified call/SMS/WhatsApp comms panel
- **Task 12.x: Supervisor Mirror View** ✅ — `agent:state_update` Socket.io broadcasting, mirror view backend/UI, Team Live View, "Being Observed" indicator for agents
- **Task 13.x: Claim-Based Dispatch Mode** ✅ — `claimOrder()` with atomic Redis/Postgres lock, claim cap enforcement, Claim Queue UI, dispatch mode config in system settings

### Phase 14 — Push Notification Center (COMPLETE as of March 2026)
All 4 layers of the push system are fully operational:

**Schema (4 new tables):**
- `push_subscriptions` — browser VAPID device tokens per user
- `push_broadcasts` — admin-triggered audience broadcasts (branch-scoped optional)
- `push_automation_rules` — CRON/EVENT-based rules (temporal, toggleable, branch-scoped)
- `push_delivery_log` — per-attempt delivery tracking with SENT/SHOWN/CLICKED/FAILED status

**Backend:**
- `NotificationsService` extended with 20+ push methods: `savePushSubscription`, `sendPush`, `broadcastPush`, `fireAutomationRule`, `ackPush`, `resendPush`, `getDeliveryLog`, etc.
- `PushSchedulerService` (`apps/api/src/notifications/push-scheduler.service.ts`) — dynamic CRON job registry using `SchedulerRegistry`; loads all active CRON rules on module init, registers/unregisters jobs on toggle
- `PushController` (`apps/api/src/notifications/push.controller.ts`) — public `POST /push/ack` endpoint (no auth required, called from service worker); validates `logId`, updates `shown_at`/`clicked_at`
- Role-scoped broadcast enforcement: HoCS→CS_AGENT only, HoM→MEDIA_BUYER only, SuperAdmin→all

**Frontend:**
- `usePushSubscription()` hook — browser push register/unsubscribe, VAPID key conversion, calls `notifications.savePushSubscription` tRPC
- `PushPermissionModal` — non-dismissible blocking modal when push permission not granted (iOS gate)
- `IosInstallBanner` — educates iOS users to add PWA to home screen (required for lock-screen push on iOS 16.4+); dismisses up to 3× per session
- Notification panels: `NotificationsBroadcastPanel`, `NotificationsAutomationsPanel`, `NotificationsDeliveryLogPanel` (in `apps/web/app/features/notifications/panels/`)
- `SettingsPushPanel` — push preferences tab in Settings page

**Service Worker (`apps/web/public/sw.js` extended):**
- `push` event: always calls `showNotification()` even when app is open; POSTs `/push/ack` with `shown`
- `notificationclick` event: `clients.openWindow(data.url)` + POST `/push/ack` with `clicked`
- Push payload structure: `{ title, body, icon: '/icon-192.png', badge: '/badge-72.png', data: { url, logId }, tag }`

**Routes:**
- `/admin/notifications` — tabbed notification center (broadcast / automations / log)
- `/admin/notifications/broadcast`, `/admin/notifications/automations`, `/admin/notifications/log` — redirect helpers to tabs
- `/push/ack` — public service worker ack endpoint

### Phase 14 Supplement — Per-User App Theme (COMPLETE)
- 6 themes supported: system, light, dark, dim, ink, soft
- `users.app_theme` column (nullable — null follows org default from `system_settings.client_ui_config`)
- `migration 0055_users_app_theme.sql` adds column to `users` + `users_history`
- `theme.ts` library: `APP_THEMES`, `applyAppTheme()`, `persistAndApplyTheme()`, `getThemeBootScript()` (before-paint inline script to prevent flash)
- `useAppTheme()` hook: manage state + localStorage + server sync via `users.updateMyAppTheme`
- `useServerAppThemeSync.ts` hook: initial sync of server preference to client
- Boot script inlined in `root.tsx` before `<style>` to apply theme before first paint
- Legacy theme migration: `'neutral'` → `'dim'`, `'contrast'` → `'light'` on read
- `trpc-browser.ts` — browser-callable tRPC without session: `fetchClientConfig()`, `postUpdateMyAppTheme()`

### Additional Modules Beyond Original PRD
- **Payments module** (`apps/api/src/payments/`) — Paystack integration for online payments
- **Cart module** (`apps/api/src/cart/`) — Shopping cart for edge form orders
- **TPL dashboard** (`apps/web/app/routes/tpl.*`) — Dedicated 3PL partner portal with inventory, orders, remittances, notifications, settings
- **Delivery remittances** — 3PL delivery fee tracking and settlement
- **Delivery confirmation requests** — OTP/GPS verification system
- **Branches module** (`apps/api/src/branches/`) — Multi-branch management, user-branch assignments, switcher
- **Push Notification Center** — Full VAPID send path, automation rules engine, delivery log, service worker ack

---

## When In Doubt

1. Check the PRD.md for the exact requirement
2. Check the TASK.md for the current sprint priority
3. If the PRD does not cover it, ask — do not assume
4. If you are choosing between fast but fragile and slower but auditable — always choose auditable
5. Every feature you build should answer: "If the CEO asks who did this and when, can the system answer in under 3 seconds?"
6. **After implementing** order lifecycle, inventory, CS gates, or RBAC/permission matrix changes that alter documented behavior, **update this `CLAUDE.md` in the same PR** (and run `pnpm db:seed-permissions` when `seed-permissions.ts` changes). The directive is the locked contract — drifting code without doc updates is how regressions ship.