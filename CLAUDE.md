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
├── apps/web/          # Remix PWA (150+ routes, 30 feature modules, ~90 shared UI components)
├── apps/api/          # NestJS (22 business modules, 23 tRPC routers)
├── apps/edge-worker/  # Cloudflare Worker (form + circuit breaker)
├── packages/shared/   # Drizzle schema, Zod validators, enums (~151 migrations, latest 0151)
├── packages/ui/       # Shared Tailwind components
└── packages/config/   # ESLint, TS, Tailwind configs
```

Rider dashboard lives in `apps/web` at `/rider/` (not a separate app). Local development does not require Docker — Postgres 18 + Redis can be reached via remote connection strings in `.env`.

### Current State Snapshot (2026-05-23)
All 7 phases complete + Phase 8 (Feature Batch 2), Phase 14/14b (Push + App Theme) complete. Phase 16 (Perf/Scalability) and Phase 22 (Round-Trip Latency) queued. Live infra drift to resolve: prod Cloud SQL still in `europe-north2` (rebuild → `europe-west2` Private IP + HA, import into Terraform). Detailed build history lives in MEMORY.md — don't duplicate it here.

### Deployment Standard (Locked)

- **Dev deploy is provider-selectable via adapters.** `DEPLOY_PLATFORM=aws` or `DEPLOY_PLATFORM=gcp` deploys to that provider only. When `DEPLOY_PLATFORM` is **unset or empty**, both providers deploy in parallel.
- **Shared runtime contract is the source of truth.** Both providers must satisfy the same single-VM Dockerized `web` + `api` shape, health checks, migration flow, and runtime env contract.
- **Redis stays external** for dev deploys. Do **not** reintroduce VM-local Redis unless explicitly approved.
- **Ingress is Cloudflare Proxy (orange cloud) → nginx on the VM → web:3000 / api:4444.** Cloudflare DNS proxies, nginx terminates the second TLS leg with Let's Encrypt certs, certbot renews via HTTP-01 on port 80 (CF passes :80 through). No Cloudflare Tunnel involved.
- **Cloudflare SSL mode is `Full (strict)` zone-wide.** Anything looser is a downgrade — browser sees HTTPS but CF→VM goes plaintext (Flexible) or accepts a self-signed origin (Full).
- **nginx must trust Cloudflare's edge IPs** via `/etc/nginx/conf.d/cloudflare-real-ip.conf` (Ansible-managed) — sets `set_real_ip_from <CF-ranges>` + `real_ip_header CF-Connecting-IP`. Without it, every CF-proxied request looks like it came from a CF edge IP → rate limiter, audit logs, and fraud signals all break.
- **Edge worker remains on Cloudflare** at `form.hqyannis.com` (prod) / `dev-form.hqyannis.com` (dev).
- **Object storage is provider-selectable via adapters** (`gcs` / `s3`). New asset keys must stay **environment-prefixed** and **resource-scoped** (for example `dev/marketing/screenshots/...`, `dev/finance/receipts/...`, `dev/logistics/delivery-proof/...`, `dev/hr/onboarding-docs/...`, `dev/products/...`).
- **New dev infrastructure uses `dev-*` naming** inside the selected provider so the same Terraform shape can be mirrored later for prod.
- **Provider adapters must not drift from the shared contract.** Keep provider differences isolated to infra, deploy scripts, and object-storage adapters.

Local dev still does **not** require Docker — Postgres 18 + Redis can be reached via remote connection strings in `.env`.

### GCP Prod Infrastructure (Locked)

- **Prod app VM is `e2-standard-4`** (4 vCPU / 16 GB), zone `europe-west2-a`. `e2-small` is **dev-only** — 2 GB RAM starves the `web` + `api` + nginx + Docker stack (swap → multi-second latency; shared-core CPU throttles). Never set the prod `machine_type` to a shared-core type (`e2-small/medium`). Lives in `infrastructure/terraform/gcp/terraform.tfvars.prod`.
- **Prod VM Terraform carries `allow_stopping_for_update = true`** (so a `machine_type` resize can apply instead of erroring) **and `deletion_protection = true`** (via the `vm_deletion_protection` var). Do not regress either.
- **The whole app tier lives in `europe-west2`** — VM, Artifact Registry, Secret Manager. **Cloud SQL MUST be co-located in `europe-west2`.** A cross-region DB adds ~25ms per query round-trip; every N+1 page pays it N times.
- **Cloud SQL connectivity standard:** Private IP (same VPC as the VM) + High Availability (regional, not zonal) + public IP **disabled**. If public IP is ever enabled, Authorized Networks must be locked to the VM IP — never `0.0.0.0/0`.
- **Cloud SQL must be managed in Terraform** (`google_sql_database_instance`). Never hand-create cloud resources in the console — the prod DB was created by hand and that is exactly how an undetected region drift happened.
- **Cloud SQL region is immutable.** "Moving" regions = new instance + data migration (cross-region read replica → promote is the low-downtime path) + repoint `DATABASE_URL` in the `prod-yannis-runtime-env` secret + API restart. Private IP and HA are in-place edits — bundle them into the same rebuild.
- **Don't downsize the DB blind.** Right-size only *after* the app VM is correctly sized and Query Insights shows a week of real load.
- **Outstanding prod drift (as of 2026-05-21, to fix):** Cloud SQL `yannis-eose-prod` is still in `europe-north2` (Stockholm), still public-IP / zonal, and still not in Terraform. Pending migration: rebuild in `europe-west2` with Private IP + HA, import into Terraform, verify Authorized Networks.

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
- `{UNPROCESSED,CS_ASSIGNED,CS_ENGAGED} → CANCELLED`: HoCS / Branch Admin (same branch) / Admin/SuperAdmin only — CS closers can NOT cancel (CEO directive 2026-05-20). Mandatory reason ≥10 chars.
- `CANCELLED → UNPROCESSED`: restore — Admin/SuperAdmin only. Cancelled orders are never deleted; they surface in the **Deleted** tab (`status=CANCELLED` filter on the orders list, all roles). Restore clears the closer assignment + lock so the order re-enters the pool.

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
- Never let CS closers cancel orders — HoCS / Branch Admin (same branch) / Admin only
- Never delete a cancelled order from the DB — it lives in the "Deleted" tab; only Admin/SuperAdmin restore it to UNPROCESSED
- Never let CS closers transfer orders — HoCS/SuperAdmin only via Hot Swap
- Never bypass order↔inventory gates (assertGlobalAvailability → assertLocationCanFulfill → reserveForAllocate → completeDelivery)
- Never deduct source stock on PENDING transfer — only on approveTransfer

### Security & PII
- Never expose raw customer phone numbers in any response/log
- Never use localStorage/sessionStorage for security-sensitive data
- Never send raw phones via SMS/WhatsApp — platform bridge only
- Never fire push without inserting in-app notification row first

### Secret Hygiene & Dev/Prod Isolation (Locked)
**Hard isolation between dev and prod is mandatory** — sharing any of the below between envs caused a confirmed auth-bleed bug (logged in as a dev SuperAdmin against prod). Per env, unique values for:
- `REDIS_URL` — sessions, cache, rate-limit counters, Socket.io adapter all share one keyspace
- `SESSION_SECRET` + `SESSION_BUNDLE_SECRET` — HMAC signature validates cross-env if shared
- `DATABASE_URL` — obvious, but worth stating
- `EDGE_API_KEY` — API↔worker inventory-update auth; shared key = privilege escalation across envs

`SESSION_COOKIE_DOMAIN=.hqyannis.com` is only safe **once the four above are isolated** — otherwise the parent-domain cookie carries dev sessions into prod via shared Redis.

**Secret storage map** — wrangler secrets and GCP Secret Manager are separate stores; nothing reads both:
| Secret | Used by | Lives in |
|---|---|---|
| `REDIS_URL`, `SESSION_*`, `DATABASE_URL`, `VAPID_*`, `SENDGRID_API_KEY`, etc. | NestJS API container | GCP Secret Manager `prod-yannis-runtime-env` (refresh-env script reads on boot) |
| `QSTASH_URL`, `QSTASH_TOKEN`, `TURNSTILE_SECRET_KEY` | Cloudflare edge worker only | `wrangler secret put ... --env production` |
| `EDGE_API_KEY` | API (sends header) + worker (verifies) | **Both** — same value in GCP Secret Manager AND wrangler secrets |

### Edge Worker Safety Net (QStash) — Required on Prod
- `QSTASH_URL` + `QSTASH_TOKEN` **MUST** be set as wrangler secrets on the prod edge worker. Without them, `bufferToQStash()` silently returns false and PayOnDelivery orders are LOST during any API outage (this is Pillar 1's last line of defense — see `apps/edge-worker/src/index.ts:626-650`).
- PayOnline orders are **not** buffered — payment flows can't be naively replayed. Edge worker tells the user to retry on API 5xx.
- Verify after any worker secret rotation:
  ```
  pnpm --filter @yannis/edge-worker exec wrangler secret list --env production
  ```
- Tokens accidentally pasted into chats/logs MUST be rotated in the Upstash console + re-pushed via `wrangler secret put`.

### First SuperAdmin Bootstrap (`/auth/setup`)
- Fresh prod DB has no users. First visitor to `/auth` lands on the setup flow (loader probes `/auth/setup-status`) and can mint the first SUPER_ADMIN.
- After that, `/auth/setup` is a no-op — additional SuperAdmins must be promoted by an existing SuperAdmin from the admin UI.
- **Do not lose the first SuperAdmin credentials before adding a second.** No back-channel recovery.
- After first SuperAdmin exists, restart the API once so `MessageTemplateSeedService` picks up the new actor and seeds default templates.

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

- **Attribution vs servicing — two columns (migration 0150):** `orders.branch_id` is the **marketing branch** — the campaign/form (funnel / media-buyer) branch. Set once at creation, **never changes**. `orders.servicing_branch_id` is the **CS servicing branch** — resolved from CS routing rules (`cs_order_routing_rules` / `cs_order_routing_rule_targets`, `servicing_branch_id` per target; optional `team_id` narrows to a CS squad, or null for the whole-branch CS_CLOSER pool) at creation, falling back to the marketing branch when no rule matches. **CS routing must NEVER overwrite `branch_id`** — doing so was the confirmed cross-branch leak fixed in 0150.
- **Branch scoping is split by surface:** Marketing surfaces (MB dashboard / HoM / Team Analysis / Marketing P&L) scope orders by `branch_id`. CS / Sales / Logistics / Finance surfaces scope by `servicing_branch_id`. `orders.list` / `getStatusCounts` / `getOrdersTimeSeriesByCreated` take `branchScope: 'marketing' | 'servicing'` (`'servicing'` default; HoM and marketing pages pass `'marketing'`). Socket `cs-all` / `logistics` rooms are scoped by `servicing_branch_id`; `marketing-all` by `branch_id`.
- **`orders.list` (CS_CLOSER):** assigned-queue views use `(orders.servicing_branch_id = session branch OR orders.assigned_cs_id = viewer)` so orders serviced by another branch still appear when assigned to the closer.
- **Media Buyer branch lens:** a Media Buyer's header branch switcher is a personal **read-only data lens**, not just an operational scope. It always offers **"All Branches"** + the buyer's **data-footprint branches** (current memberships ∪ every branch their own orders/campaigns are attributed to — incl. branches they were removed from). `branches.list` / `listBranchesForUser` build that footprint; `AuthService.switchBranch` (and the tRPC `branches.switchBranch`) validate against it. `orderListBranchIdOwnerAware` + `ordersPageBundle` scope an MB's orders by `currentBranchId` (`null` = All Branches → all their orders); the always-applied `media_buyer_id = self` filter keeps every branch exact. **Writes stay branch-isolated:** the `blockMediaBuyerMutationsOutsideMemberBranch` tRPC middleware rejects any branch-scoped mutation while an MB's `currentBranchId` is `null` or a non-member branch — they must switch back to a member branch to create forms / ad spend / funding.
- **`moveOrdersToBranch` (HoCS/Admin inter-branch routing)** updates `servicing_branch_id` only — marketing attribution (`branch_id` + media-buyer credit) is preserved.
- **Forms follow the media buyer (migration 0150):** when a user is removed from a branch, their `campaigns` (sales forms) attributed to that branch are auto-set to `DEACTIVATED` (in `UsersService.updateStaff`). A parked DEACTIVATED form resurfaces in `listCampaigns` under the owner's **primary** branch; reactivating it (`updateCampaign` status → `ACTIVE`) re-stamps `campaign.branch_id` to that primary branch. Past orders keep their original `branch_id`.
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

## Strategic TODOs

### AI CEO Assistant (proposed, not yet scoped)
Conversational analytics surface for CEO / Heads — natural-language questions over the DB ("net profit this month by branch?", "worst-performing media buyer this week?").

- **Approach:** Tool-calling agent over existing tRPC read procedures (`dashboard.ceoOverview`, `finance.*`, `marketing.teamAnalysis`, etc.) — NOT raw text-to-SQL. Reuses RBAC, branch scoping, FIFO COGS, and Pillar 2 phone masking already enforced by the procedures.
- **Why not text-to-SQL:** RLS is inert (API connects as table owner), temporal/branch joins are hallucination-prone, customer phone leakage into prompts would breach Pillar 2. Keep SQL escape hatch as a later phase against a hardened read replica.
- **Model:** Anthropic SDK (Sonnet 4.6 default, Opus 4.7 for hard analysis) with prompt caching on the system prompt + tool schema.
- **Cost:** ~$0.01–0.03 per question with caching → ~$10–50/month at expected CEO volume. Not a budget concern.
- **Perf:** Zero impact on app — calls go to Anthropic API. DB load = same as a CEO clicking through `/admin/ceo`. Guardrails: cap tool calls per turn (e.g., 8), 10s timeout per tool call.
- **Non-negotiables:** PII scrub before any prompt leaves the VM (no raw phones / addresses); every Q+tool-call+answer logged for audit (Pillar 4); SUPER_ADMIN/Heads only at v1.
- **Status:** Idea phase. Needs a scoped tool list (8–10 procedures), prompt design, chat UI on `/admin/ceo`, and audit table before any code.

---

## When In Doubt

1. Check `prd.md` for the requirement
2. Check `task.md` for sprint priority
3. Check `.claude/docs/` for module-specific specs
4. If choosing fast-but-fragile vs slower-but-auditable — always choose auditable
5. "If the CEO asks who did this and when, can the system answer in 3 seconds?"
6. After changing order lifecycle, inventory, CS gates, or RBAC — update this file in the same PR
