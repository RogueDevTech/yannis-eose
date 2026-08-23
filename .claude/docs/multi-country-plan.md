# Multi-Country Expansion — Implementation Plan

Status: DRAFT for review (2026-08-22). Builds on the shipped multi-currency foundation
(`.claude/docs/multi-currency-plan.md`). Nothing here is committed.

## Decisions locked (from review session)

1. **Country = hard per-user data scope.** MEDIA_BUYER = implicit all-countries. Everyone
   else (including org-wide Finance / Stock Manager / HoL) must be explicitly assigned
   countries. Unassigned country = invisible.
2. **1 country = 1 currency**, always. We build on the existing `currency_code` primitive.
   No separate `countries` table. Country stays the label on the currency
   (`currencies.country_name`).
3. **Stock & inventory country-partitioned** — `stock_batches` + `inventory_levels` +
   FIFO per country. Not just a consumption filter: separate stock pools per country.
4. **Cross-country transfers allowed, with FIFO handoff** (deduct source-country batches,
   create destination-country batches, re-value across the currency boundary).
5. **Shared product catalog, per-country stock.** One product definition (company-scoped
   as today); only stock/FIFO/levels are per-country.
6. **Edge form stays FROZEN.** Order country derives server-side from the already-stamped
   `currency_code`. Zero change to public intake / edge worker. (Pillar 1.)
7. **cart_orders and follow_up_orders get the SAME country treatment as orders.** They already
   carry `currency_code` (cart_orders) / inherit it (follow-up). Every place orders are
   country-scoped, routed, or fulfilled, the cart + follow-up pipelines get the identical
   filter/routing/FIFO-country logic. Never leave a pipeline unscoped — that would be a
   country-leak (a Ghana-unassigned user seeing Ghana cart/follow-up orders).

## The model (corrected after review)

**Country is NOT tied to a branch.** It's an org decision how orders group into branches.
Country is a property of:

- **the order** — `orders.currency_code` (already there, derived from the edge form; frozen).
- **each physical resource** — a `currency_code` set on the resource itself when created:
  - `logistics_providers.currency_code` (Ghana provider = GHS)
  - `logistics_locations` country = derived from its provider (or its own column)
  - `stock_batches.currency_code` (Ghana stock pool = GHS)
  - `shipments.currency_code` (derived from destination location)

**Branches stay country-free org groupings.** You point any country's orders at any
servicing branch via the routing rule (Phase 2). A branch can service one country or
several; the system does not force a mapping.

