# Module Specs: Finance, HR/Payroll, Logistics, Inventory

## Finance Module

- True Profit = Revenue - (Landed COGS + Ad Spend + 3PL Fee + Delivery Fee + Commission)
- Column-Level Security: cost_price, landed_cost, margin STRIPPED unless `hasFinanceAccess(user)`. NestJS interceptor.
- Invoices: INV-2026-0001 sequential, auto-generated, no manual override

### Cash Remittance (Phase 18, CEO 2026-04-29)
Accountant-led from `/admin/finance/delivery-remittances`:
1. Create: multi-select DELIVERED orders sharing same logistics location, upload receipts
2. "Mark received now" checkbox: creates remittance as RECEIVED + bulk-transitions DELIVERED → REMITTED
3. Without checkbox: status SENT, mark Received later cascades REMITTED
- Server gates in `LogisticsService`. Do NOT route through `permissionProcedure('logistics.remit')`.

### Finance Payout Workspace (Phase 19)
`/admin/finance/payout`. Review payroll batches PENDING_FINANCE/PAID, export payout docs with bank details.
Bank fields on `users` (`payout_bank_name`, `payout_account_name`, `payout_account_number`) — finance-sensitive only.

### Finance "Hat" (migration 0059)
- ONLY role layered on primary role. Singleton (one user at a time).
- `is_finance_officer boolean` + partial unique index `users_only_one_finance_officer`
- `hasFinanceAccess(user)` returns true for `FINANCE_OFFICER` role OR `isFinanceOfficer === true`
- Assignment is atomic-swap: clear current holder in same transaction
- Notifications mandatory on hat move: `account:finance_hat_assigned` / `account:finance_hat_revoked`

---

## HR and Payroll Module

### Core Rules
- Settlement Window: **monthly only** (CEO 2026-04-26)
- Commissions on DELIVERED_AT, not CREATED_AT
- Clawback: PENDING_DEDUCTION for MB + CS closer on return
- Commission rules: JSONB in `commission_plans`, dynamic, editable by HR
- Every active staff member appears in batch with default-zero payout

### Multi-stage Payroll (CEO 2026-04-26, migration 0067)
Batches by `(branch_id × period_month × department)`.

**Lifecycle:** `DRAFT → PENDING_HR → PENDING_FINANCE → PAID`

| Dept | Roles | Owner |
|---|---|---|
| CS | CS_CLOSER | HEAD_OF_CS |
| MARKETING | MEDIA_BUYER | HEAD_OF_MARKETING |
| LOGISTICS | LOGISTICS_MANAGER, TPL_MANAGER, TPL_RIDER, STOCK_MANAGER | HEAD_OF_LOGISTICS |
| HR | HR_MANAGER, HEAD_OF_*, BRANCH_ADMIN, FINANCE_OFFICER | HR_MANAGER |

**Gates:**
- DRAFT/submit: `canPrepareDept` — admin OR matching Head OR branch supervisor OR branch HR
- PENDING_HR→PENDING_FINANCE: `canReviewBatch` — admin OR HR_MANAGER
- PENDING_FINANCE→PAID: `canProcessBatch` — admin OR FINANCE_OFFICER OR Finance hat

**Reject** goes back one stage (reason >= 10 chars). Batch never destroyed.

### Pages (separate, not tabbed — CEO 2026-04-26)
- `/hr/payroll` — Monthly Payrolls (batch workflow)
- `/hr/plans` — Commission Plans (rule config)

Commission plan procedures use `authedProcedure` (NOT `permissionProcedure('hr.write')`) so Heads can manage their dept's plans. Gate via `getManageableRolesForViewer`.

---

## Third-Party Logistics Module

- Own login + simplified dashboard (not full internal UI)
- Dual-Entry Transfer: units IN_TRANSIT until 3PL verifies and receives
- Shrinkage Alert when received qty < sent qty
- Local Restock: returns marked sellable go back to 3PL local stock
- Rider PWA in `/rider/` route group, offline sync with IndexedDB

### Transfer Approval Gate (Phase 23, migration 0131)
PENDING state when initiator isn't source authority. No inventory side effect until approved.

| Source Kind | Source Authority (skip approval) |
|---|---|
| WAREHOUSE | STOCK_MANAGER, BRANCH_ADMIN, SUPER_ADMIN, ADMIN |
| THIRD_PARTY | TPL_MANAGER, HEAD_OF_LOGISTICS, SUPER_ADMIN, ADMIN |

**HEAD_OF_LOGISTICS does NOT skip for WAREHOUSE** — Stock Manager must sign off.

`inventory.approveTransfer` permission. Server re-checks `canApproveSourceTransfer` on every submit. Client `transfer.canApprove` is UI hint only.

PENDING: no inventory effect. Approve → source stock deducted. Reject/Cancel from PENDING → inventory-neutral.

### Logistics Team Analysis
`/admin/logistics/team`. `logistics.teamOverview` permission. Provider-company rollup of delivery rate, delinquency rate.

---

## Inventory Module

- Location-based tracking. FIFO batch costing.
- Stock states: AVAILABLE, RESERVED, ALLOCATED_TO_3PL, IN_TRANSIT, DELIVERED, RETURNED, WRITTEN_OFF
- Virtual Buffer: 10% less stock visible to Sales
- Ghost Stock: dispatch locked until Stock Reconciliation form

### Order ↔ Shelf Integrity (locked)
| Transition | Gate | Side Effect |
|---|---|---|
| CONFIRMED | `assertGlobalAvailabilityForOrder` | None (pre-check) |
| AGENT_ASSIGNED | `assertLocationCanFulfillOrder` | increment reserved_count + ALLOCATION movements |
| DELIVERED | requires logistics_location_id | FIFO decrement + DELIVERY movement + decrement stock_count |

`inventory.verifyTransfer` granted to TPL_MANAGER + HEAD_OF_LOGISTICS + STOCK_MANAGER.

### Inbound Shipments (Phase 22, migration 0113)
Multi-line supplier receipts: CREATED → IN_TRANSIT → ARRIVED → VERIFIED → CLOSED/CANCELLED.
- VERIFIED creates stock_batches, upserts inventory_levels, logs stock_movements
- Landing cost allocated across lines weighted by received_qty × factory_cost
- Permissions reuse inventory codes: intake → create/update; verifyTransfer → verify/close
- Do NOT regenerate on VERIFIED → CLOSED. Do NOT cancel VERIFIED/CLOSED shipments.

### App Theme System
6 themes: system, light, dark, dim, ink, soft. `users.app_theme` nullable (null = org default).
Inline `getThemeBootScript()` BEFORE `<style>` tags. `applyAppTheme()` sets `data-app-theme`.
Legacy: `'neutral'` → `'dim'`, `'contrast'` → `'light'`.

### Font Scale System
3 scales: base (14px), large (15.75px), xlarge (17.5px). Root `html` font-size.
Inline `getFontScaleBootScript()` with theme script. All rem-based.

### Push Notification Center
4 layers: Mirror In-App → Push, Broadcast (role-scoped), Automation Rules (CRON/EVENT), Delivery Log + Ack.
- Never fire push without in-app notification row first
- Non-blocking fan-out: `enqueueCreate*` / `enqueueCreateForRole` / `enqueueCreateForLocation`
- SW handlers: always `showNotification()`, POST `/push/ack` with shown/clicked
- iOS 16.4+: must be Home Screen PWA
