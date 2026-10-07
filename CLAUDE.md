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
- Never use em dashes (—) in user-facing text (descriptions, labels, placeholders). Use colons, commas, or separate sentences instead.
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

## Cart Orders Classification (2026-10-05)
- **Duplicate rules are per-company settings, ALL OFF by default (2026-10-07):** Settings > Duplicate rules (`DUPLICATE_RULES`, `packages/shared/src/validators/duplicate-rules.ts`). The pull guard, reconcile cron, cleanup cron, intake block, delivery check and graduation guard below only act when a company switches them on. Always on: double-tap guard (same phone + form, 2 min), pull/graduate once, a cart's own same-session order. Never re-hardcode a duplicate rule.
- **Order-form offer/price check never rejects (2026-10-07):** a mismatch creates the order with `orders.offer_check` ("Check price"); CONFIRMED is blocked until `orders.clearOfferCheck` (off-offer price needs Head of CS / admin). Failed submits are recorded in `form_submit_attempts`.
- "Is this cart order really a real order?" has ONE definition: `cartRealOrderMatchesQuery` in `apps/api/src/cart-orders/cart-order-real-order-match.ts`. Pull guard, reconcile cron and export all use it. Never add a parallel phone_hash + exact-product check.
- Match types: `CART_LINK` (orders.cart_id), `CART_CONVERTED` (source cart CONVERTED), `SAME_PRODUCT` (same phone + product, 14d), `SAME_SESSION` (same phone, any product, ±2h). "Same phone" = phone_hash OR last 9 raw digits (`803…` vs `0803…` hash differently).
- Reconcile cron: UNPROCESSED/CS_ASSIGNED/CS_ENGAGED matches are soft-deleted; CONFIRMED+ are only flagged `is_duplicate='CART_EDGE_FORM_DUPE'`, never deleted. Every write has a timeline event naming the real order.
- Pull guard: every skipped cart gets a `skip_reason`, or `runAutoSync` retries it every tick. One cart order per customer per session.
- Never change `normalizePhoneForHash` to fix hash drift (breaks every NG hash). Never move this logic into the edge-form intake path (frozen).
- Called-but-unconfirmed (CS_ENGAGED) cart orders stay as they are: no auto-close (user decision).

## Order Capture: catch first, check after (CEO 2026-10-07, LOCKED)
CEO escalation: CPA up, "orders stuck in Carts". Rule: every customer who presses submit must become an order; duplicates and prices are checked AFTER the order exists. Only customers who never pressed submit (or whose submit failed) may end up in Carts.
- **Nothing may reject a submitted order** on the intake path (`orders.create`, edge worker). New checks must flag, never throw. A rejection is a lost order: 4xx is not buffered by QStash.
- **Duplicate rules**: per-company setting `DUPLICATE_RULES` (Settings > Duplicate rules), **ALL OFF by default**. Never re-hardcode a duplicate rule or change the defaults without the owner. Always on, not settings: double-tap guard (same phone + same form within 2 min returns the first order), pull/graduate once, a cart's own same-session order.
- **Offer/price check never rejects**: a mismatch creates the order with `orders.offer_check` ("Check price" badge). CONFIRMED is blocked until `orders.clearOfferCheck`; a price outside the active offers needs Head of CS / admin. Editing items to a valid offer clears it automatically. A flagged PAY_ONLINE order never starts Paystack. Flagged orders are not pulled into follow-up.
- **Properly filled but unsubmitted forms become orders** (owner 2026-10-07): a cart with every required field + an offer chosen, ~30 min after the customer went quiet, is created as a NORMAL order (`edge-form`, MB attributed, priced from the chosen offer, PAY_ON_DELIVERY) by `OrdersService.convertUnsubmittedFullForms`. Definition + timings: `apps/api/src/cart-orders/unsubmitted-form.ts` (one definition, shared with the cart pull, which holds these carts back for 60 min). **No badge or "from cart" tag in the UI** (it devalues the order with CS); the internal marker `orders.capture_source = 'UNSUBMITTED_FORM'` exists only for counting/audit. Going forward only. If that browser later submits the same form, `orders.create` returns the existing order (never a second), silently: no timeline note. Count: `SELECT count(*) FROM orders WHERE capture_source = 'UNSUBMITTED_FORM'`.
- **Every failed submit is recorded** in `form_submit_attempts` (edge worker `/track-submit` beacon, sendBeacon only): `BROWSER_BLOCKED` (reason = field names), `FORM_BLOCKED` / `SERVER_REJECTED` (reason = message shown). Never store typed values. A path that stops a customer must leave a trace.
- **Form failures report** (`/admin/marketing/analytics/failures`, `marketing.submitFailures`): failures per form + what each customer did next, joined on the browser `session_id` (persisted per browser, sent with the failure, the cart and the order): **Later ordered** = an order with that session_id created after the first failure; **Became cart order** = no order, but a cart_orders row whose source cart has that session_id; **Abandoned** = neither. Failures with no session_id are counted as untraceable. Keep these three definitions; do not invent parallel ones.
- Data from the Oct 7 investigation: the drop was mostly fewer visitors to top campaigns; same MB on identical forms got 99% vs 49% completion, so form setup was not the cause; huge offer menus (26 to 65 offers) stall customers at "select an offer".

