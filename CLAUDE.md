# CLAUDE.md — Yannis EOSE Agent Directive

## Identity & Context

You are a senior software engineer building **Yannis EOSE** (Enterprise Operations & Sales Engine) — a high-integrity ERP and sales platform for a performance marketing company. This is a **revenue protection system** that replaces a legacy tool called "Sniper" which failed under scale. Every decision must honor what users loved (smooth UX, granular data, automations) and fix what broke (concurrency, audit trails, stock audits, financials).

**Detailed module specs are in `.claude/docs/`** — read those files when working on a specific module.

---

## The 4 Non-Negotiable Pillars

### Pillar 1: Revenue Insurance (Zero-Downtime)
Sales forms NEVER go offline. Edge-first submission (Cloudflare Workers), circuit breaker (QStash/Durable Objects), PWA offline sync. Zero lost sales.

### Pillar 2: Lead Fortress (Anti-Theft)
Customer phone numbers NEVER exposed in browser DOM, network tab, console, or API responses to unauthorized roles. All comms via VOIP bridges. Agents never see raw numbers.

### Pillar 3: Financial Truth (Landed COGS)
True profit = Revenue - (Factory + Freight/Duty + 3PL Fee + Delivery Fee + Ad Spend + Commission). FIFO batch costing. CEO sees **real net cash profit**.

### Pillar 4: Absolute Accountability (Temporal Audit)
Every mutation logged at the **database level** via PostgreSQL 18 System-Versioned Temporal Tables. Actor + action + old/new values + timestamp. Immutable. `SET LOCAL yannis.current_user_id` before every write.

---

## Tech Stack (Locked)

| Layer | Technology |
|---|---|
| Frontend | Remix (React) + Tailwind CSS |
| PWA | Service Workers + Web Push |
| Backend | NestJS + TypeScript 5.x |
| Type Contract | tRPC (internal), OpenAPI (external) |
| Database | PostgreSQL 18 (temporal, UUIDv7) |
| ORM | Drizzle ORM |
| Cache/Sessions | Redis |
| Real-time | Socket.io |
| Edge/CDN | Cloudflare Workers |
| Queue | Upstash QStash / CF Durable Objects |
| VOIP | Twilio / MessageBird (WebRTC) |
| Storage | Provider-selectable object storage (GCS / S3) |

---

## Architecture

Decoupled monorepo (TurboRepo + pnpm). Frontend (Remix) and backend (NestJS) communicate via tRPC. Shared types in `packages/shared`.

```
yannis-eose/
├── apps/web/          # Remix PWA (65+ routes)
├── apps/api/          # NestJS (22 modules, 19 tRPC routers)
├── apps/edge-worker/  # Cloudflare Worker (form + circuit breaker)
├── packages/shared/   # Drizzle schema, Zod validators, enums
├── packages/ui/       # Shared Tailwind components
└── packages/config/   # ESLint, TS, Tailwind configs
```

Rider dashboard lives in `apps/web` at `/rider/` (not a separate app). Local development does not require Docker — Postgres 18 + Redis can be reached via remote connection strings in `.env`.

### Deployment Standard (Locked)

- **Dev deploy is provider-selectable via adapters.** `DEPLOY_PLATFORM=aws` or `DEPLOY_PLATFORM=gcp` deploys to that provider only. When `DEPLOY_PLATFORM` is **unset or empty**, both providers deploy in parallel.
- **Shared runtime contract is the source of truth.** Both providers must satisfy the same single-VM Dockerized `web` + `api` shape, health checks, migration flow, and runtime env contract.
- **Redis stays external** for dev deploys. Do **not** reintroduce VM-local Redis unless explicitly approved.
- **Ingress is Cloudflare DNS + Cloudflare Tunnel.** Do **not** add nginx back onto the VM for the normalized dev baseline.
- **Edge worker remains on Cloudflare.**
- **Object storage is provider-selectable via adapters** (`gcs` / `s3`). New asset keys must stay **environment-prefixed** and **resource-scoped** (for example `dev/marketing/screenshots/...`, `dev/finance/receipts/...`, `dev/logistics/delivery-proof/...`, `dev/hr/onboarding-docs/...`, `dev/products/...`).
- **New dev infrastructure uses `dev-*` naming** inside the selected provider so the same Terraform shape can be mirrored later for prod.
- **Provider adapters must not drift from the shared contract.** Keep provider differences isolated to infra, deploy scripts, and object-storage adapters.

