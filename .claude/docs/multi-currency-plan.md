# Multi-Currency (Country + Currency) — Design & Build Plan

**Status:** DESIGN — awaiting sign-off. No code written yet.
**Author context:** CEO/owner directive, discussed 2026-08-13.

---

## 1. The model (what this is, and what it is NOT)

This is **NOT** the hard "country switcher that reloads everything into an isolated Ghana world" from
the original edge-cases doc. The owner's actual model is lighter and rides the existing single
environment:

> **Currency is a per-record attribute.** All currencies coexist in the same order lists, finance
> screens, and dashboards. You **filter** by currency; you do not **switch context** into a
> separate walled-off country.

Country is essentially a **label paired with a currency** in the config. The real primitive is
**currency**. There is no new `effectiveBranchIds`-style scoping axis — the existing
company (`branch_groups`) / branch isolation is untouched.

### Dormancy rule (the master gate)
The entire feature is **dormant until SuperAdmin adds a 2nd currency.** With only the seeded
default (NGN), *nothing changes anywhere* — no dropdowns, no filters, no form toggle, no payroll
change. Enforced by a single group-scoped helper `hasMultipleCurrencies()`. This guarantees
zero-risk landing of the foundation phases.

---

## 2. Locked decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Structure | Currency as per-record attribute. One shared view + currency filter. No country context-switch. |
| 2 | Config home | **New `currencies` table** (source of truth for symbol/precision/FX everywhere). |
| 3 | Default | NGN seeded, `is_default=true`, cannot be deleted/deactivated. |
| 4 | Empty 2nd-currency offer price | **Hidden until priced** (`price > 0` required to appear on form/switcher). Guarded at 3 layers. |
| 5 | Cash remittance | **Single-currency batches.** A batch holds one currency; totals never mix. |
| 6 | Finance/dashboard aggregates | **Currency-aware.** Never sum ₦ + GH₵. Per-currency stacked lines, or single-currency when filtered. |
| 7 | Ad spend | **Stays in NGN. Unchanged.** Ad spend does not inherit the order's currency. |
| 8 | CPA | `₦ spend ÷ order COUNT`. Count is currency-free → CPA needs **no FX**. All orders the ₦ produced count. |
| 9 | ROAS / revenue ratios | Need FX. Per-currency; non-NGN shows "Set FX rate" until FX configured. |
| 10 | FX | Lives on currency config, admin-editable anytime. Direction: **1 foreign = X Naira** (multiply to convert up). |
| 11 | FX usage | **Ratios only.** Never converts operational money. No consolidated ₦ total for now (deferred hook). |
| 12 | Payroll | **In scope.** Per-currency pay, single-currency batches. Non-NGN bypasses Nigerian PAYE (flat pay) until per-country tax engine exists. |

---

## 3. Schema

### 3.1 `currencies` table (new)
Group-scoped (`group_id`, per the company boundary). `_history` table synced (trigger trap rule).

```
currencies
  id                 uuidv7 PK
  group_id           uuid FK branch_groups   -- company scope
  code               text        -- 'NGN', 'GHS' (ISO 4217)
  symbol             text        -- '₦', 'GH₵'
  country_name       text        -- 'Nigeria', 'Ghana' (label only)
  precision          int  def 2
  is_default         boolean     -- exactly one true per group; the base currency
  active             boolean def true
  fx_rate_to_base    numeric(18,6) NULL   -- 1 unit of THIS currency = N base units. NULL until set.
  fx_rate_updated_at timestamptz NULL
  fx_rate_updated_by uuid NULL
  ...temporal + timestamps
  UNIQUE (group_id, code)
  partial UNIQUE (group_id) WHERE is_default   -- one default per group
```
Seed: one NGN row per existing group, `is_default=true`, `fx_rate_to_base=1`.

### 3.2 Offer price → per-currency map
Offers store price in **4 places** (mapping confirmed):
- `offer_templates.price` (marketing.ts:54) — modern single-product tiers
- `offer_group_items.price` (marketing.ts:33) — multi-item offers
- `products.base_sale_price` (products.ts:32) — auto-synced to cheapest active offer
- `products.offers` JSONB (products.ts:31) — **legacy** fallback

