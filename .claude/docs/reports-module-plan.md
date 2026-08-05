# Centralized Reports Module — Implementation Plan

Status: APPROVED SPEC, ready to build. Author: pairing session 2026-08-05.

## 1. Confirmed decisions (locked)

| Decision | Choice |
| --- | --- |
| Home | New top-level nav group **`Admin`** → **`Reports`** (Reports-only for now; Audit/Export/Config stay put) |
| Access gate | **Admin-level**: `isAdminLevel(user)` (SUPER_ADMIN + ADMIN + SUPPORT). No per-category gating. |
| Scope | **All 12 categories + CA/Funnel**, fully polished to flagship detail |
| Profit | **Real FIFO landed COGS** via existing `finance.service` profit engine (matches CEO/finance dashboards) |
| Report UX | **On-screen sortable table** (all rows visible) + date-preset bar + column picker + export |
| Export | CSV / PDF / XLSX via existing `reports.exportCsv` + `local-export-modal` pattern |

## 2. Categories (13 reports total)

1. Product Performance ⭐ (flagship, new backend)
2. Customer Acquisition & Order Funnel ⭐ (flagship, new backend)
3. Staff Performance
4. Media Buyer Performance
5. Customer Service Performance
6. Logistics Manager Performance
7. Delivery Agent Performance
8. Payroll Reports
9. Order Reports
10. Order Category Report
11. Product Stock Reports
12. Finance Reports
13. Marketing Reports

⭐ = built first as the template; others follow the same shell.

## 3. Reuse map (what already exists — do NOT rebuild)

| Need | Existing asset |
| --- | --- |
| Export engine | `apps/api/src/reports/reports.service.ts` (`exportCsv`, ~20 report types) + `reports.router.ts` |
| Column-pick + export modal | `apps/web/app/components/ui/local-export-modal.tsx`, `export-modal.tsx` |
| Export column configs | `apps/web/app/lib/export-config.ts` (`EXPORT_CONFIGS`, `EXPORT_DATE_PRESET_OPTIONS`) |
| CSV/XLSX helpers | `apps/web/app/lib/csv-export.ts` (`toCsv`, `downloadCsv`, `exportToCsv`) |
| Date presets | `apps/web/app/components/ui/date-filter-bar.tsx` (`DateFilterBar`, `getPresetRange`) |
| MB performance | `marketing.service.getMediaBuyerLeaderboard` → `marketing.leaderboard` / `teamPageBundle` |
| CS performance | `orders.service.getCSCloserLeaderboard` → `orders.csLeaderboard` / `csTeamPageBundle` |
| Logistics performance | `logistics.service.listProviders` / `listLocations` (perf embedded) |
| Product deliveries | `orders.service.getDeliveriesByProduct` / `deliveredOrdersByProduct` |
| Funnel / CA metrics | `marketing.service` (CR/DR/conversion ~L5517-5602) → `marketing.metrics` / `overviewPageBundle` |
| Profit (FIFO) | `finance.service` profit engine → `finance.profitReport` / `fastProfitReport` |
| Payroll register | `hr/payroll-metrics.service.ts` + `PayrollReportsPage.tsx` |
| Finance statements | `general-ledger.router.ts` (P&L, balance sheet, cash flow, aging, etc.) |
| Nav group shape | `apps/web/app/components/layout/dashboard-layout.tsx` NAV_GROUPS array |

## 4. Genuinely NEW work

### Backend (new procedures)
- **B1. `reports.productPerformance`** — consolidated product-by-product: name, totalOrders, ordersConfirmed, confirmationRate, delivered, deliveryRate, avgCPA, revenue, adSpend, **FIFO profit**, returns, carryOver. Assembles from `getDeliveriesByProduct` + marketing CPA/adSpend + `finance.service` FIFO COGS, grouped by product. All products at once.
- **B2. `reports.customerAcquisitionFunnel`** — standalone funnel: leadsGenerated, ordersCreated, ordersConfirmed, ordersDelivered, returnedOrders, confirmationRate, deliveryRate, funnel conversion rates. Wraps existing marketing funnel logic so it's callable outside the Marketing page.
- **B3. `reports.catalog`** (optional thin) — lightweight metadata list of available report categories for the landing page (or hardcode client-side; decide at build).
- **B4. Extend `reports.exportCsv`** — add `product_performance` and `ca_funnel` report keys so the two flagships export through the same engine as everything else.

### Backend (reshaping existing — wiring, not inventing)
- **B5.** For categories 3-13, add thin `reports.*` procedures (or reuse existing) that return the flat, table-shaped rows for the report shell. Most call an existing service method and flatten. Where a `reports.exportCsv` key already exists (marketing_team, cs_team, products, payroll, logistics_*, etc.), reuse it for export.