## Export Columns
- Every column key in `EXPORT_CONFIGS` (`apps/web/app/lib/export-config.ts`) must exist in `reportColumnsByKey` (`packages/shared/src/validators/reports.ts`), or the whole export fails with an invalid enum error. Enforced by `export-config.spec.ts`. When adding a column: validator enum + export-config + the `reports.service.ts` row and column list, all three.

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

## Data Consistency Rules (Stat Strip ↔ Table Alignment)
Every stat strip on every page MUST show numbers that match the table/list below it. When a number appears in two places, both MUST come from the same query or table.

### Order counting by table
- **`orders` table**: funnel orders (`order_source` NULL/`edge-form`/`import`), offline orders (`offline`), cart-graduated (`online`), delivered follow-up copies (`delivered_follow_up`).
- **`cart_orders` table**: cart pipeline orders (separate lifecycle). Only DELIVERED/REMITTED count toward marketing totals.
- **`follow_up_orders` table**: follow-up pipeline (separate lifecycle). Only DELIVERED/REMITTED graduate.

### Stat strip filters MUST mirror list filters
- If `orders.list` applies `excludeGraduated=true` (hard-excludes `is_follow_up=true` + `delivered_follow_up`), the stat strip query MUST apply the same exclusions.
- If `orders.list` applies `excludeCartGraduated=true`, the stat strip MUST too.
- Use `getStatusCountsByOrderSource` with `excludeFollowUps=true` + `excludeCartGraduated=true` for marketing stat strips.
- Never use `getStatusCounts` with different follow-up/cart flags than the corresponding list.

### Cross-table totals
- When combining counts from multiple tables (orders + cart_orders + follow_up_orders), each table counts only its own rows. Never double-count.
- Cart orders in TOTAL: only add DELIVERED/REMITTED from `cart_orders` table. Never add the full cart pipeline total.
- Follow-up orders in TOTAL: only add DELIVERED/REMITTED from `follow_up_orders` table. Never add the full follow-up pipeline total.
- Delivered follow-up copies (`order_source='delivered_follow_up'` in orders table) are separate from follow_up_orders table rows. Don't conflate.

### Single source of truth for combined strips
- When a strip shows a TOTAL across all order types, derive every number from **one query** against the orders table (e.g. `onlyGraduateNonMarketing`). Never mix queries with different branch scopes or different tables.
- For per-source breakdowns (Delivered/Remitted modals), use `getDeliveredBySource` which classifies within the orders table via `order_source` / `is_follow_up`. Never subtract separate-table counts from orders-table counts.
- Never combine marketing-scoped (`branch_id`) and servicing-scoped (`servicing_branch_id`) query results in the same strip or breakdown.