**Approach: new `offer_prices` rows keyed by currency**, NOT a JSON blob (FK integrity + query-ability).
```
offer_template_prices
  offer_template_id  FK
  currency_code      text
  price              numeric(12,2)
  UNIQUE (offer_template_id, currency_code)

offer_group_item_prices
  offer_group_item_id FK
  currency_code       text
  price               numeric(12,2)
  UNIQUE (offer_group_item_id, currency_code)
```
- The existing `.price` columns become the **NGN (default-currency) price** and stay populated
  (backfilled → the current value). This keeps every existing read path working unchanged when only
  NGN exists.
- Non-default currency prices live in the new rows. Absent row / price 0 = **not priced = hidden**.
- `syncProductBaseSalePriceFromTemplates` (marketing.service.ts:6263) stays NGN-only (base price is
  a NGN "from" price). Per-currency "from" price derived on read if ever needed.

### 3.3 Order currency (frozen)
Add to **`orders`** (orders.ts) and **`cart_orders`** (cart-orders.ts) — parallel tables:
```
currency_code   text  NOT NULL DEFAULT 'NGN'   -- frozen at creation, never changes
```
`total_amount`, `delivery_fee`, `order_items.unit_price` are already frozen numerics — they are now
understood to be **in `currency_code`**. No amount column changes. `_history` tables synced.

### 3.4 Form config (no migration — JSONB)
Add to `formConfigSchema` (marketing.ts:627), stored in `campaigns.form_config`:
```
allowMultiCurrency?: boolean   -- customer can switch currency on the public form
pinnedCurrency?: string        -- when allowMultiCurrency=false, the single currency this form uses
```
Default (absent) = NGN, single currency — identical to today.

### 3.5 Remittance currency
Add `currency_code text NOT NULL DEFAULT 'NGN'` to `delivery_remittances` (delivery-remittances.ts:12).
Batch is single-currency: only that currency's DELIVERED orders selectable.

### 3.6 Payroll currency (Phase 6)
- Staff/contractor gets `pay_currency` (default 'NGN').
- Payroll batch gets `currency_code` (single-currency batch).
- Non-NGN batches **bypass the Nigerian PAYE engine** (flat pay; statutory NGN-only) until a
  per-country tax engine exists. This protects the in-flight `feat/hr-payroll-corrections` PAYE work.

---

## 4. The "hidden until priced" guard (3 layers)

A customer can't be trusted and the MB toggle is separate from pricing, so the guard is enforced
at every entry:
1. **Public form render** — currency appears in the switcher only if the selected offer(s) have
   `price > 0` in that currency. **This is the primary guard** — the customer can never pick an
   unpriced currency in the first place.
