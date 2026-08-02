# AUDIT-FINDINGS.md — Yannis EOSE Platform Bug & Correctness Audit

**Status:** 13 of 22 feature areas scanned (2026-07-31). ~112 confirmed bugs, **9 CRITICAL**, ~56 HIGH.
**Method:** Each feature area scanned by multiple parallel finder agents, then **every candidate finding adversarially verified** (default-refuted) before inclusion. Findings only — **no code changed**.
**Resume:** Remaining scans #14–#22 (Notifications, Audit, Onboarding, VOIP, Payments, AI Assistant, Settings, Rider, TPL).

> This report is a snapshot of the running audit. The authoritative live tracker is the Claude Code task list (#23–#52 are fix-tasks) and the memory files under `.claude/projects/.../memory/project_audit_*`.

---

## ⚡ FIX PRIORITY ORDER (start here)

1. **🔴 CRIT — HR_MANAGER → SUPER_ADMIN account takeover** (`users.service.ts:2783`). `resetPassword` has no target-role guard; gated by a code HR holds by default. **Most exploitable bug in the audit.** [Task #49]
2. **🔴 CRIT — Self-escalation via `permissionOverrides`** (`users.service.ts:2356`). `update()` grants a puppet any permission with no sensitivity/actor-holds-code check; the gate is dead code. Combines with #1. [Task #49]
3. **🔴 CRIT — `finance.costView` (read-only) grants finance WRITE** (`strip-finance-fields.ts:65`). AUDITOR/ACCOUNTANT can create+settle cash remittances, post GL. Platform-wide helper. [Task #44 / verify #45]
4. **🔴 CRIT — COGS=0 on graduation** (`general-ledger.service.ts:574` + cart/follow-up). Every graduated delivery posts revenue with zero cost → 100% margin. One shared root cause. [Tasks #26/#28/#35]
5. **🔴 CRIT — Double GL settlement / double-pay / double-post** — concurrency across remittance, payroll, invoices, MB balances, GL vouchers. [Sweep #34]
6. **🔴 CRIT — CS self-remit cart orders** (`cart-orders.service.ts:594`) + **MB fund-transfer no-auth** (`marketing.service.ts:3524`) + **cart phone leak** (`cart.router.ts:163`).

**Then the cross-cutting sweeps** (each fixes many findings at once):
- **#34 Concurrency** (read-then-write, no lock/unique) — ~12 findings across every money domain.
- **#39 Get-by-id company scoping** — detail reads skip the scope their list siblings have.
- **#45 Verify `costView` blast radius** — may promote several finance/GL/HR findings.
- **#30 Stat-strip date-column** and **#31 bare `this.db.update` (NULL actor)**.

---

## SYSTEMIC ROOT CAUSES (fixing these clears most findings)

| # | Pattern | Where | Fix approach |
|---|---------|-------|--------------|
| 1 | **COGS = 0** on graduation | `postSalesInvoice` `if cogs>0` guard + `landedCost` never populated on graduated orders (cart + follow-up + finance) | Capture FIFO landedCost in `applyGraduationStockAndLedger`, write back before posting; fail-closed on cogs=0 |
| 2 | **Concurrency / no lock or unique** | `withActor` = READ COMMITTED, no FOR UPDATE, no unique constraints → double-post/pay/graduate/negative-balance | Add FOR UPDATE, DB unique/partial-unique + ON CONFLICT, or advisory xact locks |
| 3 | **Get-by-id skips company scope** | every detail `get*` forwards raw id with no `groupId`/`effectiveBranchIds` while its `list*` sibling scopes | Thread `ctx.activeGroupId`/`effectiveBranchIds`; assert row.groupId ∈ scope |
| 4 | **Money-write authz / SoD + `costView` conflation** | self-approve (expense/JE/payroll), read-perm gating writes, `costView` treated as elevated | Distinct approver checks; separate read-only perms from write capability |
| 5 | **Shadow / parallel code paths** | standalone `generatePayouts` vs batch; ungated `bulkReassign` vs `assignToCS` | Consolidate or gate the shadow path to match the guarded one |
| 6 | **Cross-company WRITE authz** | `deactivateDepartment`/`assignBranchToGroup`/team-mgmt/provider move boundary w/o same-company guard | Shared `assertActorCanMutateBranch(actor, branchId)` |
| 7 | **FIFO shelf-drift** | `adjust()` + `resolveReconciliation` touch shelf not FIFO batches | Adjust FIFO batch layers alongside shelf |
| 8 | **Raw `new Date()` vs Nigeria helpers** | `getProfitReport`, `generatePayouts` drop last business day | Use `nigeriaDayStart/End` |

**✅ Confirmed sound:** `context.ts` `effectiveBranchIds`/`activeGroupId` computation is correct — cross-company findings are genuine per-endpoint omissions, not a base-layer bug.

---

## FINDINGS BY AREA

### Task #1 — Orders & CS Workflow (11 confirmed, 4 HIGH)
- **HIGH** Logistics-stage transitions ungated → any authed user can drive WRITTEN_OFF and destroy inventory (`orders.service.ts:5171`)
- **HIGH** `revealPhoneForManualCall` reveals raw phone with no audit for CS_ENGAGED+ orders (`orders.service.ts:4041`)
- **HIGH** `bulkReassign` resets ANY order to CS_ASSIGNED, no per-order auth (`orders.service.ts:6302`)
- **HIGH** Advisory lock acquire/release on different pooled connections → leak + weak dedup (`orders.service.ts:2238`)
- **MED** `globalSearch` bypasses branch+company scoping; `getDuplicateComparisonPhones` cross-company raw phones; auto-dispatch never writes `servicing_branch_id`; REMITTED→DELIVERED retrack clobbers `deliveredAt`; follow-up double-graduation; `timeSeriesByCreated` missing CS_CLOSER self-query mirror
- Fix-tasks: #23 (HIGH), #24 (scoping), #25 (integrity)

### Task #2 — Follow-Up Orders (10 confirmed, 7 HIGH)
- **HIGH** ⭐ Graduation discards FIFO landedCost → sale posts with NO COGS (`follow-up-config.service.ts:2248`) — Pillar 3
- **HIGH** →DELETED never sets `deletedAt` → ghost orders stay visible/actionable (`:1641`)
- **HIGH** Team Analysis double-counts graduated follow-ups → DR>100% (`orders.router.ts:1800`)
- **HIGH** `getFollowUpOrderDetail` returns raw phone, no gate/audit/branch check (`:1251`)
- **HIGH** Batch-item assignment writes orders table with no actor → `modified_by`=NULL (`orders.service.ts:11607`)
- **HIGH** `ensureInvoiceForOrder` dup-invoice race (`finance.service.ts:205`)
- **HIGH/MED** Graduation dedup sentinel → unique-index collision → permanent boot-retry loop (`:1989`)
- **MED/LOW** `syncGraduatedStatusToSource` no withActor; stat-strip date-col mismatch; `deleteFollowUpGroup` NULL actor
- Fix-tasks: #26 (HIGH), #27 (MED/LOW)

### Task #3 — Cart & Cart Orders (15 confirmed / ~9 distinct, 3 CRITICAL)
- **CRIT** Cart graduation posts sale with COGS=0 (`cart-orders.service.ts:1276`) — shared with #2
- **CRIT** `cart.getById` ships raw phone to marketing roles, unaudited (`cart.router.ts:163`) — cites unverified "CEO directive 2026-05-22"
- **CRIT** CS closer can self-remit a cart order, bypassing accountant-only flow (`cart-orders.service.ts:594`)
- **HIGH** `cartOrders.list` bulk raw phone to marketing roles (`:300`); stat-strip vs list date column (`:347`)
- **MED** concurrent double-graduation + double stock (`:973`); invoice race; DELETED sub-count ignores self-query
- **LOW** graduation dedup writes cart_orders without withActor (`:1014`)
- Fix-tasks: #28 (CRIT), #29 (HIGH/MED/LOW)

### Task #4 — Marketing (11 confirmed / ~10 distinct, 1 CRITICAL)
- **CRIT** `approveMbFundTransfer`/`rejectMbFundTransfer` NO authorization — any user approves peer money transfer (`marketing.service.ts:3524`)
- **HIGH** `acceptMbFundTransfer` double-accept double-credits (`:3607`); follow-up delivered EXCLUDED from all marketing metrics (`:5582`, contradicts CEO directive); `updateCampaign` IDOR — any MB edits/archives any campaign (`:6759`)
- **MED** `createMbFundTransfer` no role check; balance status mismatch (getFundingBalance vs listFundingBalances); `otherExpensesSummary`/`listFunding` self-scope IDORs; ad-spend read-then-write → negative balance
- **LOW** `updateCampaign` partial formConfig clobber
- Fix-tasks: #32 (CRIT/HIGH), #33 (MED/LOW)

### Task #5 — Finance (15 confirmed, 1 CRITICAL)
- **CRIT** Double GL settlement — `markDeliveryRemittanceReceived` no FOR UPDATE, no unique on `gl_entries(voucher_type,voucher_id)` (`logistics.service.ts:3086`)
- **HIGH** dup invoice full blast radius (`finance.service.ts:205`); `updateInvoiceStatus` write gated by finance.READ, cross-company flip (`finance.router.ts:42`); **GL COGS=0 is GL-LAYER** (`general-ledger.service.ts:574`); disputed remittance strands orders forever (`logistics.service.ts:3255`); cross-company remittance books B's AR under A's Debtors (`:1755`)
- **HIGH** (gap re-run) `approveExpense` self-approve → posts own GL voucher; `listExpenses` ungated → any user reads vendor names/amounts/receipt URLs
- **MED** commission no proration → daily P&L wrong; MV vs direct commission mismatch (= Finance-overview stat gap); `getBudgetUtilization` cross-company; `listApprovalRequests` over-counts
- **LOW** GL idempotency check-then-insert; approval notif to literal FINANCE_OFFICER role
- Fix-tasks: #35 (CRIT/HIGH), #36 (MED/LOW)

### Task #6 — General Ledger / Accounting (20 confirmed / ~16 distinct + 2 plausible)
- **✅ Duplicate-stack RESOLVED:** `admin.finance.*` accounting pages are 303-redirects to `admin.accounting.*`. Single live stack, no cleanup.
- **HIGH** Concurrency double-post: `approveJournalEntry` (`:1569`), `reverseJournalEntry` (`:1785`, → negative), `postOpeningBalances` (`:1698`), `runDepreciation` (`asset-register.service.ts:280`)
- **HIGH** Cross-company: `getAccountLedger` (`:3315`), `getJournalEntry` (`:1891`) reads; `reverseJournalEntry` (`:1783`) cross-company WRITE
- **HIGH** Bank rec: `completeReconciliation` certifies with unmatched lines + nonzero diff (`bank-reconciliation.service.ts:239`); `matchLine` double-match (`:163`)
- **MED** ₦500k threshold nullified by self-approval; `updateAccountMapping` no company check → GL silently dropped; `recordWht` swallows closed-period; match/unmatch mutate COMPLETED recon; `getAsset`/`getReconciliation` cross-company reads
- **LOW** `deactivateAccount` no guard; `createFiscalYear` overlap no exclusion constraint
- Fix-tasks: #37 (HIGH), #38 (MED/LOW), sweep #39

### Task #7 — HR / Payroll / Commissions (13 confirmed, 1 CRITICAL)
- **KEY:** two parallel payout paths — guarded batch flow vs unguarded standalone `generatePayouts`/`approvePayout` shadow.
- **CRIT** Payroll GL double-post (`general-ledger.service.ts:841`)
- **HIGH** `backfillPaidPayrollGl` double-post; **no segregation-of-duties** in batch chain (one actor DRAFT→PAID alone); payroll pays UNAPPROVED adjustments (no `approvedBy` filter); standalone `generatePayouts` not idempotent → double-pay; `listContractorPayouts` cross-company leak
- **MED** `approvePayout` no state machine/GL; DEDUCTION category silently dropped; per-product bonus overpays (count vs distinct); `bulkAssignPayRole`/`updatePayrollProfile` no branch/company scope
- **LOW** `approveAdjustment` reject writes non-existent columns; `generatePayouts` raw Date() not Nigeria bounds
- Fix-tasks: #40 (CRIT/HIGH), #41 (MED/LOW)

### Task #8 — Inventory / Stock / Shipments (12 confirmed, 5 HIGH)
- **KEY:** FIFO/shelf DRIFT — `adjust()` (`:1322`) + `resolveReconciliation` (`:3416`) touch shelf, never FIFO batches → surplus unsellable, shrinkage → phantom COGS. Jul-29 stock overhaul missed the manual-correction paths. Root of the graduation-stock-gap.
- **HIGH** the two FIFO-drift paths; reconciliation clamps level but logs full discrepancy (`:3419`); reconciliation approves against missing level row (`:3416`); `inventoryAdminPageBundle` drops company+branch scope on thresholds (`router:589`)
- **MED** movements list unscoped for admins → cross-company leak; `getLevelById`/detail/summary/availableStock omit effectiveBranchIds; `intake`/`adjust` no location authz (RLS inert); manual `intake` no GL posting
- **LOW** `availableStock` authedProcedure not `inventory.read`
- Fix-tasks: #42 (HIGH), #43 (MED/LOW)

### Task #9 — Logistics / Delivery / Remittance (5 confirmed, 1 CRITICAL)
- **CRIT** ⭐ `hasFinanceWriteAccess()` admits read-only AUDITOR/ACCOUNTANT via `finance.costView` (`strip-finance-fields.ts:65`) — PLATFORM-WIDE finance-write hole
- **HIGH** transfer-remittance `markRemittanceReceived` double-credits inventory, no FOR UPDATE (`:1607`); provider/location write mutations ignore company scope → IDOR (`router:142`+)
- **LOW** `createDeliveryRemittance` markReceivedNow net can go negative; `getDuplicateGroup` unscoped lookup
- Fix-tasks: #44 (CRIT/HIGH), #46 (LOW), verify #45

### Task #10 — Branches & Multi-Company (6 confirmed, 2 HIGH)
- **✅ `context.ts` effectiveBranchIds computation is SOUND** — validates all prior cross-company findings.
- **HIGH** `getGroup` cross-company IDOR — any user reads any company's name+branch roster (`branches.router.ts:1653`); `deactivateDepartment` transfers orders/users/campaigns to ANY company's branch, no same-company guard (`branch-teams.service.ts:1200`)
- **MED** stale tRPC `switchBranch` leaves activeGroupId/selectedBranchIds stale (latent); `assignBranchToGroup` orphans group-scoped products/commissions; branch-team mgmt gated only on org-wide dept permission, no actor-company binding
- Fix-tasks: #47 (HIGH), #48 (MED)

### Task #11 — Users, RBAC & Permissions (6 confirmed / ~5 distinct, 2 CRITICAL) — MOST SEVERE
- **CRIT** ⭐⭐ `resetPassword` no target-role guard → HR_MANAGER takes over any SUPER_ADMIN (`users.service.ts:2783`)
- **CRIT** ⭐⭐ `users.update` `permissionOverrides` bypass sensitive-permission workflow → self-escalation to effective admin (`:2356`)
- **HIGH** `resetPassword` gated by deactivate code, no credential-specific permission (`router:340`)
- **MED** `getById` returns full cross-company staff record incl. compensation (`:1121`); `canAccessStaffHrUserDetail` grants comp reads to read-only finance viewers (`authz.ts:321`)
- Fix-tasks: #49 (CRIT — TOP PRIORITY), #50 (HIGH/MED)

### Task #12 — Products & Categories (7 confirmed / ~5 distinct, 5 HIGH)
- **HIGH** `products.getById` cross-company IDOR (`:328`); `productCategories.getById`+`update` cross-company IDOR/mutation incl. brand PII (`product-categories.service.ts:66/136`); `setBundleComponents` 2-level bundle chain → FIFO/COGS corruption (`:872`); `setBundleComponents` no company scope → cross-company component injection (`:822`)
- **MED** `getBundleComponents` unscoped
- Fix-task: #51

### Task #13 — Dashboards (3 confirmed, 1 HIGH) — LOW YIELD (canonical spec holds)
- **HIGH** CEO branch-scoped profit uses raw `new Date()` = UTC midnight → drops last business day (`finance.service.ts:384`)
- **MED** SuperAdmin Delivered/Remitted breakdown modals drop imported orders → don't sum to Total (`SuperAdminDashboard.tsx:354`)
- **LOW** AdminQuickDashboard funnel strip servicing-scoped but tiles link to marketing-scoped page (`:146`)
- Fix-task: #52

---

## NOTES FOR THE TEAM / OPEN QUESTIONS
- **`cart.getById` raw-phone** cites a "CEO directive 2026-05-22" making phone exposure unconditional — **verify whether that directive is real** before "fixing."
- **Follow-up MB attribution** (marketing metrics): a project-memory note says the `isFollowUp` filter was removed so follow-up deliveries credit the MB — **the filter is still present** (`marketing.service.ts:5582`). Reverted or never merged? Confirm intent.
- Remaining scans #14–#22 not yet run: **Payments (Pillar 1) and AI Assistant (tool-layer role filtering) still have real security surface** worth the deep scan.

---
*Generated from the audit memory files. No source code was modified during the audit.*