### Graduation date alignment
- When a follow-up or cart order graduates (creates a copy in `orders` table), the graduated copy MUST use the **follow-up/cart order's `created_at`**, not the original source order's `created_at`.
- This ensures date-filtered counts between pipeline tables (`follow_up_orders`, `cart_orders`) and the `orders` table stay consistent for the same period.

### Cart abandonment vs cart orders
- "Cart Abandonment" counts from `cart_abandonments` table (all abandoned forms).
- "Cart Orders" counts from `cart_orders` table (recovered carts in the CS pipeline).
- These are intentionally different numbers. Never equate them.

### Branch scoping
- Marketing surfaces: `branch_id` (campaign attribution).
- CS/Sales/Logistics/Finance: `servicing_branch_id` (fulfillment branch).
- When comparing numbers across marketing and CS pages, expect differences when `branch_id ≠ servicing_branch_id`.

### Per-role dashboard data flow (canonical as of 2026-07-20)

#### SuperAdmin / SUPPORT → CEO Dashboard (`/admin`)
- **ORDER FUNNEL**: `getStatusCounts` with `branchScope='marketing'`, `isFollowUp=false`, `excludeOffline='include-imports'`, `excludeGraduated=true`, `excludeCartGraduated=true`.
- **TOTAL ORDERS**: `getStatusCounts` with `onlyGraduateNonMarketing=true` — all tiles + total from this single query. `onlyGraduateNonMarketing` excludes `is_follow_up=true` from the marketing bucket. Delivered/Remitted breakdowns use `getDeliveredBySource` (orders table, per-source). Must match Cash Remittances.
- **OFFLINE ORDERS**: `getStatusCounts` with `onlyOffline=true`.
- **FOLLOW-UP ORDERS**: `getFollowUpConfigService().getFollowUpOrderStatusCounts()` — from `follow_up_orders` table.
- **CART ORDERS**: `getCartOrdersService().getStatusCounts()` — from `cart_orders` table.
- **DELIVERED FOLLOW-UP**: `getStatusCounts` with `onlyOffline='delivered_follow_up'` — from `orders` table.
- Separate strips, each from one source. No cross-table summing on individual strips.

#### HEAD_OF_CS / CS Supervisor → HoCS Dashboard (`/admin`)
- **Primary counts**: `orders.statusCounts` with `isFollowUp=false` (defaults to `excludeGraduated=true`, `excludeCartGraduated=true`). Scopes by `servicing_branch_id`.
- **Offline**: separate `orders.supplementaryCounts` + `orders.statusCounts` with `orderSource='offline'`.
- **TotalOrdersStrip**: sums `orderCounts` + `followUpCounts` + `cartOrdersCounts` + `deliveredFollowUpCounts` from secondary bundle. All four must be present.
- **Secondary bundle** (`/api/dashboard-secondary`): fetches `followUpCounts`, `cartOrdersCounts`, `deliveredFollowUpCounts` (with `excludeGraduated=false`). Uses date filters from URL.
- **DELIVERED FOLLOW-UP strip**: clickable link to `/admin/sales/delivered-follow-up`.

#### HEAD_OF_CS → Team Analysis (`/admin/sales/team`)
- **Bundle**: `orders.csTeamPageBundle` — single tRPC call.
- **TOTAL ORDERS**: `grandTotal` = `categoryCounts.funnel` + `categoryCounts.offline` + `categoryCounts.deliveredFollowUp` + `fuTableTotal` + `cartTableTotal`.
- **FUNNEL**: `getStatusCounts` with `isFollowUp=false`, `excludeOffline='include-imports'`, `excludeGraduated=true`, `excludeCartGraduated=true`, `branchScope='servicing'`.
- **OFFLINE**: `getStatusCounts` with `onlyOffline=true`, `branchScope='servicing'`.
- **DELIVERED FOLLOW-UP**: `getStatusCounts` with `onlyOffline='delivered_follow_up'`, `branchScope='servicing'`.
- **FOLLOW-UP / CART**: from separate tables (`follow_up_orders`, `cart_orders`).
- **Per-closer table**: `getCSCloserLeaderboard` — includes ALL order types (no `excludeGraduated`). `ordersEngaged` = total assigned excluding DELETED.
- Team Analysis TOTAL ORDERS must equal HoCS Dashboard TOTAL ORDERS for the same branch/date.