2. **Offline order creation** (CS, authed) — currency dropdown lists only priced currencies.
3. **Public intake** (`orders.create`, `cart.save`) — **NO rejection guard** (edge form frozen,
   rule #1). Currency is stamped, never validated-to-reject. See §7.

---

## 5. Finance / dashboard aggregates (currency-aware)

Collides with the **Data Consistency rules** (stat strip must match its list). New rule:
- **Never sum across currencies.** Money aggregates return `{ byCurrency: { NGN: n, GHS: n } }`
  instead of `{ total: n }`. Collapses to a single number when only NGN exists → zero visible change.
- **Currency filter mirrors the list** (same as branch/date mirroring). Filter a list to GHS → its
  tile is GHS-only.
- "All currencies" tile = **stacked per-currency lines**, never a combined total.
- **CPA** = `₦ spend ÷ order count` — unchanged, no FX, counts all currencies' orders.
- **ROAS** = per-currency; non-NGN shows "Set FX rate" until FX set. `₦÷₦` works today regardless.

FX conversion is a **reporting lens for ratios only**. It never rewrites stored transaction amounts.

---

## 6. Currency display infra (foundation)
Replace hardcoded `₦` driven by the `currencies` table:
- `apps/web/app/lib/format-amount.ts:61` (`NAIRA = '₦'`, `formatNaira`) → `formatMoney(amount, currencyCode)`.
- 4 PDF helpers (`bank-pay-pdf.ts`, `invoice-pdf.ts`, `finance-report-pdf.ts:84`, `cash-statement-pdf.ts`)
  — resolve symbol from currency. Default → NGN → identical output today.

---

## 7. Edge form / public intake (FROZEN — rule #1) — RESOLVED

**Binding rule for this feature: STAMP currency on intake, NEVER REJECT on intake.**

The public intake paths are `orders.create` (orders.router.ts:474) and `cart.save`
(cart.router.ts:27). (`preparePaystackOrder` / online-pay is **OUT OF SCOPE** — owner: not doing
online delivery/pay for now; Paystack stays NGN-only, untouched.)

Why this rule exists: the 2026-08-04 incident — an auth gate on a public intake procedure returned
401 (a 4xx), so the QStash/Redis buffer never engaged and orders were lost for ~50 min. **Any new
rejection/validation on the public path can lose real customer orders.**

Therefore:
- ✅ **Currency is carried from the form config and stamped onto the order.** No new rejection
  logic on the public path. Missing currency or single-NGN config → defaults to `'NGN'`, identical
  to today. The public form can **never fail more than it does today**.
- ❌ **The "hidden until priced" guard is NOT enforced at public intake.** It lives at:
  - **form render** — customer never sees an unpriced currency in the switcher, and
  - **CS offline order creation** (authed — safe to guard).
- The single-NGN default path is byte-for-byte unchanged; the currency stamp only diverges from
  `'NGN'` when a multi-currency form explicitly sends another priced currency.

This is the only sanctioned way this feature touches the frozen path. Owner signed off 2026-08-13.

---

## 8. Build phases (owner's ordering)

Each phase is independently shippable and **inert until a 2nd currency exists**.

- **Phase 0 — Foundation (dormant). ✅ DONE.** `currencies` table (mig `0316_currencies_foundation.sql`) + `_history` (PK/unique dropped at birth — 0310 fix baked in) + seed NGN default per group + null-group fallback. Drizzle schema `db/schema/currencies.ts`. Pure helpers `currency/currency.ts` (`hasMultipleCurrencies`, `formatMoney`, `currencyByCode`, `toBaseAmount`, `addToBag`/`MoneyByCurrency`) + 21 passing unit tests. Web `format-amount.ts` `formatNaira` now delegates to shared `formatMoney` (byte-identical NGN output) + exports `formatMoney`/`NGN`/`CurrencyInfo`. **Verified on throwaway PG:** seed, idempotency, multi-version history capture (no dup-key crash), one-default-per-group, (group,code) uniqueness all pass. *No visible change.* PDF symbol resolution deferred into Phase 6 (finance surfaces) since PDFs are finance/report artifacts.
- **Phase 1 — SuperAdmin config. ✅ DONE.** Validators `validators/currencies.ts` (create/update/setFxRate/setDefault/list). Permission codes `settings.currencies.view`/`.manage`. `CurrenciesService` (create/update/setFxRate/setDefault with default-relocation + group-scope via `assertGroupInScope`) + `currencies.router.ts` + wired in `trpc.module.ts`. App-wide `currencies-catalog-context.tsx` (`useHasMultipleCurrencies`, `useBaseCurrency`); loaded in `/admin` loader (`currencies.listActive`) → threaded through `DashboardLayout` → `CurrenciesCatalogProvider`. UI: `admin.settings.currencies` route + `CurrenciesSettingsPage` (table + add/edit/FX/make-base/activate modals, dormancy hint) + `currencies.server.ts` + settings-landing card (isAdminLevel-gated). API tsc 0 errors, web tsc clean for currency files (6 pre-existing HR-branch errors unrelated). Code immutable, isDefault flips via setDefault only.
- **Phase 2 — Offers per-currency price. ✅ DONE.** Mig `0317_offer_currency_prices.sql`: `offer_template_prices` + `offer_group_item_prices` (ON DELETE CASCADE, unique (parent,code)). NO NGN backfill — base price stays on `offer_templates.price`/`offer_group_items.price`; sibling tables hold ONLY non-default currencies (absent/≤0 = not priced → hidden). Drizzle schema added. Validators: `currencyPricesSchema` + optional `prices` on create/update template + offer group item schemas. Service: `replaceOfferTemplatePrices` (create+update), `insertOfferGroupItemPrices` (create+update, index-zipped to new item ids after CASCADE-delete), `loadOfferTemplatePriceMap`/`loadOfferGroupItemPriceMap` batch readers. `getPublicCampaign` + `listOfferTemplates` return additive `pricesByCurrency`. UI: `OfferTiersPanel` renders a price input per non-base active currency (dormant when single-currency) + pre-fills on edit; `marketing-offer-template-actions.server.ts` serializes `templatePrices`; offer-group edit action threads per-line `prices`. **Verified on PG:** CASCADE + uniqueness. tsc: shared/api/web all clean for my files. *Offer-group per-line currency INPUTS (draft-row UI) deferred — data path complete, action no-ops when absent.*
- **Phase 3 — MB form multi-currency toggle. ✅ DONE (edge sign-off granted 2026-08-13).** `formConfigSchema` + web `CampaignFormConfig`: `allowMultiCurrency` + `pinnedCurrency`. MB toggle UI in `MarketingFormEditPage` (checkbox + pinned-currency select, gated on `useHasMultipleCurrencies`) + hidden inputs + `forms.$id.edit` action writes them to form_config. **EDGE WORKER (isolated, additive, stamp-never-reject):** `ProductOffer.pricesByCurrency` + `CampaignConfig.currencies` types; API `getPublicCampaign` returns `currencies` (only when 2+ active AND an offer priced) + per-offer `pricesByCurrency`; render adds a currency `<select>` (only when enabled) + `data-offer` carries pricesByCurrency + `.offer-price[data-base-price]`; client JS reads `data-currency-meta`/`data-initial-currency`, re-prices offers on switch (`offerPrice()` returns base price for base currency → identical), stamps `currencyCode` + currency price on the payload; `SubmissionPayload`/`OrderCreatePayload`/`validateSubmission`/`orderPayload` all thread `currencyCode` (never-reject, defaults NGN). **Single-NGN path byte-identical.** edge-worker tsc 0 errors. ⚠️ prod worker deploys manually via wrangler.
- **Phase 4 — Orders currency-aware. ✅ NON-EDGE DONE; edge stamping in the edge commit.** Mig `0318_orders_currency_code.sql` (currency_code NOT NULL DEFAULT 'NGN' on orders + cart_orders + history twins; **verified on PG** — positional UPDATE capture survives on both tables, idempotent, defaults NGN). Drizzle schema updated. Validators: optional `currencyCode` on `createOrderSchema` (STAMP-never-reject), `createOfflineOrderSchema`, `listOrdersSchema` (filter) + statusCounts inline input. Service: stamps `currencyCode` at create/createOffline (defaults NGN); `list` + `getStatusCounts` (trailing optional arg) filter by currency; statusCounts cache-key includes currencyCode. UI: shared `CurrencyFilterSelect` (self-hides when single-currency) wired into `OrdersListPage`; marketing-orders loader reads `?currency=`; CS `CreateOfflineOrderModal` gets currency selector + currency-aware pricing (uses offer `pricesByCurrency`, hidden-until-priced). **Edge-worker intake stamping done in the isolated edge commit (Phase 3).** Other order-list pages accept the param server-side; UI filter can be added per-page incrementally.
- **Phase 5 — Cash remittance. ✅ DONE.** Mig `0319_remittance_currency_code.sql` (currency_code NOT NULL DEFAULT 'NGN' on delivery_remittances + history twin; **verified on PG** — positional capture survives, defaults NGN). Drizzle schema updated. `createDeliveryRemittance` now enforces **single-currency batch**: loads each order's currencyCode, throws BAD_REQUEST if they don't all match, stamps the batch's `currencyCode` = the shared currency. `getDeliveryRemittance` uses `select()` so currency flows to the detail automatically. api tsc 0 errors. Frontend money display of batch currency handled in Phase 6.
- **Phase 6 — Finance/dashboard aggregates. ◑ CORE DONE; per-strip stacking is additive follow-up.** DONE: shared `MoneyAmount` component (renders `NairaPrice` for NGN/base — unchanged — and `formatMoney` with the currency symbol otherwise); wired into `OrdersListPage` amount column (a GH₵ order now shows GH₵, not ₦). Aggregate primitive (`MoneyByCurrency`/`addToBag`, never-sum-across-currencies) shipped in Phase 0. Statusstrip currency filter mirrors the list (Phase 4 wiring). **FOLLOW-UP (additive, safe, correct-as-NGN today):** (a) per-currency STACKED dashboard tiles (currently show base-currency total — correct for single-currency, needs `{byCurrency}` fan-out per strip); (b) `MoneyAmount` across the finance/remittance pages' many `NairaPrice` usages; (c) ROAS "Set FX rate" placeholder for non-base + CPA stays ₦÷count (needs per-currency revenue split in metrics service); (d) PDF helpers stay NGN (render base correctly). The financial-truth GUARANTEE (single-currency batches, frozen order currency, no cross-currency sum) is enforced server-side — remaining work is display fan-out.
- **Phase 7 — Payroll. ◑ FOUNDATION DONE; PAYE-bypass wiring deferred (active-code contention).** Mig `0320_payroll_batch_currency.sql`: `currency_code` NOT NULL DEFAULT 'NGN' on `payroll_batches` + history twin (**verified on PG**; generic positional capture survives). **Deliberately put currency on the BATCH, not `users`** — avoids rebuilding the users_history EXPLICIT-COLUMN trigger functions that the in-flight PAYE-corrections work (migs 0306-0311, `payroll-config.service.ts`/`payroll-formula-engine.ts` currently modified by a parallel process) owns. Drizzle schema updated. Pure guard `isNigerianTaxCurrency(code)` (ONLY NGN → Nigerian PAYE; non-NGN → flat pay) + 4 tests (25/25 pass). **DEFERRED (protects contended code):** threading the guard into the 9 `computePaye` call sites across `payroll-compute/config/batch.service.ts` — to be wired once the PAYE-corrections branch settles, to avoid a merge collision. Dormant anyway: no UI to create a non-NGN batch yet, so nothing is exposed. api tsc 0 errors.

---

## 9. Open questions (revisit before the relevant phase)
1. **Paystack / online-pay in non-NGN.** Paystack is NGN-only. Options: keep online-pay NGN-only (foreign forms are COD/offline), or add a per-currency PSP later. **Decide before Phase 3/4.**
2. **Consolidated ₦ total** for SuperAdmin executive view — deferred hook; decide later.
3. **Per-country tax engine** (Ghana PAYE) — deferred; non-NGN payroll is flat pay until then.
4. **Customer identity across currencies** — a customer may transact in multiple currencies; do NOT
   auto-merge financial histories across currencies (doc rule). Confirm at Phase 4.

---

## 9b. Testing (done 2026-08-13)
- **299 shared unit/integration tests pass** (added `currency.spec.ts` 25 + `currency-integration.spec.ts` 17). Confirms: never-reject intake (createOrderSchema valid with/without currencyCode, still rejects missing name), currency config validators, offer prices map, FX guard, `isNigerianTaxCurrency`.
- **Full migration chain run against a fresh real DB**: all 335 migrations applied (0316–0320 land cleanly on the complete schema). Verified on real tables: orders/cart_orders default NGN; real orders UPDATE positional history capture works (no trigger-trap); offer_template_prices CASCADE; per-group default + (group,code) uniqueness; dormancy gate flips ON when a 2nd active currency is added.
- **BUG FOUND & FIXED during testing:** the two `currencies` unique indexes (`_group_code_uniq`, `_group_default_uniq`) leaked on NULL group_id — SQL treats NULL as DISTINCT, so two null-group rows could share a code / both be default. Fixed by `COALESCE(group_id, '000…0'::uuid)` in both the migration (0316) and the Drizzle schema. Re-verified: null-group duplicates + second null-group default now rejected; cross-group same-code still allowed. (Stub tests missed this because they used non-null groups — the full-schema run caught it.)

## 10. Cross-cutting risk register
- **Edge form freeze (rule #1)** — §7. Highest risk. Isolate + sign-off.
- **`cart_orders` parallel table** — every order-currency change must cover it too.
- **History table trigger trap** — every altered table syncs its `_history` in the same migration.
- **`group_id` nullable / null-group leak** — currencies are group-scoped; watch null-group reads
  (`products.getCategories` pattern `groupId = X OR groupId IS NULL`).
- **Data Consistency rules** — stat strip must match its list, now on the currency axis too.