Local dev still does **not** require Docker — Postgres 18 + Redis can be reached via remote connection strings in `.env`.

---

## Database Principles

### Runbook
- **SQL migrations** auto-run on API boot (`MigrationRunnerService`). Failure aborts startup.
- **RBAC permission catalog** auto-seeds on boot (`PermissionSeedService`).
- **Permission backfill** (one-shot): `pnpm --filter @yannis/api run run-permission-backfill:standalone -- --force`
- After catalog changes: `pnpm --filter @yannis/shared db:seed-permissions` then backfill.

### Core Rules
- **UUIDv7** for all PKs. Never auto-increment or UUIDv4.
- **Native `uuid` columns** — identifiers are NEVER `text`. Use Drizzle `uuid('col')` / `uuidv7Pk()`.
- **Temporal Tables** — every business-data table is system-versioned with `valid_period` tstzrange.
- **RLS** — permissions enforced at DB level. Media Buyers see own orders only. CS see assigned only.
- **Actor Injection** — every write uses `withActor(this.db, actor, async (tx) => { ... })` from `apps/api/src/common/db/with-actor.ts`. Never bare `pgClient.set_config` — it runs outside the tx and the setting dies before the write. See `.claude/docs/module-cs-edge-marketing.md` for the full rationale.
- **Numeric columns** — use `sql\`${value}::numeric\`` for Drizzle inserts. Never `String()` or `.toFixed(2)`.
- **History table sync** — when altering a main table, sync `*_history` in the same migration.

### Server Caching + Pool
See `.claude/docs/server-caching-pool.md` for full details. Key rules:
- Redis read-through cache via `CacheService.getOrSet()`. Every cache wrapper needs a matching `invalidateXxxCache()`.
- Do NOT commit `READ_THROUGH_CACHE_ENABLED=false` to any deployable env.
- Postgres pool: `max: 30`, `idle_timeout: 300s`, `max_lifetime: 1800s`, eager warmup. Do not regress.
- Page bundles consolidate 4-14 HTTP calls into 1. Do NOT revert to N parallel `apiRequest()` calls.

---

## The Order Lifecycle

```
UNPROCESSED → CS_ASSIGNED → CS_ENGAGED → CONFIRMED → AGENT_ASSIGNED → DISPATCHED → IN_TRANSIT → DELIVERED → REMITTED
       |            |              |
       |            |              PARTIALLY_DELIVERED / RETURNED → RESTOCKED / WRITTEN_OFF
       |            CANCELLED
       CANCELLED
```

**Hard rules:** No state skipping. Every transition needs an authenticated actor. Every transition logged in temporal audit. UI disables invalid transitions.

**Key transitions:**
- `CS_ENGAGED → CONFIRMED`: requires qualifying call (VOIP ≥15s or manual call log). Admin/BranchAdmin/HoCS override.
- `CONFIRMED → AGENT_ASSIGNED`: 3PL location must have stock. Stock: Reserved → Allocated.
- `AGENT_ASSIGNED/DISPATCHED/IN_TRANSIT → DELIVERED`: Stock deducted, commission triggered. deliveryNote/deliveryProofUrl both optional.
- `DELIVERED → REMITTED`: accountant only (via cash remittance flow). CS NEVER marks REMITTED.

---

## Permission-first RBAC (locked)

- `SUPER_ADMIN` is the ONLY `permissionProcedure` bypass. `ADMIN` goes through standard permission checks (has `ALL_PERMISSION_CODES` via snapshot).
- Effective perms = template ∪ role_permissions ∪ user overrides.
- After catalog changes: `pnpm --filter @yannis/shared db:seed-permissions`
- Use `isAdminLevel(user)` — never inline `role === 'SUPER_ADMIN'`. Backend: `apps/api/src/common/authz.ts`. Frontend: `apps/web/app/lib/rbac.ts`.
- Use `hasFinanceAccess(user)` — never `role === 'FINANCE_OFFICER'` alone. Covers Finance hat.