#### CS_CLOSER → Closer Dashboard (`/admin`)
- Same as HoCS but scoped to `assignedCsId=self`.
- `orderListBranchIdOwnerAware` expands to `(branch OR assigned=me)` for self-query parity.

#### MEDIA_BUYER → Marketing Orders (`/admin/marketing/orders`)
- **Stat strip**: `getStatusCountsByOrderSource` with `orderSource='edge-form-and-import'`, `branchScope='marketing'`, `excludeFollowUps=true`, `excludeCartGraduated=true`. Scoped to `mediaBuyerId=self`.
- **Cart-graduated**: from `cart_orders` table via `getCartOrdersService().getStatusCounts()`. Only DELIVERED/REMITTED added to grand total.
- **TOTAL** = funnel statusTotal + cartGraduatedDelivered. Never add full cart pipeline.
- **Table**: `orders.list` with `orderSource='edge-form-and-import'`, `branchScope='marketing'`, `excludeGraduated=true` (default). `mediaBuyerId=self` enforced server-side.
- **All Statuses (N)**: N = funnel statusTotal only (excludes cart). Must match table pagination total.

#### HEAD_OF_MARKETING / Marketing Supervisor → Marketing Orders
- Same stat strip as MEDIA_BUYER but `mediaBuyerId` = URL param (or all).
- Supervisor toggle: "My" scopes to `mediaBuyerId=self`, "Team" shows all supervised MBs.
- Personal bundle pre-fetched for instant toggle.

#### HEAD_OF_CS → Funnel Orders (`/admin/sales/orders`)
- **Stat strip**: `orders.statusCounts` with `branchScope='servicing'`, defaults `excludeGraduated=true`, `excludeCartGraduated=true`.
- **Table**: `orders.list` with `branchScope='servicing'`, same exclusions.
- Cart-graduated orders have separate "Cart Orders" page.

#### HEAD_OF_CS → Cart Orders (`/admin/sales/cart-orders`)
- **Stat strip + table**: both from `cart_orders` table via `cartOrders.getStatusCounts` / `cartOrders.list`.
- Scoped by `servicingBranchId`.
- Completely separate from `orders` table.

#### HEAD_OF_CS → Follow-Up Orders (`/admin/cs/follow-up`)
- **Stat strip + table**: abandoned carts view uses `cart.listAbandoned` from `cart_abandonments` table.
- Follow-up orders view uses `orders.list` with `isFollowUp=true`.

#### HEAD_OF_CS → Delivered Follow-Up (`/admin/sales/delivered-follow-up`)
- **Stat strip + table**: `orders.list` / `orders.statusCounts` with `orderSource='delivered_follow_up'`, `excludeGraduated=false`.
- From `orders` table where `order_source='delivered_follow_up'`.

#### Logistics / Finance roles
- Logistics passes `excludeGraduated=false` so graduated deliveries stay visible for remittance.
- Finance scopes by `effectiveBranchIds`. `hasFinanceAccess(user)` gates finance-only data.

### When adding a new stat strip or dashboard section
1. Identify which table(s) the list queries.
2. Use the exact same WHERE conditions for the stat strip.
3. If combining tables, only count graduated (DELIVERED/REMITTED) rows from secondary tables.
4. Verify the strip total = list "Showing X of Y" total on the same page.
5. Check the role-specific data flow above — never break an existing role's numbers.

## Git Workflow
- **Never push without explicit user confirmation.** Always ask "Ready to push?" and wait for a yes before running `git push`.
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
