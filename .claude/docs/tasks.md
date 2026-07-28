# Tasks & Future Enhancements

## Deferred

### Ad Spend → GL Auto-Reconciliation
**Priority:** Low (future phase)
**Context:** MBs record daily ad spend per campaign on the Marketing Ad Spend page. The Finance Officer separately records the actual bank payment (from Meta/Google billing) as an expense or journal entry. Currently this is manual — Finance checks the bank statement and creates the entry.

**Proposed enhancement:**
1. At month-end, auto-generate a **draft journal entry** that sums all MB-recorded ad spend for the period, grouped by platform (Meta, Google, TikTok, etc.)
2. Draft pre-fills: Debit 6210 Digital Ad Spend, Credit 1112 Cash at Bank
3. Finance Officer reviews the draft against the actual bank statement amount
4. If amounts match: approve the draft (one click)
5. If amounts differ: adjust the draft amount to match the bank statement, then approve
6. Show a reconciliation summary: "MB recorded total: ₦1,200,000 | Bank charge: ₦1,180,000 | Variance: ₦20,000"

**Why deferred:** Current manual flow works fine with 2-4 entries per month. Automate when volume grows or when the Finance Officer requests it.

### Add-On Orders (Partial Offer Fulfilment)
**Priority:** Medium
**Requested by:** Head of Logistics
**Status:** Pending CEO approval

**Problem:** Customer wants a higher-tier offer (e.g. 6-pack at ₦10,000/unit) but can only afford part of it now (e.g. 3 units). Currently there's no way to honour the discounted price when they return for the rest.

**Proposed implementation:**
1. CS creates the order, indicating the customer's intended quantity (6) vs what they're paying for now (3). Order is priced at the full-tier per-unit rate.
2. Order goes through the normal lifecycle and gets delivered.
3. System saves a pending add-on record: remaining quantity (3) at the original locked price, valid for 14 days from delivery date.
4. If the customer returns within 14 days, CS opens the parent order and triggers the add-on.
5. Extra items are added to the **same order** (not a new order). `totalAmount` is updated, stock is deducted for the additional units.
6. After 14 days the pending add-on expires automatically (no action needed).

**Key design decisions:**
- Add-on lives on the parent order, not a separate order — no double-counting in metrics.
- Price is frozen from the original offer tier — customer keeps the discounted rate.
- Stock is only affected when the add-on is fulfilled, not when the original order is created.
- 14-day eligibility window from delivery date.
- Any user with order management access can trigger the add-on.

**Open questions for implementation:**
- How does CS indicate "intended vs paying" at order creation? New fields on the create form, or a separate "Create with add-on" flow?
- When the add-on is fulfilled, does the order re-enter a lifecycle state (e.g. back to CONFIRMED for the new items) or does stock deduct immediately inline while staying DELIVERED?
- Should there be a dashboard/list of pending add-ons expiring soon so CS can proactively reach out?