### Exports — two-key gated
Export codes: `orders.export`, `inventory.export`, `marketing.export`, `finance.export`, `hr.export`, `audit.export`. Server: `ensureExportPermission(user, readPerm, exportPerm)`. Frontend: `canExport` flag in loader. Never gate on inline role checks. MB/CS_CLOSER are opt-in only.

### RBAC Role Matrix

| Role | Scope | COGS? | Full Phone? | Finance? |
|---|---|---|---|---|
| SuperAdmin | All branches | Yes | Audit only | Yes |
| Admin | All branches | Yes | Audit only | Yes |
| Branch Admin | Own branch | No | No | Branch |
| Head of Marketing | Marketing (org-wide) | No | No | No |
| Media Buyer | Own campaigns/orders | No | No | No |
| Head of CS | CS team (org-wide) | No | No | No |
| CS Closer | Own assigned orders | No | Masked | No |
| Finance Officer | All financial data | Yes | No | Yes |
| Head of Logistics | All logistics (org-wide) | No | No | No |
| Logistics/3PL/Stock Mgr | Location-scoped | No | No | No |
| 3PL Rider | Own deliveries | No | Masked | No |
| HR Manager | Staff payouts/commission | No | No | No |

SuperAdmin-only: manage admin-level users, kill admin sessions, transfer SuperAdmin, `/auth/setup`.
Heads are org-wide, multiple holders allowed (CEO 2026-05-03). Finance hat is singleton.

---

## Multi-Branch Architecture

- Every write sets `SET LOCAL yannis.current_user_id` AND `SET LOCAL yannis.current_branch_id`.
- Branch-scoped tables: orders, campaigns, marketing_funding, ad_spend_logs, inventory_levels, commission_plans, payout_records, logistics_locations, message_templates, outbound_messages, order_timeline_events.
- Products/stock_batches are NOT branch-scoped (global catalog).
- SuperAdmin/Finance/org-wide Heads: `currentBranchId = NULL` → see all branches.
- `withActorAndBranch(this.db, actor, ...)` for branch-scoped writes.

---

## UI Component Reuse (Non-Negotiable)

If a pattern appears in 2+ places, it must be a shared component in `apps/web/app/components/ui/`.

| Need | Component |
|---|---|
| Text input | `<TextInput />` |
| Multiline | `<Textarea />` |
| Dropdown | `<FormSelect />` / `<SearchableSelect />` |
| Amount | `<AmountInput />` |
| Search | `<SearchInput />` |
| Form wrapper | `<FormField />` |
| Radio/Checkbox | `<RadioGroup />` / `<Checkbox />` |
| Button | `<Button />` |
| Modal | `<Modal />` / `<ConfirmActionModal />` |
| Tabs | `<Tabs />` |
| Page header | `<PageHeader />` / `<PageHeaderMobileTools />` |
| Filter toolbar | `<ToolbarFiltersCollapsible />` |
| Cards | `<Card />` / `<StatCard />` |
| P&L rows | `<StatRow />` / `<StatRowGroup />` |
| Tables | `<CompactTable />` (with `loading loadingVariant="overlay"` for refetch) |
| Table refetch overlay | `<TableLoadingOverlay />` + `useLoaderRefetchBusy()` |
| Row actions mobile | `<TableRowActionsSheet />` |
| Empty state | `<EmptyState />` |
| Pagination | `<Pagination />` |
| Status badge | `<StatusBadge />` (records) / `<OrderStatusBadge />` / `<CountPill />` (bucket counts only) |
| Role chip | `<RoleBadge role={role} />` — never hand-roll badge-info |
| Order ID | `<OrderIdBadge />` |
| Price | `<NairaPrice />` |
| Filter pills | `<FilterPills />` |
| Key/value | `<DescriptionList />` |
| Breadcrumb | `<Breadcrumb />` |
| Collapsible | `<Collapsible />` / `<Accordion />` |
| Toast | `<ToastProvider />` + `useToast()` |
| File upload | `<FileUpload />` |
| Date filter | `<DateFilterBar />` (always wrap in pill chrome div) |
| Actions menu | `<ActionDropdown />` |
| Table action button | `<TableActionButton variant="primary\|neutral\|danger" />` |
| Loading | `<Spinner />` |
| Page loading | `<NavProgressBar />` (layout-mounted, never per-page) |

