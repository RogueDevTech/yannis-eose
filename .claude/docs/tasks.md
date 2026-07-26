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