**Two independent axes, connected by routing:**
- **Order country** = currency (what the customer bought in).
- **Resource country** = set per resource (where stock/agents physically are).
- **Routing** connects order → servicing branch (org's choice).
- **Fulfillment coherence** = a GHS order draws only GHS stock and GHS logistics agents.
  This is enforced at the *fulfillment* stage, not at routing.

**User country-scope** filters on the **order's currency** directly
(`countryScopeCondition(orders.currencyCode, ...)`), NOT via branches. HoL/Finance/Stock
assigned to Ghana see rows where `currency_code = GHS`; unassigned = invisible.

No `branches.currency_code`. No forced branch↔country mapping. Backfill every existing
order and physical resource to `'NGN'`.

---

## Phases

### Phase 0 — Country is a first-class dimension (FOUNDATION, no branch coupling)
- Confirm order country = `orders.currency_code` (exists). No new order column needed.
- Add `currency_code` to the physical resources (own column each, set at create, default NGN):
  `logistics_providers`, `stock_batches`, `shipments`. `logistics_locations` derives from its
  provider (or gets its own column if a provider spans countries — it shouldn't).
- Backfill all existing rows → `'NGN'` (+ history table sync on every ALTER — trigger trap).
- Helper `resolveCurrencyForOrder(order)` = `order.currency_code`.
- **Branches are NOT touched** — no `branches.currency_code`, no branch↔country mapping.
- **No behavior change yet** — everything is still NGN. Pure groundwork.

### Phase 1 — Per-user country scope (hard scope + go-dark safeguards)
- New join table `user_countries (userId, currencyCode)`, mirroring `user_branches`.
- New scope permission `countries.view_all` (bypass, like `branches.view_all`) — auto-granted
  to SUPER_ADMIN / SUPPORT / ADMIN and to MEDIA_BUYER role (MB = all countries).
- Context: resolve `effectiveCurrencyCodes` alongside `effectiveBranchIds` in
  `trpc/context.ts`. Unassigned + not-view_all → `[]` (match-nothing).
- `countryScopeCondition(currencyColumn, scope)` mirroring `branchScopeCondition`.
  Filters on the **row's currency_code** (order/shipment/batch/provider), independent of branch.
- Thread `effectiveCurrencyCodes` into every list/aggregate that already takes
  `effectiveBranchIds` (orders, cart, finance, inventory, shipments, logistics). This is an
  ADDITIONAL filter that stacks with branch scope — a user is limited by BOTH their branches
  AND their countries.
- **Go-dark safeguards (first-class, non-optional):**
  - User create/edit: country assignment is a visible, required step for non-MB roles.
  - Admin alarm: when a currency/country has data (orders/shipments/remittances) but **zero**
    assigned users in a required org role (Finance / Stock Manager / HoL), surface a loud
    warning. "Kenya has N orders and no assigned Finance user."
- Migration backfill: assign every existing user → NGN so nobody goes dark on day one.

### Phase 2 — Sales routing by (country + product) → servicing branch
- Add `currency_code` to `cs_order_routing_rules` (nullable = any-country catch-all).
- Thread it into `resolveServicingBranchForProduct(branchId, productId, currencyCode)`
  (`orders.service.ts:2289`). Order's country = its stamped `currency_code`.
- This is where "Ghana orders → the Ghana servicing branch" is configured. Branch is NOT
  country-tagged; the RULE decides. Any country can point at any branch (org's choice).
- **Fallback order (defined):** (country+product) → (country, product=null) →
  (product, country=null) → existing default branch. No order lands nowhere.
- **No cross-currency invariant on routing** — routing to any branch is allowed. Coherence is
  enforced at fulfillment (agent-assign / FIFO), NOT here. Routing never blocks.
- Routing rule UI gains a country column. Permission unchanged (`orders.routing.manage`).

### Phase 3 — Logistics country-based
- Add `currency_code` to `logistics_providers` (own column, set at create). Backfill → NGN.
  Create form: country mandatory. Not derived from any branch.
- CS assign-to-agent (CONFIRMED→AGENT_ASSIGNED, `orders.service.ts:5831`): filter the
  assignable provider/location list to the **order's** `currency_code`.
- **THE block point (your requirement):** blocking happens HERE, at agent assignment, NOT at
  order routing/assignment. If the order's country has zero providers/agents → assign list is
  empty → block the AGENT_ASSIGNED transition with a clear message ("No Ghana agent available")
  + admin alarm. The order still sits happily in the Ghana branch, confirmed, waiting for an
  agent to exist. Do NOT silently allow a wrong-country agent.

### Phase 4 — Shipments country-tagged
- Add `currency_code` to `shipments` (mirror orders). Derive from `destinationLocationId →
  location → branch.currency_code`. Backfill existing → NGN. Create: country shown, derived
  from destination (mandatory destination already exists).
- All shipment costs remain in that country's currency (documented, since they were
  implicitly NGN before).
- Shipment list scoped by `effectiveCurrencyCodes` (Phase 1).

### Phase 5 — Stock & inventory country-partitioned (BIGGEST piece, Pillar-3 critical)
- Add `currency_code` to `stock_batches` (`inventory.ts:15`). Stamp on INTAKE from the
  shipment's / location's country. Backfill existing → NGN.
- Add `currency_code` to `inventory_levels` **only if** locations can serve multiple
  countries — they can't (location→one branch→one country), so **derive, don't duplicate**:
  keep the (product, location) unique index and ON CONFLICT target UNCHANGED (avoids the
  0276/0327 trap). Country is a property of the location, not a new level column.
- **FIFO per country — thread country through all 3 functions AND every caller, in lockstep:**
  - `fifoActiveBatchPage` (`:205`), `consumeFifoRemainingInTx` (`:286`),
    `computeFifoLandedCostForQuantityInTx` (`:222`) gain a `currencyCode` predicate on the
    WHERE (`:212`, `:243`).
  - Callers: `completeDeliveryInventory` (`:3898`), + `orders.service.ts:10203`,
    `cart-orders.service.ts:1683`, `follow-up-config.service.ts:2359`, confirm-time cost
    `orders.service.ts:10098`.
- **Availability gates fixed in the SAME change (split-brain guard):**
  `assertGlobalAvailabilityForOrder` (`:3610`) and `assertLocationCanFulfillOrder` (`:3669`)
  must filter batches/levels by the order's country. If FIFO is partitioned but availability
  isn't, orders confirm on another country's stock then fail to fulfill. These ship together.
- **Fallback (defined):** product not stocked in order's country → surface at the
  agent-assign / fulfillment stage (same place logistics blocks), NOT at routing. The order
  routes to the Ghana branch fine; it only stalls when there's no Ghana stock to fulfill it.
  Clear "not stocked in Ghana" message + alarm.

### Phase 6 — Cross-country transfers with FIFO handoff (net-new logic)
- Today transfers move only shelf counts, never `stock_batches` (`approveTransfer` `:779`).
- For a cross-country transfer: deduct source-country FIFO batch layers (real
  `remaining_quantity` decrement, not just display cost) AND create new destination-country
  batch(es) with the transferred quantity.
- **Currency re-valuation:** source landed cost is in currency A; destination pool is
  currency B. Convert via `currencies.fx_rate_to_base` (base-anchored) so the new batch's
  `total_landed_cost` is denominated in B. Document that this is an FX-point-in-time value.
- Same-country transfers: unchanged (shelf-only) — no need to touch batches.
- TRANSFER_OUT / TRANSFER_IN movements already exist; add country context to reason.

### Phase 7 — Verification, backfill integrity, rollout
- Data-consistency checks: every stat strip / list scoped by country matches (extend the
  existing stat-strip↔list invariant to the currency dimension).
- Reconciliation query: assert every order's `currency_code` is a currency that is active for
  its company (flag any drift from the backfill). No branch-currency check (branches are
  country-free).
- Assert no `stock_batches` / `logistics_providers` orphaned to a currency that isn't active.
- Rollout: everything NGN-only until a 2nd active currency exists per company (reuses the
  existing `hasMultipleCurrencies()` dormancy gate — feature stays inert until then).

---

## Risks & how each is handled (the "will it bite later" list)

| Risk | Handled by |
|---|---|
| Org roles go dark on new country | Phase 1 go-dark alarm + required assignment step + NGN backfill |
| FIFO / availability split-brain | Phase 5 ships both in the same change; reconciliation in Phase 7 |
| Cross-country COGS distortion | Phase 6 explicit FX re-valuation via fx_rate_to_base |
| ON CONFLICT / unique-index trap | Phase 5 derives country on levels (no new column, index unchanged) |
| History-table trigger trap | Every ALTER syncs its _history table in the same migration |
| Edge form freeze (Pillar 1) | Order country IS currency_code; intake byte-identical, no derive needed |
| Order routed anywhere (no branch↔country lock) | Intentional: routing is org's choice; coherence enforced at fulfillment, not routing |
| Order stuck (no agent / no stock in country) | Blocks at AGENT-ASSIGN (not routing): clear message + admin alarm; order waits in branch |

## Go-dark safeguard — shipped vs deferred
- SHIPPED: admin banner via `currencies.unassignedCountryAlarms` (queryable on the
  admin dashboard; gated on `countries.manage`). Detects active non-default
  currencies with order data but no assigned Finance/Stock/HoL user.
- DEFERRED (follow-up): the push/notification arm (fire when a country first
  crosses into "has data, no owner"). Left out of this commit to avoid wiring a
  new `@Cron` service + module registration into an already-large change; the
  banner covers the primary surface. Add as a scheduled method that calls
  `getUnassignedCountryAlarms` + `enqueueCreateForRole('SUPER_ADMIN'/'ADMIN', …)`.

## Dormancy / safety
- Entire feature inert until a company has a 2nd active currency (`hasMultipleCurrencies()`).
- All backfills default to NGN → single-currency deployments behave exactly as today.
- No public-intake / edge-worker changes anywhere in this plan.

## Suggested build order
Phase 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7. Phases 0 and 1 are the foundation and must land first.
Phase 5 is the largest and riskiest (money math) — budget the most test time there.
Phases 2/3/4 are additive and can be parallelized after Phase 1.