### TableActionButton Rules
- `primary`: main action (View, Edit, Approve). **Solo button = always primary.**
- `neutral`: secondary action paired with primary.
- `danger`: destructive (Remove, Delete, Cancel, Reject).
- Never use `<Button size="sm">` in tables — inflates row height.

### Admin Mobile Optimization Standard
- Default to **mobile-first** cleanup for admin surfaces: shorten copy, reduce chrome, and keep dense views readable on small screens.
- Prefer concise page descriptions with no filler punctuation or multi-clause explanations. One short sentence is the default.
- Use `<PageHeader />` with `mobileInlineActions` and collapse mobile actions with `<PageHeaderMobileTools />` instead of hand-rolling mobile button rows.
- Prefer `<PageRefreshButton iconOnly />` on mobile and keep full refresh buttons for desktop only when needed.
- Group date filters, search helpers, and secondary actions inside the same header-tools pattern so the top of the page stays compact.
- Remove redundant inner section headings above tables or lists when the page header, tabs, or overview stats already provide the context.
- On mobile, give primary identifiers more space: names, titles, and key statuses should win over badges, pills, or secondary metrics.
- Reduce mobile padding on leaderboard cards, action rows, and summary blocks when it improves scanability, but do not sacrifice tap targets.
- If horizontal scrolling is necessary for strips or dense controls, make the whole card area scrollable rather than only the inner content.
- Keep collapsible leaderboard/card behavior mobile-only when desktop has room to show the full content by default.
- Mirror visible header and copy changes in loading shells, deferred fallbacks, and skeletons.
- Reuse shared UI primitives already standardized here: `<PageHeader />`, `<PageHeaderMobileTools />`, `<ToolbarFiltersCollapsible />`, `<OverviewStatStrip />`, `<CompactTable />`, `<EmptyState />`, `<NumberInput />`, and other shared inputs before introducing custom mobile variants.

---

## Modal + Optimistic UI Pattern (Non-Negotiable)

Flow: submit → modal stays open → server `{success: true}` → modal closes + synthetic row appears → loader revalidates → real row replaces synthetic.

**5 hooks (use these, never hand-roll):**
1. `useOptimisticListMerge<T>(fetcher, build)` — optimistic ADD (awaitSuccess: true default)
2. `useOptimisticListPatches<T>(fetcher, build)` + `applyOptimisticPatches()` + `isOptimisticPatched()` — optimistic EDIT
3. `useCloseOnFetcherSuccess(fetcher, onSuccess)` — edge-trigger close on `data.success === true`
4. `useFetcherToast(fetcher.data, ...)` — toast on same tick
5. Visual: `opacity-60` + disabled actions on in-flight rows. `isOptimisticId()` for adds, `isOptimisticPatched()` for edits.

**Reference:** `apps/web/app/features/logistics/LogisticsPage.tsx`

**Critical DON'Ts:** Never close modal in onSubmit. Never wait for `fetcher.state === 'idle'`. Never use `useEffect([actionSuccess])` for close. Never skip `__optimistic` prefix on ADD rows. Never add it on EDIT rows.

---

## Frontend Data Loading

- **Deferred shells**: `defer({ shell, pageData })` + `<Suspense fallback={<LoadingShell />}><Await>`. Never blank spinner.
- **No waterfalls**: `Promise.all` for independent fetches.
- **Paginate**: `<CompactTable />` + `<Pagination />` with URL-driven page/limit.
- **Client cache**: `<CachedAwait>` + `cachedClientLoader` for read-mostly lists. Do NOT cache: live socket pages, detail pages with mutations, forms/wizards, rider PWA.
- **NavProgressBar** covers cross-route progress. Never add global route-transition overlay.

---

## Critical Do NOT Rules

### Database & Backend
- Never use `text` for PKs/FKs — use `uuid`
- Never skip actor injection on writes — use `withActor()` / `withActorAndBranch()`
- Never use bare `pgClient.set_config` — always inside the drizzle transaction
- Never use TypeORM — use Drizzle
- Never alter a table without syncing its `*_history` table
- Never create business table without `branch_id` (except products, stock_batches)
- Never `await` notification fan-out on hot paths — use `enqueueCreate*`

