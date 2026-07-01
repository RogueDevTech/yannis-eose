# CLAUDE.md — Yannis EOSE

Senior engineer building an ERP/sales platform (Remix + NestJS + tRPC + Drizzle + PostgreSQL 18 + Redis). Module specs in `.claude/docs/`.

## 4 Pillars
1. **Revenue Insurance** — sales forms never go offline (edge worker + QStash buffer)
2. **Lead Fortress** — raw customer phones NEVER in browser/API responses for unauthorized roles
3. **Financial Truth** — FIFO landed COGS; true profit = revenue minus all costs
4. **Absolute Accountability** — every mutation in temporal audit tables; `withActor()` on every write

## Stack & Structure
```
apps/web/       Remix PWA + Tailwind
apps/api/       NestJS + tRPC
apps/edge-worker/ Cloudflare Worker
packages/shared/  Drizzle schema, Zod validators, enums
```
Local dev: no Docker needed — Postgres + Redis via `.env` connection strings.

## Database Rules
- UUIDv7 for all PKs. Never UUIDv4 or auto-increment.
- `uuid` columns for identifiers — never `text`.
- Every write: `withActor(this.db, actor, async (tx) => {...})`. Never bare `pgClient.set_config`.
- Numeric inserts: `sql\`${value}::numeric\``. Never `String()` or `.toFixed(2)`.
- Altering a table → sync its `*_history` table in the same migration.
- Migrations auto-run on boot. RBAC catalog auto-seeds + auto-restamps user snapshots on boot.

## Order Lifecycle
```
UNPROCESSED → CS_ASSIGNED → CS_ENGAGED → CONFIRMED → AGENT_ASSIGNED → DISPATCHED → IN_TRANSIT → DELIVERED → REMITTED
```
No state skipping. CANCELLED is legacy-only — use DELETED. CS never marks REMITTED (accountant only).

## RBAC
- `SUPER_ADMIN` + `SUPPORT` bypass `permissionProcedure`. `ADMIN` has all codes via snapshot.
- Use `isAdminLevel(user)` — never `role === 'SUPER_ADMIN'`.
- Use `hasFinanceAccess(user)` — never `role === 'FINANCE_OFFICER'`.
- Exports: use per-domain export permission codes, never role checks.
- Finance hat is singleton. Heads are org-wide, multiple holders allowed.

## Multi-Branch
- `orders.branch_id` = marketing branch (never changes). `orders.servicing_branch_id` = CS branch.
- Marketing surfaces scope by `branch_id`. CS/Sales/Logistics/Finance scope by `servicing_branch_id`.
- `withActorAndBranch(this.db, actor, ...)` for branch-scoped writes.

## Companies
- `companies` table = company boundary. Group branches into companies for data isolation.
- `branches.company_id` FK → `companies.id`.
- Products, system settings, commissions get `company_id`. No cross-company sharing.
- SuperAdmin sees company-level switcher in header; everyone else sees branches as today.
- **Data isolation via `effectiveBranchIds`**: every list/aggregate query MUST pass `ctx.effectiveBranchIds` alongside `branchId`. When a company is selected, `effectiveBranchIds` = all branch IDs in that company.
- `getUsersService().list(input, actor, branchId, effectiveBranchIds)` — always pass 4th arg.
- `getOrdersService().list(input, branchId, { ...opts, effectiveBranchIds })` — in options.
- Cart, marketing, finance services all accept `effectiveBranchIds` — never omit it.
- Common bug: page bundles calling service methods without `effectiveBranchIds` → shows data from all companies.

## UI Rules
- Shared components in `apps/web/app/components/ui/`. If used 2+ places, extract.
- Key components: `<PageHeader backTo>`, `<CompactTable>`, `<Modal>`, `<StatusBadge>`, `<RoleBadge>`, `<TableActionButton>`, `<EmptyState>`, `<Pagination>`, `<SearchInput>`, `<FormSelect>`, `<SearchableSelect>`, `<FileUpload>`, `<DateFilterBar chrome="pill">`, `<PageHeaderMobileTools>`, `<ToolbarFiltersCollapsible>`, `<OverviewStatStrip>`.
- Never `<Button size="sm">` in tables — use `<TableActionButton>`.
- Never hand-roll optimistic UI — use `useOptimisticListMerge`, `useOptimisticListPatches`, `useCloseOnFetcherSuccess`, `useFetcherToast`.
- Never close modal in onSubmit. Close on `fetcher.data.success === true` via `useCloseOnFetcherSuccess`.
- Mobile-first: `mobileInlineActions` on PageHeader, concise descriptions, dense cards.
- Mobile list cards: entire card is a tappable `<Link>` (navigable detail) or `<button>` (peek modal). Never use kebab/action-sheet as the primary mobile card interaction. Desktop rows keep `<TableRowActionsSheet>` in an actions column.
- Peek pattern: for non-navigable lists (audit, batch items), tap card opens detail modal. For navigable lists (orders, batches), tap card navigates to the detail page.

## Data Loading
- `defer({ shell, pageData })` + `<CachedAwait>` + `cachedClientLoader` for read-mostly lists.
- Page bundles (single tRPC call) for pages with >3 data needs. Never revert to N parallel `apiRequest()`.
- `Promise.all` for independent fetches. Never waterfalls.

## Stock Transfers (CEO 2026-05-25)
- Stock Manager + HoL + Admin: transfers go straight to RECEIVED (no approval).
- TPL Manager: transfers go to PENDING → Stock Manager/HoL approves → RECEIVED.
- `approveTransfer` also goes straight to RECEIVED (deducts source + adds destination in one tx).

## Critical Do NOTs
- Never expose raw customer phones in any response/log
- Never skip actor injection — `withActor()` always
- Never use TypeORM — Drizzle only
- Never skip order lifecycle states
- Never `await` notification fan-out on hot paths — use `enqueueCreate*`
- Never commit `READ_THROUGH_CACHE_ENABLED=false`
- Never add cache without invalidation helper
- Never revert PageBundle to N parallel calls
- Never regress Postgres pool config (max:30, idle:300s, warmup)

## Git Workflow
- Default push target is `dev` branch. When the user says "push" or "push to GitHub", push to `dev`.
- Always create PRs against `dev`, never `main`.
- Never push directly to `main`.

## Infra
- Prod: GCP `europe-west2`, `e2-standard-4` VM. Cloud SQL must be same region.
- Ingress: Cloudflare Proxy → nginx → web:3000 / api:4444. SSL Full (strict).
- Dev/prod secret isolation is mandatory (REDIS_URL, SESSION_SECRET, DATABASE_URL, EDGE_API_KEY).
- Edge worker QStash tokens must be set on prod (Pillar 1 last line of defense).

## When In Doubt
1. Read `.claude/docs/` for the module spec
2. Choose auditable over fast-but-fragile
3. "Can the system answer who did this and when in 3 seconds?"