### Shared date presets (small, real gap)
- **B6.** `DateFilterBar` currently has NO quarter/year presets. Add `this_quarter`, `last_quarter`, `this_year` to the `DatePreset` type + `getPresetRange()` + the preset chip list. Backend `ExportDatePreset` in `@yannis/shared` may need matching additions. This is shared infra — touches existing pages, so add additively (don't remove/rename existing presets).

### Frontend (new)
- **F1. Nav:** add `{ group: 'Admin', items: [{ label: 'Reports', href: '/admin/reports', icon, roles: ['SUPER_ADMIN','ADMIN','SUPPORT'] }] }` to NAV_GROUPS in `dashboard-layout.tsx`. Gate with admin-level.
- **F2. Reports landing page** — `apps/web/app/routes/admin.reports/route.tsx` + `apps/web/app/features/reports/ReportsCatalogPage.tsx`: grid of 13 category cards, each linking to its report route. Admin-level loader guard.
- **F3. Shared report shell component** — `apps/web/app/features/reports/ReportShell.tsx`: date-preset bar + column picker (checkbox popover) + sortable `CompactTable` + export button. Built ONCE, every report renders through it. Column selection drives visible columns; sort by any column; export respects picked columns + date range.
- **F4. 13 report route+feature pairs** — `admin.reports.$category/route.tsx` (or one dynamic route with a registry). Each supplies: report title, column definitions (with default-on set), the tRPC procedure to fetch rows, and the export key. Flagships (product-performance, ca-funnel) built first as the canonical example.
- **F5. Report registry** — `apps/web/app/features/reports/report-registry.ts`: maps category slug → { title, description, columns[], defaultColumns[], fetchProcedure, exportKey, permission }. Single source of truth so adding a report = one registry entry + (if new) one backend procedure.

## 5. Build order (phased, but shipping ALL)

**Phase A — Foundation (unblocks everything) — ✅ DONE (2026-08-05, build-verified)**
- A1. ✅ Added `this_quarter` / `last_quarter` / `this_year` presets to `date-filter-bar.tsx` (type, getPresetRange, getActiveDraftSelectionId, chip list). Backend `ExportDatePreset` needs NO change — Reports export passes explicit dates.
- A2. ✅ New `Admin` nav group + `Reports` item (roles: SUPER_ADMIN/ADMIN/SUPPORT) in `dashboard-layout.tsx`; `reports` icon added to `sidebar.tsx`. Landing route `routes/admin.reports/route.tsx` + `features/reports/ReportsCatalogPage.tsx` (grouped cards, planned=disabled).
- A3. ✅ `features/reports/ReportShell.tsx` (DateFilterBar + column-picker popover + sortable CompactTable + LocalExportModal export) + `features/reports/report-registry.ts` (13 categories). Dynamic route `routes/admin.reports.$slug/route.tsx` renders through the shell (planned → "coming soon" state).
- A4. ✅ Both routes guard server-side via `requireRole(request, ['SUPER_ADMIN','ADMIN','SUPPORT'])`.
- ✅ Milestone MET: hub navigable, shell plumbing proven, full `remix vite:build` passes.
- Files touched: `date-filter-bar.tsx`, `sidebar.tsx`, `dashboard-layout.tsx`, + new `features/reports/*` and `routes/admin.reports*`.

**Phase B — Flagships (prove the pattern)**
- B1. Product Performance: backend `reports.productPerformance` + FIFO profit wiring + registry entry + export key.
- B2. Customer Acquisition & Funnel: backend `reports.customerAcquisitionFunnel` + registry entry + export key.
- ✅ Milestone: two full reports live end-to-end (table + presets + column picker + export). Sign-off on look/feel before templating.

**Phase C — Wire existing-data categories (bulk)**
- MB Performance (marketing.leaderboard), CS Performance (orders.csLeaderboard), Logistics Manager + Delivery Agent (logistics.listProviders/listLocations), Marketing Reports (marketing.overviewPageBundle), Order Reports (orders.list/statusCounts), Order Category (group orders by product/category), Staff Performance (payroll-metrics), Payroll (existing register), Product Stock (inventory), Finance (profitReport / GL statements).
- Each = one registry entry + one thin flatten procedure (or reuse existing export key).
- ✅ Milestone: all 13 categories live.

**Phase D — Polish & verify**
- Sortable columns, empty states, loading skeletons, mobile cards (per CLAUDE.md mobile rules), number-consistency check (report totals must match source dashboards — reuse SAME procedures, never recompute), export parity check (screen columns == exported columns).

## 6. Hard constraints (from CLAUDE.md — must honor)

- **Number consistency:** reports MUST pull from the same canonical procedures the dashboards use. Never recompute CR/DR/CPA independently or numbers will drift (explicit CLAUDE.md rule). Product Performance profit MUST match finance dashboard.
- **Pillar 2 (Lead Fortress):** no raw customer phones in any report/export. Reports are aggregates — safe by design, but audit the export columns.
- **Pillar 4 (Accountability):** report generation is read-only; no `withActor` writes needed. If we log report exports, do it via existing audit path.
- **No em dashes** in any user-facing report labels/descriptions.
- **Mobile-first:** landing cards dense; report tables get mobile card treatment; shared components only (no one-off variants).
- **`isAdminLevel(user)`** for the gate — never inline `role === 'SUPER_ADMIN'`.
- **`effectiveBranchIds`** must be passed to every list/aggregate procedure the reports call (multi-company isolation), even though the module is admin-only — company switcher still applies.

## 7. Open questions to resolve during build (not blockers)

- Order Category Report: is "category" = product category taxonomy, or order_source bucket (funnel/offline/cart/follow-up)? Confirm with CEO when we reach Phase C.
- Delivery Agent vs Logistics Manager: both map to logistics providers/locations today; confirm whether "Delivery Agent" needs per-rider granularity (may need new aggregation).
- Whether the landing catalog needs its own backend procedure or can be a static client-side registry (lean static).

## 8. Risks

- **Number drift** (highest): mitigated by reusing canonical procedures, not new SQL.
- **FIFO profit per-product cost**: heavier query; may need caching / mat-view if slow. Watch p95.
- **Date-preset infra change** touches ~60 existing pages: additive only, regression-test the DateFilterBar.
- **Scope size**: 13 polished reports is multi-week; phased milestones keep it shippable incrementally.
