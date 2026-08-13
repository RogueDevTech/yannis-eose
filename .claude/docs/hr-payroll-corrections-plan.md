# HR & Payroll Corrections — Implementation Plan (Tracks A, B, D, E)

Status: PLAN (not started). Attendance (Track C, doc items #3/#4/#9) is deferred to a
separate discussion. This plan covers the four approved tracks from the HR requirements doc.

Source requirements doc items mapped:
- **A** = doc #1 + #7 (supplementary payroll completes original salary; correct remaining PAYE)
- **B** = doc #2 (hidden staff / wrong base salary + reconciliation report)
- **D** = doc #5 (PAYE Remittance Export) + #6 (low-income PAYE exemption) + statutory deductions
- **E** = doc #8 (performance-bonus breakdown + delivery-rate correctness in Earnings Outlook)

Approved product decisions (from user, this session):
1. **A** ships as a dedicated **`SUPPLEMENTARY` batch scope type** that references the original
   period, recomputes correct PAYE on the full intended salary, and pays
   `grossBalance − remainingPAYE`.
2. **B**: staff with no valid salary config get an **₦0 base line, flagged** — never a guessed
   default. They still appear (with bonuses/add-ons) and HR must set salary + regenerate.
3. **D#6** exemption fires when **`grossMonthly < ₦66,667` OR `netBeforePaye < ₦66,667`**.
   "Net" = gross minus statutory reliefs/deductions, computed pre-PAYE (needs a two-pass calc,
   see D2).
4. **D#5** full scope: add a **TIN** field to staff AND model **NHIS + Pension** as statutory
   deductions in the PAYE engine (changes net pay platform-wide, not just the report).
5. **E**: treat the 0% delivery rate as a **likely bug** — diagnose affected roles (esp. Head of
   Logistics, whose bonus keys on TEAM_DR) before building the breakdown UI.

---

## Ground truth (verified file map)

Payroll backend lives in `apps/api/src/hr/`. Pure calc engines in `packages/shared/src/hr/`.

- **Generation:** `payroll-batch.service.ts` — `generateBatch` (435), `generateNullScopeBatch`
  (589), `synthesizeDraftBatchContent` (894, staff enumeration), `computeStaffPayoutsBatched`
  (1238), `previewBatch` (1949).
- **Base salary resolution:** NOT a hardcoded default. `packages/shared/src/hr/payroll-formula-engine.ts`
  `resolveBaseSalary` (114–127) picks the highest matching `baseSalaryTiers[].amount`, else
  `flatBaseSalary ?? flatMonthlyAmount ?? 0`. The ₦120k-vs-₦100k divergence is a **tier**
  (`{DR≥40→120000}` in `seed-payroll-config.ts` 49–52) shadowing a `flatBaseSalary` of ₦100k.
  If no plan resolves, `computeForMember` returns `null` → member **silently dropped**.
- **PAYE engine:** `packages/shared/src/hr/paye-calc.ts` — `computePaye` (91–136, receives only
  `monthlyGross`), `applyReliefs` (30–65), `progressiveTax` (67–88), `defaultPayeBandConfig`
  (139–154, tax-free ₦800k). Config load: `payroll-compute.service.ts` `loadTaxConfig` (548–570).
  **No ₦66,667 exemption. No NHIS/pension.**
- **Adjustments:** `earnings_adjustments` table (`schema/hr.ts` 236–251). Sweep predicate
  `pendingAdjustmentForMonth` (`payroll-batch.service.ts` 46–55). **Add-ons folded AFTER PAYE**
  (1520–1537) → top-ups are currently untaxed.
- **Bonus engine:** `payroll-formula-engine.ts` `computePayrollFormula` (191–229) already returns
  `bonusBreakdown`; `resolveBonusFromTiers` (129–174). Metrics: `payroll-metrics.service.ts`
  `individualDr = delivered/totalOrders` (236, 459) → **0% when totalOrders===0**.
- **Earnings Outlook:** `hr.service.ts` `previewPayout` (668–900) returns `performanceBonus` +
  `deliveryRate` but **omits `bonusBreakdown`**. UI `user-detail-lazy-panels.tsx`
  `UserDetailEarningsOutlookCard` (36–130).
- **HR Users list:** `users.service.ts` `list` (1431), `buildUsersListConditions` (1184–1406).
  Scopes by `user_branches` OR `primary_branch_id` OR `scope_global`. **Payroll scopes by
  `primary_branch_id` ONLY** → the two diverge (root of B's "in payroll, invisible in HR").
- **Export pattern to mirror:** `exportBankUpload` (`payroll-batch.service.ts` 3217–3283) +
  route `api.hr-bank-pay-export.tsx` + `lib/bank-pay-csv.ts` / `lib/bank-pay-pdf.ts` +
  `PayrollBankPayExportModal.tsx`.
- **Payout row shape:** `payout_records` (`schema/hr.ts` 203–231) has `baseSalary`,
  `performanceBonus`, `addOnsTotal`, `deductionsTotal`, `grossPay`, `payeTax`, `netPay`,
  `bonusBreakdown` (jsonb), `metricsSnapshot` (jsonb).

Cross-cutting traps to honor (from prior work): `nigeriaMonthWindow(periodMonth-string)` — never
`getUTCMonth()` on a WAT-midnight Date; `earnings_adjustments`/`payout_records` history tables use
the positional `yannis_capture_history()` trigger (`SELECT ($1).*`) — any column add MUST mirror
to the `_history` table in the same migration; adjustment sweep requires `approvedBy NOT NULL` +
`period_month` match.

---

## PROGRESS (updated this session)

- **E1 (diagnosis) — DONE.** No calc bug. Findings: (1) DISPLAY gap — `previewPayout` computes team DR but never returns `teamDeliveryRate`; UI shows individual DR (≈0 for Heads, correct). (2) CONFIG gap — the Head-of-Logistics pay-role formula has NO TEAM_DR bonus tiers (`seed-payroll-staff-assign.ts:48-56`), so bonus=0 is correct; adding a delivery-based bonus is a DATA/config change (HR/CEO decision), not code. (3) HARDENING — an empty reportee set makes `teamDr` undefined → TEAM_DR tiers silently fall back to individualDr≈0 (`payroll-formula-engine.ts:39`); make it explicit. → E2 shrinks to a transparency/display feature + the config correction.
- **D2 (statutory + exemption) — DONE (backend + UI + tests).** Engine two-pass (`paye-calc.ts`): statutory off gross → `netBeforePaye` → exemption gate (gross<T OR net<T → PAYE 0) → progressive tax. New `PayeCalcResult` fields: `statutoryTotal`, `statutoryBreakdown`, `netBeforePaye`, `exempt`. Config gains `statutoryDeductions[]` + `lowIncomeExemptionMonthly` (default 66,667; Pension/NHIS default OFF so no silent net-pay change). Threaded through all 4 compute paths + all batch-service inserts/preview (contractor net now subtracts statutory). Persisted on `payout_records` (`statutory_total`, `statutory_breakdown`). Mig **0306** (+ `_history` twins). Config save/load in `payroll-config.service.ts` + `payroll-compute.service.ts` `loadTaxConfig`. UI: `TaxBandConfigModal` statutory editor + exemption input + both tax-bands route actions. Tests: `paye-calc.spec.ts` (9). All api/shared typecheck clean; 23 HR tests pass.
- **D1 (TIN) — BACKEND DONE.** `users.tin` col, mig **0307** (rebuilds explicit-column `users_history` triggers with `tin`), `updatePayrollProfileSchema.tin`, service write, router passthrough. REMAINING: UI input + user-detail read projection (bundle with D3 UI).
- **A (supplementary payroll) — BACKEND DONE.** New `SUPPLEMENTARY` scope type (mig **0308** + `references_period`/`references_batch_id` on `payroll_batches` + history twins). `PayrollBatchService.computeSupplementaryLines` recomputes each staff's INTENDED line for the original period (via `computeForMember` with today's config) vs their SETTLED payout, then `previewSupplementaryBatch` / `generateSupplementaryBatch` emit a DRAFT batch with one line per underpaid staff (base=grossBalance, paye=remainingPAYE; full derivation in `metricsSnapshot.supplementary`). Shared pure helper `computeSupplementaryBalance` is the single source of truth (tested: HR's ₦120k/₦80k → ₦34k net example, plus overpay-floors-at-0 and statutory cases). Validators + barrel + router (`hr.previewSupplementaryBatch`/`hr.generateSupplementaryBatch`, authedProcedure + service-level authz gate). GL posting, `formatDepartment`, and dept-owner notify all verified safe for the department-null SUPPLEMENTARY batch (falls back to 'General'/'Supplementary'/no-owner-notify). 41 HR tests pass; api + shared typecheck clean. REMAINING: UI (supplementary mode on PayrollGeneratePage + batch-detail rendering of `metricsSnapshot.supplementary`).
- **A UI — DONE.** Supplementary mode on PayrollGeneratePage (Standard/Supplementary toggle → pick period → affected-staff CompactTable with Expected/Paid/Balance gross, Correct/Deducted/Remaining PAYE, Net; row selection; generate → redirect to batch detail). Route actions mirror existing apiRequest pattern. Batch detail renders `metricsSnapshot.supplementary` derivation.
- **D1 UI — DONE.** TIN input next to annual-rent on payroll profile (PayrollUserProfileSection), threaded through getById read + loader + all 3 save paths + self-edit.
- **E2 — DONE.** `previewPayout` now returns `teamDeliveryRate` + `bonusBreakdown`; Earnings Outlook card renders team-DR row (Heads only) + per-rule bonus breakdown. NOTE: E1 also surfaced that the Head-of-Logistics pay-role formula has NO TEAM_DR bonus tiers (a DATA/config gap) — adding tiers is an HR/CEO decision, not shipped here.
- **D2 UI — DONE** (tax-band config statutory editor + exemption input).
- **D3 — DONE (backend + UI).** `exportPayeRemittance` (batch or month scope, joins users for TIN/phone, statutory + relief breakdown, exempt → PAYE 0). Router `hr.exportPayeRemittance` (hr.read). Web: `paye-remittance-csv.ts` formatter + "PAYE Remittance" button on PayrollReportsPage (enabled when a single month is selected).
- **B — PARTIALLY DONE.**
  - **B3 reconciliation report — DONE (backend + UI).** `payrollReconciliation` classifies every settled staff for a month as UNDERPAID/OVERPAID/OK (correct-vs-paid via the same recompute as supplementary; `computeSupplementaryLines(mode:'all')`). Router `hr.payrollReconciliation` (hr.read). Web: `payroll-reconciliation-csv.ts` + "Reconciliation" button on PayrollReportsPage. This also satisfies **B1's intent** (HR can now SEE every staff paid in a period, with correct vs paid), without risky surgery on `buildUsersListConditions`.
  - **B2 (no silent ₦0 default) — DEFERRED, NEEDS SIGN-OFF.** Investigation confirmed there is NO ₦120k hardcoded default — the divergence is `baseSalaryTiers` config, and the separate silent-drop is `if (!plan) return null` in computeForMember (staff with no resolvable plan vanish from the batch). The approved behavior ("include at ₦0 base, flagged") is a real payroll-GENERATION semantics change: it would force ₦0 lines into every batch for previously-dropped staff (incl. admins/non-payroll roles), needs a new `MISSING_CONFIG` line status, and must be kept out of GL/totals. Given the reconciliation report + supplementary flow already let HR DETECT and FIX these post-hoc, I did NOT silently change generation semantics. Recommend: implement B2 as a generate-time READINESS WARNING (informational, lists would-be-dropped staff) rather than forcing ₦0 lines — confirm before building.

Open decision surfaced by D2: PAYE chargeable base is currently gross−reliefs (statutory does NOT reduce the tax base, only net pay + the exemption's "net"). If Nigerian rule requires pension to be tax-deductible (reduce chargeable), model pension ALSO as a relief. Flagged for HR sign-off.

## Recommended build order

Dependency-driven. D2 (statutory engine) underpins A's PAYE math and D#6's net definition, so it
lands early. E1 is a bug-diagnosis spike that may shrink E's scope.

```
D2 (statutory deductions + exemption engine)  ← foundational PAYE change
   └─> A  (supplementary batch; needs correct full-salary PAYE)
   └─> D1 (TIN field)
        └─> D3 (PAYE remittance export)
B  (visibility reconciliation + ₦0-flag + report)   ← independent
E1 (delivery-rate diagnosis spike)  ─> E2 (bonus breakdown persistence + UI)
```

---

## Track D — PAYE engine: statutory deductions, exemption, remittance export

### D2. Statutory deductions (Pension + NHIS) + low-income exemption  [FOUNDATIONAL]
This is the largest single change because it alters net pay for **all** staff.

Engine (`packages/shared/src/hr/paye-calc.ts`):
- Extend `PayeBandConfig` with a `statutoryDeductions` block (config-driven, per company group,
  like `reliefs`): e.g. `pension: { employeeRate: 8 }`, `nhis: { rate: … }`. Do NOT hardcode — put
  rates in `payroll_tax_band_configs` JSONB so HR can tune without a deploy (mirrors reliefs).
- `computePaye` two-pass: (1) compute statutory deductions off gross; (2) `netBeforePaye = gross −
  statutory`; (3) **exemption gate**: if `monthlyGross < 66_667` OR `netBeforePaye < 66_667` →
  `monthlyPaye = 0` (mirror the existing `GROSS_NO_DEDUCTION` early-return shape at 95–106);
  (4) otherwise progressive tax as today. Return statutory line items in the result so payslips +
  the remittance export can show them.
- `PayeCalcResult` gains `statutoryBreakdown[]` and `netBeforePaye`.
- Thread through ALL invocation sites (map §2): `payroll-compute.service.ts` 197/320/372/415,
  contractor path `payroll-batch.service.ts` 1121. Persist statutory total on `payout_records`
  (new column `statutory_total numeric(12,2)` + `statutory_breakdown jsonb`; **mirror to
  `payout_records_history`**).
- Config schema/validator: `packages/shared/src/validators/payroll.ts` (alongside
  `payeReliefSchema`). UI: `TaxBandConfigModal.tsx` gains statutory-rate inputs.
- Migration: add columns to `payout_records` (+ history) and default statutory config seed.

Tests: `paye-calc` unit specs for exemption boundary (gross exactly 66,667; net just under),
pension math, and that `GROSS_NO_DEDUCTION` still short-circuits.

**Coordinate with in-progress `project_paye_rent_relief_fix`** — that work also edits `paye-calc.ts`
(rent relief basis). Land rent-relief first or rebase; do not double-edit `applyReliefs`
concurrently.

### D1. TIN field
- Add `tin text` (nullable) to `users` + **`users_history`** (positional trigger) in one migration.
- Profile input: `UserCreatePage` / `UserEditPage` + `users.service` create/update validators.

### D3. PAYE Remittance Export
- Backend: new `exportPayeRemittance(batchId | period, actor)` in `payroll-batch.service.ts`
  alongside `exportBankUpload`. Reads `payout_records` (grossPay, statutory_breakdown, netPay,
  payeTax) + joins `users` (name, role, phone, **tin**). Gate `permissionProcedure('hr.read')` or
  a finance code — decide with RBAC (`hr.reports.export`?).
- Router: new procedure in `hr.router.ts`.
- Web route: mirror `api.hr-bank-pay-export.tsx`.
- Formatters: new `lib/paye-remittance-csv.ts` + `lib/paye-remittance-pdf.ts` (mirror bank-pay).
- Columns: Name, TIN, Role, Phone, Gross, statutory deductions (Rent Relief, NHIS, Pension), Net,
  PAYE. Exempt staff (D2) show **PAYE = ₦0**.
- UI: modal mirroring `PayrollBankPayExportModal.tsx`, launched from PayrollReports / batch detail.

---

## Track A — Supplementary payroll (completes original salary + correct PAYE)

Worked example (from HR doc): expected gross ₦120k / correct PAYE ₦8k; paid ₦80k / PAYE ₦2k →
gross balance ₦40k, remaining PAYE ₦6k, net supplementary ₦34k.

### A1. Schema
- `payroll_batch_scope_type` enum → add `SUPPLEMENTARY` (`schema/enums.ts` 328).
- `payroll_batches` → add `references_period date` (the original month being completed) and
  `references_batch_id uuid` (nullable). Mirror to `_history`.
- `payout_records` on a supplementary batch reuse existing columns but semantics = *balance only*
  (baseSalary = grossBalance, payeTax = remainingPAYE). Add `is_supplementary boolean` OR derive
  from batch.scopeType (prefer derive — no column).

### A2. Generation logic
- New `generateSupplementaryBatch(input, actor)` in `payroll-batch.service.ts` (sibling of
  `generateNullScopeBatch`). For each affected staff:
  1. Look up the **original** payout_record for `references_period` (already-paid gross + PAYE).
  2. Resolve **intended** full salary for that period (correct config — post-B this is reliable).
  3. `correctPAYE = computePaye(intendedGross)` (uses D2 engine — statutory + bands).
  4. `grossBalance = intendedGross − paidGross`; `remainingPAYE = correctPAYE − paidPAYE`
     (floored at 0).
  5. Emit a payout line: baseSalary=grossBalance, payeTax=remainingPAYE,
     netPay=grossBalance−remainingPAYE. Snapshot the full derivation into `metricsSnapshot`
     (expected/paid/balance for each of gross + PAYE) so the UI table + audit can show it.
- **Affected-staff auto-detection:** a query comparing each staff's `intended` salary for the
  period vs their settled `payout_records.grossPay` for that period; surface the mismatch list in
  the generate UI (like the readiness list). HR confirms before generating.
- Goes through the **normal batch lifecycle** (DRAFT→PENDING_HR→PENDING_FINANCE→PAID) and posts to
  GL via the existing `postPayrollBatch` (already null-scope tolerant).

### A3. UI
- `PayrollGeneratePage` gains a "Supplementary" mode: pick original period → shows affected-staff
  table with columns: Expected gross, Paid gross, Gross balance, Correct PAYE, PAYE deducted,
  Remaining PAYE, Net supplementary. Generate → standard batch detail.
- Batch detail renders supplementary lines with the derivation (from `metricsSnapshot`).

Tests: supplementary math (the worked example must produce ₦34k net); remaining-PAYE floor at 0
when overpaid; GL posting balances.

---

## Track B — Hidden staff / wrong base salary + reconciliation

### B1. Visibility reconciliation (root cause)
- The HR Users list and payroll enumeration use **different branch-scoping**. Fix by making them
  consistent: the HR Users list must surface **anyone payroll would pay**. Concretely, add an
  opt-in filter/section "Payroll staff" that uses the payroll enumeration's `primary_branch_id`
  predicate, OR broaden `buildUsersListConditions` so a staff whose `primary_branch_id` is in scope
  is never hidden by a missing `user_branches` row. Decide with a small spike (which divergence
  actually hides real staff on prod).
- Ensure DEACTIVATED-but-on-payroll staff are reachable (currently `ne(status,'DEACTIVATED')`
  default at 1222) — payroll should not pay deactivated staff; if it does, that's a separate bug to
  surface, not hide.

### B2. No silent default (₦0-flag)
- In `computeForMember` / `computeForMemberInMemory` (`payroll-compute.service.ts`): when no valid
  plan/pay-role resolves (currently returns `null` → silent drop), instead emit a **₦0 base line
  flagged** `lineStatus` (new value e.g. `MISSING_CONFIG`) with a reason, so the member appears in
  the batch with bonuses/add-ons but ₦0 base + a visible warning. HR sets salary + regenerates.
- Add a **readiness warning** on `PayrollGeneratePage` listing staff with missing/ambiguous config
  before generation (reuse the `unassignedStaffCount` banner pattern).

### B3. Reconciliation report
- New report: per affected staff → Correct base salary, Salary actually paid, Excess paid, Correct
  PAYE, PAYE deducted, Overpayment to recover. Backend method reading settled `payout_records` vs
  intended config; surfaced on PayrollReports (and feeds A/supplementary for underpayments, or a
  clawback adjustment for overpayments).

Note: B does NOT re-fix the base-salary tier data itself (that's config data HR owns). B makes the
divergence **visible and safe** (no silent wrong default, everyone visible, reconciliation report).

---

## Track E — Performance-bonus breakdown + delivery-rate correctness

### E1. Delivery-rate diagnosis spike  [DO FIRST]
- Reproduce the "Delivery Rate 0% / Team Rate missing" for the named roles (Head of Logistics +
  others). Hypotheses to check against real data:
  - Head-of-Logistics bonus keys on **TEAM_DR** — verify `previewPayout`/generation resolve team
    metrics (the shipped `project_earnings_outlook_payroll_fixes` removed `skipTeamMetrics`; confirm
    it applies on ALL paths incl. Logistics reportee lookup).
  - `individualDr = delivered/totalOrders` = 0 when `totalOrders===0` — is the attribution/window
    correct for the role, or is it the WAT month-window trap
    (`project_payroll_period_window_bonus_zero`)?
  - Is the role's metric source (`deliveredMetricSource` FUNNEL vs RECOVERY_COMBINED) right?
- Output: a short finding that either (a) identifies a metrics bug to fix, or (b) confirms 0% is
  genuine for those staff → then E is display-only.

### E2. Bonus breakdown persistence + UI
- Backend `hr.service.ts` `previewPayout` (668–900): **include `bonusBreakdown`** (already computed
  on the line as `computed.bonusBreakdown`) plus per-metric context: personal DR, team DR, orders
  delivered, target achieved, and each rule's Met / Not-met / Partially-met status. Add to the
  `StaffPayoutEstimate` type (`apps/web/app/features/users/types.ts`).
- Ensure the **generated payout uses the same values** shown in the Outlook (both already call the
  same `computeForMember*` → verify no divergence, esp. team metrics on the preview path).
- UI `user-detail-lazy-panels.tsx` `UserDetailEarningsOutlookCard`: render a breakdown table —
  Personal DR, Team DR, Orders Delivered, Target Achieved, per-rule bonus (with Met/Not-met/Partial
  badge), Total Performance Bonus.
- **July back-pay:** affected staff underpaid on July bonuses feed **Track A** (supplementary
  batch) for the outstanding bonus balance.

Tests: `previewPayout` returns breakdown; Outlook total == generated payout total for a staff with
tiered bonus.

---

## Migrations summary (mirror every `_history` in the same migration)
1. `payout_records` + history: `statutory_total`, `statutory_breakdown` (D2).
2. `users` + history: `tin` (D1).
3. `payroll_batches` + history: `references_period`, `references_batch_id`; enum
   `SUPPLEMENTARY` (A1).
4. `payroll_payslip_line_status` enum: `MISSING_CONFIG` (B2), if line-status enum is used.
5. Statutory-config default seed in `payroll_tax_band_configs` (D2).

## Open items needing sign-off during build
- D#6 exact "net" definition = gross − (statutory + reliefs)? or gross − statutory only? (plan
  assumes **gross − statutory**, pre-relief; confirm with HR.)
- Pension/NHIS exact rates + whether employer portions are tracked (plan models **employee** side
  only for PAYE/net; employer NHIS/pension are a separate cost ledger if needed).
- B1 scoping fix: which divergence to unify (spike output decides).
- RBAC code for the PAYE remittance export.