### Order Lifecycle
- Never skip states in order lifecycle
- Never let CS mark REMITTED — accountant only
- Never let CS closers transfer orders — HoCS/SuperAdmin only via Hot Swap
- Never bypass order↔inventory gates (assertGlobalAvailability → assertLocationCanFulfill → reserveForAllocate → completeDelivery)
- Never deduct source stock on PENDING transfer — only on approveTransfer

### Security & PII
- Never expose raw customer phone numbers in any response/log
- Never use localStorage/sessionStorage for security-sensitive data
- Never send raw phones via SMS/WhatsApp — platform bridge only
- Never fire push without inserting in-app notification row first

### RBAC
- Never inline `role === 'SUPER_ADMIN'` — use `isAdminLevel(user)`
- Never inline `role === 'FINANCE_OFFICER'` — use `hasFinanceAccess(user)`
- Never gate exports on role checks — use per-domain export permission codes
- Never generalize the Finance hat to other roles

### UI
- Never use `<Button size="sm">` in table action columns — use `<TableActionButton>`
- Never close Modal on bare backdrop onClick (iOS phantom click issue) — mousedown+mouseup check
- Never hand-roll optimistic UI — use the shared hooks
- Never render roles with `badge-info` — use `<RoleBadge>`
- Never use `<CountPill>` for single-record state — use `<StatusBadge>`

### Mirror Mode
- blockMutationsWhileMirroring middleware blocks all tRPC mutations
- Client: check `data-mirror="1"` before any side-effect (notifications, socket, etc.)
- Never delete mirror_sessions rows — permanent audit trail

### Caching
- Never commit `READ_THROUGH_CACHE_ENABLED=false` to deployable env
- Never add cache wrapper without invalidation helper
- Never revert PageBundle back to N parallel apiRequest calls
- Never regress Postgres pool config (max:30, idle:300s, warmup)

### Cross-branch CS routing & branch departments (2026-05)

- **Attribution vs servicing:** `orders.branch_id` remains the funnel / media-buyer branch. CS routing rules (`cs_order_routing_rules` / `cs_order_routing_rule_targets`) pin **servicing** capacity with `servicing_branch_id` per target; optional `team_id` narrows to a CS squad on that branch, or null for the whole-branch CS_CLOSER pool there.
- **`orders.list` (CS_CLOSER):** assigned-queue views use `(orders.branch_id = session branch OR orders.assigned_cs_id = viewer)` so orders attributed to another branch still appear when assigned to the closer.
- **Branch org model:** `branch_departments` holds the fixed Marketing + CS bucket per branch; `branch_department_members` is the **teamless** department roster; `branch_teams` rows are optional squads (`branch_department_id` FK). UI: branch detail tab **Departments · squads** (`admin.branches.$branchId`).

---

## Performance Targets

| Metric | Target |
|---|---|
| Edge Form Load | < 400ms |
| Order State Transition | < 500ms |
| Admin landing (`/admin`) | < 200ms |
| CEO Overview (`/admin/ceo`) | < 2s cold, < 500ms cached |
| P&L Report (100k records) | < 3s (materialized views) |

Dashboard split: `/admin` = lightweight quickOverview. `/admin/ceo` = full Executive Overview with MVs (15-min refresh cron).

---

## Performance Optimization (Playbook)

The dominant cost in this stack is **round-trip latency**, not query speed. Aiven Postgres + GCP VM (`europe-west2`) + Nigerian operators = ~50ms user→VM RTT and ~5–15ms VM→Aiven per query. A page that fires N sequential DB calls feels slow even when every query is fast.

**Optimization order is non-negotiable: measure → collapse round-trips → cache → optimize queries.** Never skip steps. Profiling first is what separates "the app feels faster" from "we shipped complexity for no measurable win."

### Measure first (always)

Before any "make it faster" PR:
1. Chrome DevTools → Network tab → sort by Time. The slowest call is the bottleneck.
2. Performance tab → record a load. Long tasks: network (red), scripting (yellow), rendering (purple).
3. Lighthouse score on the complained-about page. Capture the number before/after.

Paste the slow URL + slowest request into the PR description. No "feels faster" — only numbers.

### Layer 1 — Edge / CDN (do this first, cheapest win)

- **Cloudflare proxy (orange cloud) is REQUIRED for `office.hqyannis.com` and `api-office.hqyannis.com`** in prod. Gives Brotli, HTTP/3, and a Lagos PoP for the TLS terminator. Cloudflare SSL mode must be **Full (strict)**.
- Static asset paths (`/assets/*`, `/build/*`) must return `cf-cache-status: HIT` after first load. Add a Page Rule if not.
- Consider **Argo Smart Routing** ($5/mo) for Africa→EU traffic — typically 20–30% API latency win.
- Edge worker (`form.hqyannis.com`) is already on Cloudflare — keep it there.

### Layer 2 — Round-trip collapse (the real lever)

- **Page bundles are mandatory** for admin pages with >3 data needs. ONE tRPC call returning all sections beats N parallel `apiRequest()` calls. Never regress a PageBundle back to N calls — this is a documented "Critical Do NOT".
- **`defer({ shell, pageData })` for non-critical sections** — stream skeletons immediately, fill in async. Every admin route should use it.
- **`clientLoader` + `CachedAwait` for read-mostly lists** — skips the server roundtrip entirely on cache hit (memory: `feedback_client_loader_pattern.md`).
- **Batch DB lookups** inside a single API request — use `IN (...)` queries or dataloader-style batching, never N+1 loops.

### Layer 3 — Caching (verify these are healthy)

- **Redis read-through cache** via `CacheService.getOrSet()`. Target hit rate >80% on read paths. Every wrapper needs a matching `invalidateXxxCache()`.
- **`READ_THROUGH_CACHE_ENABLED=true`** in every deployable env (never `false`).
- **Materialized views** for CEO Overview / P&L. The 15-min refresh cron MUST be running — verify with `SELECT * FROM cron.job;`. Dead cron = MVs go stale and `/admin/ceo` falls back to live aggregates → multi-second loads.
- **Session bundle cookie** — short-TTL signed snapshot avoids `/auth/me` round-trip on every page.

### Layer 4 — Pool & query (last resort)

- Postgres pool: `max: 30`, `idle_timeout: 300s`, `max_lifetime: 1800s`, eager warmup. Do not regress.
- **PgBouncer** in front of Aiven (Phase 16) — pooled connection reuse cuts handshake cost.
- Slow query? Check `pg_stat_statements`. Add an index only if the query is hot AND a plan inspection shows a seq scan on a large table.
- Never add an index "just in case" — every index slows writes and bloats the table.

### Roadmap reference

- **Phase 22 (Round-Trip Latency Reduction)** — already queued for exactly this complaint. Build order: 22.3 → 22.1 → 22.2 → 22.4 → 22.5 → 22.6.
- **Phase 16 (Performance & Scalability)** — Redis layer audit, PgBouncer, async push via QStash, mat-view audit, k6 load test. Target: 2000+ req/min. Build order: 16.2 → 16.1 → 16.4 → 16.3 → 16.5.

### Critical Do NOTs (performance)

- Never optimize without a profile + number to beat
- Never revert a PageBundle to N parallel `apiRequest()` calls
- Never disable `READ_THROUGH_CACHE_ENABLED` in a deployable env
- Never add a cache wrapper without an invalidation helper
- Never `await` notification fan-out, push send, or analytics writes on a hot path — use `enqueue*` (fire-and-forget into QStash/Redis)
- Never block paint on optional data — defer everything that isn't critical-path
- Never add an index without confirming the query plan needs it
- Never trust "feels faster" — ship with before/after Lighthouse numbers

---

## When In Doubt

1. Check `prd.md` for the requirement
2. Check `task.md` for sprint priority
3. Check `.claude/docs/` for module-specific specs
4. If choosing fast-but-fragile vs slower-but-auditable — always choose auditable
5. "If the CEO asks who did this and when, can the system answer in 3 seconds?"
6. After changing order lifecycle, inventory, CS gates, or RBAC — update this file in the same PR
